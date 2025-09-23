// utils/activity.js
const fs = require("fs").promises;
const path = require("path");
const { uploadToDropbox } = require("./storage");

const ACTIVITY_FILE = path.join(__dirname, "../app-data/userMonthlyActivity.json");

// 除外したいユーザーID
const EXCLUDED_USERS = [
  "1366740571707801610",
  "1399725671357354014"// 例
];

// 付与するロールID
const ACTIVE_ROLE_ID = "1419894684263911505";

// データ初期化
let activityData = {};

// 初期化（Dropbox等からロード）
async function initActivity() {
  try {
    const data = await fs.readFile(ACTIVITY_FILE, "utf8");
    activityData = JSON.parse(data);
  } catch {
    activityData = {};
  }
}

// データ保存
async function saveActivity() {
  await fs.writeFile(ACTIVITY_FILE, JSON.stringify(activityData, null, 2));
  await uploadToDropbox(ACTIVITY_FILE, JSON.stringify(activityData, null, 2));
}

// メッセージをカウント
async function addMessage(guildId, userId, content) {
  if (!content || content.trim().length < 3) return; // 短すぎるメッセージ除外
  if (EXCLUDED_USERS.includes(userId)) return; // 除外ユーザー無視

  if (!activityData[guildId]) activityData[guildId] = {};
  if (!activityData[guildId][userId]) activityData[guildId][userId] = 0;

  activityData[guildId][userId]++;
  await saveActivity();
}

// ギルドごとのランキング取得（上位3位だけ）
function getRanking(guildId) {
  if (!activityData[guildId]) return [];
  const entries = Object.entries(activityData[guildId]);
  entries.sort((a, b) => b[1] - a[1]); // メッセージ数降順
  return entries.slice(0, 3); // 上位3位
}

// アクティブロールを更新（上位3人のみ）
async function updateActiveRoles(guild) {
  if (!guild) return;
  const role = guild.roles.cache.get(ACTIVE_ROLE_ID);
  if (!role) return;

  // まず全メンバーからロールを削除
  guild.members.cache.forEach(member => {
    if (member.roles.cache.has(role.id)) {
      member.roles.remove(role).catch(() => {});
    }
  });

  // 上位3位のメンバーにロール付与
  const ranking = getRanking(guild.id);
  for (const [userId] of ranking) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) member.roles.add(role).catch(() => {});
  }
}

// 雑談チャンネルではランキング禁止
function isRankingAllowed(channel) {
  if (!channel || !channel.name) return true;
  return !channel.name.includes("雑談");
}

module.exports = {
  initActivity,
  addMessage,
  getRanking,
  updateActiveRoles,
  isRankingAllowed,
};