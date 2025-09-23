const fs = require('fs');
const path = require('path');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./storage');

const LOCAL_LEVEL_DATA_PATH = path.join(__dirname, '../userLevels.json');
const DROPBOX_LEVEL_DATA_PATH = '/app-data/userLevels.json';
const LEVEL_SETTINGS_PATH = path.join(__dirname, '../levels.json');

let userLevels = {};
let levelSettings = {};
const xpCooldown = new Set();
const COOLDOWN_TIME = 30 * 1000; // 30秒
const LEVEL_LOG_CHANNEL_ID = process.env.LEVEL_LOG_CHANNEL_ID || null;
const DROPBOX_RETRY_COUNT = 3;
const DROPBOX_RETRY_INTERVAL = 2000; // ms

// -------------------- データロード --------------------
async function loadData() {
  try {
    await ensureDropboxInit();
    const data = await downloadFromDropbox(DROPBOX_LEVEL_DATA_PATH);
    if (data) {
      const parsed = JSON.parse(data);
      userLevels = { ...userLevels, ...parsed }; // 既存データに追記
      console.log('✅ Dropboxユーザーレベルデータをロードしました');
    }
  } catch (err) {
    console.warn('⚠️ Dropboxロード失敗、ローカルを確認します:', err.message);
  }

  // ローカルロード
  try {
    if (fs.existsSync(LOCAL_LEVEL_DATA_PATH)) {
      const localData = JSON.parse(fs.readFileSync(LOCAL_LEVEL_DATA_PATH, 'utf-8'));
      userLevels = { ...userLevels, ...localData };
      console.log('✅ ローカルユーザーレベルデータをロードしました');
    }
  } catch (err) {
    console.error('❌ ローカルロード失敗:', err);
  }

  // レベル設定ロード
  try {
    if (fs.existsSync(LEVEL_SETTINGS_PATH)) {
      levelSettings = JSON.parse(fs.readFileSync(LEVEL_SETTINGS_PATH, 'utf-8'));
      console.log('✅ レベル設定ロード完了');
    } else {
      console.warn('⚠️ レベル設定が存在しないため初期作成');
      levelSettings = {
        "1": { xp: 100, roleId: null, message: "レベル1到達！" },
        "2": { xp: 250, roleId: null, message: "レベル2到達！" },
        "3": { xp: 500, roleId: null, message: "レベル3到達！" }
      };
      fs.writeFileSync(LEVEL_SETTINGS_PATH, JSON.stringify(levelSettings, null, 2));
    }
  } catch (err) {
    console.error('❌ レベル設定ロード失敗:', err);
    levelSettings = {};
  }
}

// -------------------- データ保存 --------------------
async function saveData() {
  try {
    fs.writeFileSync(LOCAL_LEVEL_DATA_PATH, JSON.stringify(userLevels, null, 2));
  } catch (err) {
    console.error('❌ ローカル保存失敗:', err);
  }

  // Dropbox保存（リトライ）
  for (let i = 0; i <= DROPBOX_RETRY_COUNT; i++) {
    try {
      await ensureDropboxInit();
      const success = await uploadToDropbox(DROPBOX_LEVEL_DATA_PATH, JSON.stringify(userLevels, null, 2));
      if (success) return true;
    } catch (err) {
      if (i === DROPBOX_RETRY_COUNT) console.error('❌ Dropbox保存最終失敗:', err.message);
      else await new Promise(res => setTimeout(res, DROPBOX_RETRY_INTERVAL));
    }
  }
}

// -------------------- XP付与 --------------------
async function addXp(member) {
  if (!member?.id || !member.guild) return;
  if (xpCooldown.has(member.id)) return;

  const guildId = member.guild.id;
  const userId = member.id;

  if (!userLevels[guildId]) userLevels[guildId] = {};
  if (!userLevels[guildId][userId]) userLevels[guildId][userId] = { level: 0, xp: 0 };

  const userData = userLevels[guildId][userId];
  const oldLevel = userData.level;

  userData.xp += Math.floor(Math.random() * 6) + 5;

  let newLevel = oldLevel;
  while (levelSettings[newLevel + 1] && userData.xp >= levelSettings[newLevel + 1].xp) newLevel++;

  if (newLevel > oldLevel) {
    userData.level = newLevel;
    await handleLevelUp(member, newLevel);
  }

  await saveData();

  xpCooldown.add(member.id);
  setTimeout(() => xpCooldown.delete(member.id), COOLDOWN_TIME);
}

// -------------------- レベルアップ処理 --------------------
async function handleLevelUp(member, newLevel) {
  const data = levelSettings[newLevel];
  if (!data) return;

  const msg = data.message.replace("{user}", member.user.tag);
  let logChannel = LEVEL_LOG_CHANNEL_ID ? member.guild.channels.cache.get(LEVEL_LOG_CHANNEL_ID) : member.guild.systemChannel;
  if (logChannel) await logChannel.send(`🎉 ${member} ${msg}`);

  if (data.roleId) {
    const role = member.guild.roles.cache.get(data.roleId);
    if (role) await member.roles.add(role).catch(() => {});
  }
}

// -------------------- ユーティリティ --------------------
function getLevelData(guildId, userId) {
  return (userLevels[guildId]?.[userId]) || { level: 0, xp: 0 };
}

async function setLevelAndXp(guildId, userId, level, xp) {
  if (!userLevels[guildId]) userLevels[guildId] = {};
  userLevels[guildId][userId] = { level, xp };
  await saveData();
}

function calculateRequiredXp(level) {
  return levelSettings[level]?.xp || null;
}

module.exports = { loadData, addXp, getLevelData, setLevelAndXp, calculateRequiredXp };