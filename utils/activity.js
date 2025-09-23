// utils/activity.js
const fs = require('fs').promises;
const { downloadFromDropbox, uploadToDropbox } = require('./storage');

// 保存先パス
const MONTHLY_FILE = '/app/app-data/userMonthlyActivity.json';

// 設定
const EXCLUDED_USERS = [
  "1366740571707801610",
  "1399725671357354014"
];
const ACTIVE_ROLE_ID = "1419894684263911505"; // 上位3位に付与
const TOP_RANK_ROLE_COUNT = 3;

// データ
let monthlyActivity = {}; // guildId → userId → メッセージ数

// 保存関数
async function saveActivity() {
  try {
    await fs.writeFile(MONTHLY_FILE, JSON.stringify(monthlyActivity, null, 2));
    await uploadToDropbox('/userMonthlyActivity.json', JSON.stringify(monthlyActivity));
  } catch (err) {
    console.error(`❌ ${MONTHLY_FILE} 保存失敗:`, err);
  }
}

// Dropboxからロード
async function loadActivity() {
  try {
    const data = await downloadFromDropbox('/userMonthlyActivity.json');
    monthlyActivity = data ? JSON.parse(data) : {};
    console.log('✅ 月間アクティブデータ読み込み成功');
  } catch (err) {
    console.error('❌ 月間アクティブデータ読み込み失敗:', err);
    monthlyActivity = {};
  }
}

// メッセージ追加
async function addMessage(guildId, userId, messageContent = "") {
  if (!guildId || !userId) return;

  // 「あ」などの短すぎるメッセージはカウントしない
  const filtered = messageContent.trim();
  if (!filtered || filtered.length <= 1) return;
  if (/^([あいうえおa-zA-Z0-9ー]+)$/i.test(filtered)) return;

  if (!monthlyActivity[guildId]) monthlyActivity[guildId] = {};
  if (!monthlyActivity[guildId][userId]) monthlyActivity[guildId][userId] = 0;
  monthlyActivity[guildId][userId] += 1;

  await saveActivity();
}

// 月間ランキング取得（上位3位）
function getRanking(guildId) {
  if (!guildId || !monthlyActivity[guildId]) return [];
  return Object.entries(monthlyActivity[guildId])
    .filter(([userId]) => !EXCLUDED_USERS.includes(userId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_RANK_ROLE_COUNT);
}

// ギルド内で上位3位にロール付与・外れた人は削除
async function updateActiveRoles(guild) {
  if (!guild || !guild.members) return;

  try {
    const ranking = getRanking(guild.id);
    const members = await guild.members.fetch();

    // 全員からロール削除
    members.forEach(member => {
      if (member.roles.cache.has(ACTIVE_ROLE_ID)) {
        member.roles.remove(ACTIVE_ROLE_ID).catch(() => {});
      }
    });

    // 上位3位にロール付与
    for (const [userId] of ranking) {
      const member = members.get(userId);
      if (member) member.roles.add(ACTIVE_ROLE_ID).catch(() => {});
    }
  } catch (err) {
    console.error('❌ updateActiveRoles エラー:', err);
  }
}

// 全ギルドでロール更新
async function updateActiveRolesForAllGuilds(client) {
  client.guilds.cache.forEach(guild => updateActiveRoles(guild).catch(console.error));
}

// 月間リセット
async function resetMonthlyActivity(client) {
  monthlyActivity = {};
  await saveActivity();
  console.log('✅ 月間アクティブデータをリセットしました');
  await updateActiveRolesForAllGuilds(client);
}

module.exports = {
  addMessage,
  getRanking,
  updateActiveRoles,
  updateActiveRolesForAllGuilds,
  loadActivity,
  resetMonthlyActivity
};