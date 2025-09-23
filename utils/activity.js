const fs = require('fs');
const path = require('path');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./storage');

const APP_DATA_DIR = path.join(__dirname, '../app-data');
const LOCAL_MONTHLY_PATH = path.join(APP_DATA_DIR, 'userMonthlyActivity.json');
const LOCAL_WEEKLY_PATH  = path.join(APP_DATA_DIR, 'userWeeklyMessages.json');
const DROPBOX_MONTHLY_PATH = '/app-data/userMonthlyActivity.json';
const DROPBOX_WEEKLY_PATH  = '/app-data/userWeeklyMessages.json';

let monthlyActivity = {};
let weeklyActivity = {};

// -------------------- ディレクトリ確認・作成 --------------------
function ensureAppDataDir() {
  if (!fs.existsSync(APP_DATA_DIR)) {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
  }
}

// -------------------- データロード --------------------
async function loadActivity() {
  ensureAppDataDir(); // フォルダ確認

  try {
    await ensureDropboxInit();

    // Dropbox 月間
    try {
      const data = await downloadFromDropbox(DROPBOX_MONTHLY_PATH);
      if (data) monthlyActivity = { ...monthlyActivity, ...JSON.parse(data) };
    } catch {}

    // Dropbox 週間
    try {
      const data = await downloadFromDropbox(DROPBOX_WEEKLY_PATH);
      if (data) weeklyActivity = { ...weeklyActivity, ...JSON.parse(data) };
    } catch {}

    // ローカル月間
    if (fs.existsSync(LOCAL_MONTHLY_PATH)) {
      const data = JSON.parse(fs.readFileSync(LOCAL_MONTHLY_PATH, 'utf-8'));
      monthlyActivity = { ...monthlyActivity, ...data };
    }

    // ローカル週間
    if (fs.existsSync(LOCAL_WEEKLY_PATH)) {
      const data = JSON.parse(fs.readFileSync(LOCAL_WEEKLY_PATH, 'utf-8'));
      weeklyActivity = { ...weeklyActivity, ...data };
    }

    console.log('✅ アクティビティデータロード完了');
  } catch (err) {
    console.error('❌ アクティビティロード失敗:', err);
  }
}

// -------------------- 保存 --------------------
async function saveActivity() {
  ensureAppDataDir(); // フォルダ確認

  try {
    fs.writeFileSync(LOCAL_MONTHLY_PATH, JSON.stringify(monthlyActivity, null, 2));
    await uploadToDropbox(DROPBOX_MONTHLY_PATH, JSON.stringify(monthlyActivity, null, 2));
  } catch (err) {
    console.error('❌ 月間アクティビティ保存失敗:', err);
  }

  try {
    fs.writeFileSync(LOCAL_WEEKLY_PATH, JSON.stringify(weeklyActivity, null, 2));
    await uploadToDropbox(DROPBOX_WEEKLY_PATH, JSON.stringify(weeklyActivity, null, 2));
  } catch (err) {
    console.error('❌ 週間アクティビティ保存失敗:', err);
  }
}

// -------------------- メッセージ追加 --------------------
async function addMessage(guildId, userId, content) {
  if (!monthlyActivity[guildId]) monthlyActivity[guildId] = {};
  if (!monthlyActivity[guildId][userId]) monthlyActivity[guildId][userId] = 0;
  monthlyActivity[guildId][userId]++;

  if (!weeklyActivity[guildId]) weeklyActivity[guildId] = {};
  if (!weeklyActivity[guildId][userId]) weeklyActivity[guildId][userId] = 0;
  weeklyActivity[guildId][userId]++;

  await saveActivity();
}

// -------------------- 月間リセット --------------------
async function resetMonthlyActivity(client) {
  monthlyActivity = {};
  await saveActivity();
  console.log('✅ 月間アクティビティリセット完了');
}

// -------------------- 週間リセット --------------------
async function resetWeeklyActivity() {
  weeklyActivity = {};
  await saveActivity();
}

// -------------------- 上位取得 --------------------
function getTopMonthly(guildId, limit = 10) {
  const data = monthlyActivity[guildId] || {};
  return Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function getTopWeekly(guildId, limit = 10) {
  const data = weeklyActivity[guildId] || {};
  return Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

module.exports = {
  loadActivity,
  saveActivity,
  addMessage,
  resetMonthlyActivity,
  resetWeeklyActivity,
  getTopMonthly,
  getTopWeekly
};