// utils/activity.js

const { uploadToDropbox, downloadFromDropbox } = require("./storage");


const ACTIVE_ROLE_ID = "1419894684263911505";

const ACTIVITY_FILE = "/app-data/activity.json";

let activityData = {};
let cooldowns = new Map(); 

// ==================== データ管理 ====================
async function loadActivity() {
  try {
    activityData = await loadFromDropbox(ACTIVITY_FILE) || {};
  } catch {
    activityData = {};
  }
}

async function saveActivity() {
  await saveToDropbox(ACTIVITY_FILE, activityData);
}

// ==================== カウント ====================
function addMessage(guildId, userId) {
  const now = Date.now();
  if (cooldowns.has(userId) && now - cooldowns.get(userId) < 10000) {
    return; // 10秒クールダウン
  }
  cooldowns.set(userId, now);

  if (!activityData[guildId]) activityData[guildId] = {};
  if (!activityData[guildId][userId]) activityData[guildId][userId] = 0;

  activityData[guildId][userId] += 1;
  saveActivity();
}

// ==================== ランキング ====================
function getRanking(guildId) {
  if (!activityData[guildId]) return [];
  return Object.entries(activityData[guildId])
    .sort((a, b) => b[1] - a[1]); // [ [userId, count], ... ]
}

// ==================== アクティブロール付与/削除 ====================
async function updateActiveRoles(guild) {
  const ranking = getRanking(guild.id).slice(0, 3).map(([uid]) => uid);
  const role = guild.roles.cache.get(ACTIVE_ROLE_ID);
  if (!role) return;

  // 剥奪
  for (const member of guild.members.cache.values()) {
    if (member.roles.cache.has(role.id) && !ranking.includes(member.id)) {
      await member.roles.remove(role).catch(() => {});
    }
  }
  // 付与
  for (const uid of ranking) {
    const member = await guild.members.fetch(uid).catch(() => null);
    if (member && !member.roles.cache.has(role.id)) {
      await member.roles.add(role).catch(() => {});
    }
  }
}

// ==================== 月間リセット ====================
async function resetMonthly() {
  activityData = {};
  await saveActivity();
}

module.exports = {
  ACTIVE_ROLE_ID,
  loadActivity,
  saveActivity,
  addMessage,
  getRanking,
  updateActiveRoles,
  resetMonthly,
};