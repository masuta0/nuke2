/// utils/activity.js
const { uploadToDropbox, downloadFromDropbox } = require("./storage");

const ACTIVITY_FILE = "/app-data/userMonthlyActivity.json";
const ACTIVE_ROLE_ID = "1419894684263911505"; // ←アクティブロールのIDに置き換え
const COOLDOWN_MS = 10 * 1000; // 10秒

let activityData = {};
let lastMessageTime = {}; // userId: timestamp

// 初期化: Dropboxからロード
async function initActivity() {
  try {
    const data = await downloadFromDropbox(ACTIVITY_FILE);
    if (data) activityData = JSON.parse(data);
  } catch (err) {
    console.error("activity.js: Dropboxロード失敗", err);
    activityData = {};
  }
}

// 保存
async function saveActivity() {
  try {
    await uploadToDropbox(ACTIVITY_FILE, JSON.stringify(activityData, null, 2));
  } catch (err) {
    console.error("activity.js: Dropbox保存失敗", err);
  }
}

// メッセージカウント（クールダウン付き）
async function addMessage(client, guildId, userId) {
  const now = Date.now();
  const key = `${guildId}-${userId}`;
  if (lastMessageTime[key] && now - lastMessageTime[key] < COOLDOWN_MS) return;
  lastMessageTime[key] = now;

  if (!activityData[guildId]) activityData[guildId] = {};
  if (!activityData[guildId][userId]) activityData[guildId][userId] = 0;
  activityData[guildId][userId]++;

  await saveActivity();
  await updateActiveRoles(client, guildId);
}

// 上位3人にアクティブロール付与、抜けた人は削除
async function updateActiveRoles(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const guildData = activityData[guildId];
  if (!guildData) return;

  // メッセージ数でソート
  const sorted = Object.entries(guildData)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3); // 上位3人

  const topUserIds = sorted.map(([userId]) => userId);

  // ギルドメンバーを取得
  await guild.members.fetch();

  guild.members.cache.forEach(async (member) => {
    if (topUserIds.includes(member.id)) {
      // 上位3名: ロールがなければ付与
      if (!member.roles.cache.has(ACTIVE_ROLE_ID)) {
        member.roles.add(ACTIVE_ROLE_ID).catch(() => {});
      }
    } else {
      // 上位から外れた: ロールがあれば削除
      if (member.roles.cache.has(ACTIVE_ROLE_ID)) {
        member.roles.remove(ACTIVE_ROLE_ID).catch(() => {});
      }
    }
  });
}

// ランキング取得
function getRanking(guildId) {
  if (!activityData[guildId]) return [];
  return Object.entries(activityData[guildId])
    .sort((a, b) => b[1] - a[1]); // [[userId, count], ...]
}

module.exports = {
  initActivity,
  addMessage,
  updateActiveRoles,
  getRanking,
};