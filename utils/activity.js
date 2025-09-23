// utils/activity.js
const fs = require('fs').promises;
const path = require('path');
const { downloadFromDropbox, uploadToDropbox } = require('./storage');
const { Client, Guild } = require('discord.js');

// 保存先パス
const MONTHLY_FILE = '/app/app-data/userMonthlyActivity.json';
const WEEKLY_FILE = '/app/app-data/userWeeklyMessages.json';

// 設定
const EXCLUDED_USERS = [
  "1366740571707801610",
  "1399725671357354014" // 除外したいユーザーID
];
const ACTIVE_ROLE_ID = "1419894684263911505"; // 付与するロールID
const TOP_RANK_ROLE_COUNT = 3; // 上位何人にロール付与するか

// データ
let monthlyActivity = {}; // guildId → userId → メッセージ数
let weeklyActivity = {};  // guildId → userId → メッセージ数

// 保存関数
async function saveActivity(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    if (filePath === MONTHLY_FILE) await uploadToDropbox('/userMonthlyActivity.json', JSON.stringify(data));
    if (filePath === WEEKLY_FILE) await uploadToDropbox('/userWeeklyMessages.json', JSON.stringify(data));
  } catch (err) {
    console.error(`❌ ${filePath} 保存失敗:`, err);
  }
}

// Dropboxからロード
async function loadActivity() {
  try {
    const monthlyData = await downloadFromDropbox('/userMonthlyActivity.json');
    monthlyActivity = monthlyData ? JSON.parse(monthlyData) : {};

    const weeklyData = await downloadFromDropbox('/userWeeklyMessages.json');
    weeklyActivity = weeklyData ? JSON.parse(weeklyData) : {};

    console.log('✅ 月間・週間アクティブデータ読み込み成功');
  } catch (err) {
    console.error('❌ アクティブデータ読み込み失敗:', err);
    monthlyActivity = {};
    weeklyActivity = {};
  }
}

// メッセージ追加
async function addMessage(guildId, userId, messageContent = "") {
  if (!guildId || !userId) return;

  // 「あ」などの短すぎるメッセージはカウントしない
  const filtered = messageContent.trim();
  if (!filtered || filtered.length <= 1) return;
  if (filtered.match(/^([あいうえおa-zA-Z0-9ー]+)$/i)) return;

  // 月間
  if (!monthlyActivity[guildId]) monthlyActivity[guildId] = {};
  if (!monthlyActivity[guildId][userId]) monthlyActivity[guildId][userId] = 0;
  monthlyActivity[guildId][userId] += 1;

  // 週間
  if (!weeklyActivity[guildId]) weeklyActivity[guildId] = {};
  if (!weeklyActivity[guildId][userId]) weeklyActivity[guildId][userId] = 0;
  weeklyActivity[guildId][userId] += 1;

  await saveActivity(MONTHLY_FILE, monthlyActivity);
  await saveActivity(WEEKLY_FILE, weeklyActivity);
}

// 月間ランキング取得
function getRanking(guildId) {
  if (!guildId || !monthlyActivity[guildId]) return [];

  return Object.entries(monthlyActivity[guildId])
    .filter(([userId]) => !EXCLUDED_USERS.includes(userId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_RANK_ROLE_COUNT);
}

// 上位3位にロール付与
async function updateActiveRoles(guild) {
  if (!guild || !guild.members) return;

  try {
    const ranking = getRanking(guild.id);
    const members = await guild.members.fetch();

    // まず全員からロール削除
    members.forEach(member => {
      if (member.roles.cache.has(ACTIVE_ROLE_ID)) member.roles.remove(ACTIVE_ROLE_ID).catch(() => {});
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

module.exports = {
  addMessage,
  getRanking,
  updateActiveRoles,
  loadActivity
};