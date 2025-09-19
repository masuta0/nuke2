// utils/level.js

const fs = require('fs');
const path = require('path');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./storage');
const { ChannelType } = require('discord.js');

const LEVEL_SETTINGS_PATH = path.join(__dirname, '../levels.json');
const DROPBOX_LEVEL_DATA_PATH = '/app-data/userLevels.json';

let userLevels = {};
let levelSettings = {};
const xpCooldown = new Set();

// ★ 修正: クールダウン時間を30秒に設定
const COOLDOWN_TIME = 30 * 1000;

// ★ 修正: レベルログチャンネルIDを追加
const LEVEL_LOG_CHANNEL_ID = process.env.LEVEL_LOG_CHANNEL_ID || '1411721928120598739';

async function loadData() {
    try {
        await ensureDropboxInit();
        const data = await downloadFromDropbox(DROPBOX_LEVEL_DATA_PATH);
        if (data) {
            userLevels = JSON.parse(data);
            console.log('✅ ユーザーレベルデータをDropboxからロードしました。');
        } else {
            console.warn('⚠️ ユーザーレベルデータがDropboxに見つかりませんでした。新規作成します。');
            userLevels = {};
        }
    } catch (err) {
        console.error('❌ Failed to load user levels data from Dropbox:', err);
        userLevels = {};
    }
    try {
        levelSettings = JSON.parse(fs.readFileSync(LEVEL_SETTINGS_PATH, 'utf-8'));
        console.log('✅ レベル設定データをローカルからロードしました。');
    } catch (err) {
        console.error('❌ Failed to load level settings data:', err);
        levelSettings = {};
    }
}

async function saveData() {
    try {
        const success = await uploadToDropbox(DROPBOX_LEVEL_DATA_PATH, JSON.stringify(userLevels, null, 2));
        if (!success) {
            console.error('❌ Failed to save user levels data to Dropbox: Upload function returned false.');
        }
    } catch (err) {
        console.error('❌ Failed to save user levels data to Dropbox:', err);
    }
}

async function addXp(member) {
    if (xpCooldown.has(member.id)) {
        return;
    }
    const userId = member.id;
    const guildId = member.guild.id;

    if (!userLevels[guildId]) userLevels[guildId] = {};
    if (!userLevels[guildId][userId]) {
        userLevels[guildId][userId] = { level: 0, xp: 0 };
    }

    const userData = userLevels[guildId][userId];
    const oldLevel = userData.level;

    // ★ 修正: 付与する経験値の量を少なくする（5〜10の範囲に変更）
    const addedXp = Math.floor(Math.random() * 6) + 5;
    userData.xp += addedXp;
    let newLevel = oldLevel;

    while (levelSettings[newLevel + 1] && userData.xp >= levelSettings[newLevel + 1].xp) {
        newLevel++;
    }

    if (newLevel > oldLevel) {
        userData.level = newLevel;
        await handleLevelUp(member, newLevel);
    }

    await saveData();
    xpCooldown.add(member.id);
    setTimeout(() => {
        xpCooldown.delete(member.id);
    }, COOLDOWN_TIME);
}

async function handleLevelUp(member, newLevel) {
    const levelData = levelSettings[newLevel];
    if (!levelData) {
        console.warn(`Level up data for level ${newLevel} not found.`);
        return;
    }
    const levelUpMessage = levelData.message.replace("{user}", member.user.tag);

    // ★ 修正: レベルログチャンネルにメッセージを送信
    let logChannel = member.guild.channels.cache.get(LEVEL_LOG_CHANNEL_ID);
    if (!logChannel) {
        console.warn('⚠️ レベルログチャンネルが見つかりません。システムチャンネルに送信します。');
        logChannel = member.guild.systemChannel;
    }
    if (logChannel) {
        await logChannel.send(`🎉 ${member} ${levelUpMessage}`);
    }

    if (levelData.roleId) {
        const role = member.guild.roles.cache.get(levelData.roleId);
        if (role) {
            try {
                await member.roles.add(role);
                console.log(`✅ ${member.user.tag} にレベル${newLevel}のロールを付与しました。`);
            } catch (err) {
                console.error(`❌ ロール付与に失敗しました: ${err}`);
            }
        }
    }
}

function getLevelData(guildId, userId) {
  if (!userLevels[guildId] || !userLevels[guildId][userId]) {
    return { level: 0, xp: 0 };
  }
  return userLevels[guildId][userId];
}

async function setLevelAndXp(guildId, userId, newLevel, newXp) {
  if (!userLevels[guildId]) userLevels[guildId] = {};
  userLevels[guildId][userId] = { level: newLevel, xp: newXp };
  await saveData();
}

function calculateRequiredXp(level) {
  const levelData = levelSettings[level];
  return levelData ? levelData.xp : null;
}

if (!fs.existsSync(LEVEL_SETTINGS_PATH)) {
    fs.mkdirSync(path.dirname(LEVEL_SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(LEVEL_SETTINGS_PATH, JSON.stringify({
        "1": { "xp": 100, "roleId": null, "message": "おめでとう！あなたはレベル1に到達しました！" },
        "2": { "xp": 250, "roleId": null, "message": "すごい！あなたはレベル2に到達しました！" },
        "3": { "xp": 500, "roleId": null, "message": "さらにすごい！あなたはレベル3に到達しました！" },
    }, null, 2));
}

module.exports = { loadData, addXp, getLevelData, setLevelAndXp, calculateRequiredXp };
