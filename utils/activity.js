// utils/activity.js
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require("./storage");

const ACTIVITY_FILE = "/app-data/userMonthlyMessages.json";
const ACTIVE_ROLE_ID = "1419894684263911505";

let activityData = {}; // guildId: { userId: count }
let lastMessageTimestamps = {}; // userId: timestamp
const MESSAGE_COOLDOWN = 10 * 1000; // 10秒

// 初期化・Dropboxからデータロード
async function initActivity() {
  await ensureDropboxInit();
  const data = await downloadFromDropbox(ACTIVITY_FILE);
  if (data) {
    try { activityData = JSON.parse(data); }
    catch(e){ console.error("activity.json parse error:",e); }
  }
}

// 保存
async function saveActivity() {
  await uploadToDropbox(ACTIVITY_FILE, JSON.stringify(activityData));
}

// メッセージをカウント
async function addMessage(userId, guildId) {
  const now = Date.now();
  if (lastMessageTimestamps[userId] && now - lastMessageTimestamps[userId] < MESSAGE_COOLDOWN) {
    return; // クールダウン内はカウントしない
  }
  lastMessageTimestamps[userId] = now;

  if (!activityData[guildId]) activityData[guildId] = {};
  if (!activityData[guildId][userId]) activityData[guildId][userId] = 0;
  activityData[guildId][userId]++;
  await saveActivity();
}

// 指定ギルドのランキング取得（降順）
function getRanking(guildId) {
  if (!activityData[guildId]) return [];
  return Object.entries(activityData[guildId])
    .sort((a,b) => b[1]-a[1]);
}

// アクティブユーザーロール更新
async function updateActiveRoles(guild) {
  if (!activityData[guild.id]) return;
  const ranking = getRanking(guild.id).slice(0,3); // 上位3人
  const members = await guild.members.fetch();

  // ロールを持たせるべき上位3人のID
  const topIds = ranking.map(([id]) => id);

  for (const member of members.values()) {
    const hasRole = member.roles.cache.has(ACTIVE_ROLE_ID);
    const shouldHave = topIds.includes(member.id);

    if (shouldHave && !hasRole) {
      await member.roles.add(ACTIVE_ROLE_ID).catch(console.error);
    } else if (!shouldHave && hasRole) {
      await member.roles.remove(ACTIVE_ROLE_ID).catch(console.error);
    }
  }
}

module.exports = {
  initActivity,
  addMessage,
  getRanking,
  updateActiveRoles,
};