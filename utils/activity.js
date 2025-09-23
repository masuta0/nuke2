const fs = require('fs');
const path = require('path');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./storage');

const APP_DATA_DIR = path.join(__dirname, '../app-data');
const LOCAL_MONTHLY_PATH = path.join(APP_DATA_DIR, 'userMonthlyActivity.json');
const LOCAL_WEEKLY_PATH  = path.join(APP_DATA_DIR, 'userWeeklyMessages.json');
const DROPBOX_MONTHLY_PATH = '/app-data/userMonthlyActivity.json';
const DROPBOX_WEEKLY_PATH  = '/app-data/userWeeklyMessages.json';

// 除外ユーザー（IDをここに追加）
const EXCLUDED_USERS = [
  '1366740571707801610',
  '1399725671357354014',
];

let monthlyActivity = {};
let weeklyActivity = {};

// -------------------- ディレクトリ確認・作成 --------------------
function ensureAppDataDir() {
  if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
}

// -------------------- データロード --------------------
async function loadActivity() {
  ensureAppDataDir();
  try {
    await ensureDropboxInit();

    // Dropbox 月間
    try { const data = await downloadFromDropbox(DROPBOX_MONTHLY_PATH); if (data) monthlyActivity = { ...monthlyActivity, ...JSON.parse(data) }; } catch {}
    // Dropbox 週間
    try { const data = await downloadFromDropbox(DROPBOX_WEEKLY_PATH); if (data) weeklyActivity = { ...weeklyActivity, ...JSON.parse(data) }; } catch {}
    // ローカル月間
    if (fs.existsSync(LOCAL_MONTHLY_PATH)) monthlyActivity = { ...monthlyActivity, ...JSON.parse(fs.readFileSync(LOCAL_MONTHLY_PATH, 'utf-8')) };
    // ローカル週間
    if (fs.existsSync(LOCAL_WEEKLY_PATH)) weeklyActivity = { ...weeklyActivity, ...JSON.parse(fs.readFileSync(LOCAL_WEEKLY_PATH, 'utf-8')) };

    console.log('✅ アクティビティデータロード完了');
  } catch (err) {
    console.error('❌ アクティビティロード失敗:', err);
  }
}

// -------------------- 保存 --------------------
async function saveActivity() {
  ensureAppDataDir();
  try {
    fs.writeFileSync(LOCAL_MONTHLY_PATH, JSON.stringify(monthlyActivity, null, 2));
    await uploadToDropbox(DROPBOX_MONTHLY_PATH, JSON.stringify(monthlyActivity, null, 2));
  } catch (err) { console.error('❌ 月間アクティビティ保存失敗:', err); }

  try {
    fs.writeFileSync(LOCAL_WEEKLY_PATH, JSON.stringify(weeklyActivity, null, 2));
    await uploadToDropbox(DROPBOX_WEEKLY_PATH, JSON.stringify(weeklyActivity, null, 2));
  } catch (err) { console.error('❌ 週間アクティビティ保存失敗:', err); }
}

// -------------------- メッセージ追加 --------------------
async function addMessage(userId) {
  if (EXCLUDED_USERS.includes(userId)) return;

  // サーバー全体でカウント
  if (!monthlyActivity['global']) monthlyActivity['global'] = {};
  monthlyActivity['global'][userId] = (monthlyActivity['global'][userId] || 0) + 1;

  if (!weeklyActivity['global']) weeklyActivity['global'] = {};
  weeklyActivity['global'][userId] = (weeklyActivity['global'][userId] || 0) + 1;

  await saveActivity();
}

// -------------------- リセット --------------------
async function resetMonthlyActivity() { monthlyActivity = {}; await saveActivity(); console.log('✅ 月間アクティビティリセット完了'); }
async function resetWeeklyActivity() { weeklyActivity = {}; await saveActivity(); console.log('✅ 週間アクティビティリセット完了'); }

// -------------------- ランキング取得 --------------------
function getTopMonthly(limit = 10) {
  const data = monthlyActivity['global'] || {};
  return Object.entries(data)
    .filter(([userId]) => !EXCLUDED_USERS.includes(userId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function getTopWeekly(limit = 10) {
  const data = weeklyActivity['global'] || {};
  return Object.entries(data)
    .filter(([userId]) => !EXCLUDED_USERS.includes(userId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

// -------------------- ロール付与用ユーティリティ --------------------
async function updateActiveRoles(client, guildId, roleId, topCount = 3) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const topUsers = getTopMonthly(topCount).map(([userId]) => userId);

  const role = guild.roles.cache.get(roleId);
  if (!role) return;

  guild.members.cache.forEach(member => {
    if (topUsers.includes(member.id)) {
      if (!member.roles.cache.has(role.id)) member.roles.add(role).catch(console.error);
    } else {
      if (member.roles.cache.has(role.id)) member.roles.remove(role).catch(console.error);
    }
  });
}

module.exports = {
  loadActivity,
  saveActivity,
  addMessage,
  resetMonthlyActivity,
  resetWeeklyActivity,
  getTopMonthly,
  getTopWeekly,
  updateActiveRoles
};