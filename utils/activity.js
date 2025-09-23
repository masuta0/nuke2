// utils/activity.js
const { uploadToDropbox, downloadFromDropbox } = require('./storage');
const ACTIVITY_FILE = '/app-data/userMonthlyMessages.json';
const ACTIVE_ROLE_ID = '1419894684263911505'; // アクティブユーザーロールID
const COOLDOWN = 10000; // 10秒クールダウン

// データ構造: { [guildId]: { [userId]: count } }
let activityData = {};
// クールダウン管理
const cooldowns = {};

// 初期化: Dropboxから読み込み
async function initActivity() {
  const data = await downloadFromDropbox(ACTIVITY_FILE);
  if (data) {
    try {
      activityData = JSON.parse(data);
      console.log('✅ アクティブユーザーデータ読み込み完了');
    } catch (e) {
      console.error('❌ アクティブユーザーデータ読み込み失敗:', e);
      activityData = {};
    }
  }
}

// メッセージ追加
async function addMessage(guildId, userId) {
  const key = `${guildId}-${userId}`;
  const now = Date.now();
  if (cooldowns[key] && now - cooldowns[key] < COOLDOWN) return;
  cooldowns[key] = now;

  if (!activityData[guildId]) activityData[guildId] = {};
  if (!activityData[guildId][userId]) activityData[guildId][userId] = 0;

  activityData[guildId][userId] += 1;

  await saveActivity();
  await updateActiveRolesByGuild(guildId);
}

// 保存
async function saveActivity() {
  try {
    await uploadToDropbox(ACTIVITY_FILE, JSON.stringify(activityData));
    // console.log('✅ アクティブユーザーデータ保存');
  } catch (e) {
    console.error('❌ アクティブユーザーデータ保存失敗:', e);
  }
}

// ランキング取得
function getRanking(guildId) {
  if (!activityData[guildId]) return [];
  const arr = Object.entries(activityData[guildId]);
  arr.sort((a, b) => b[1] - a[1]); // 多い順
  return arr;
}

// アクティブユーザーロール更新
async function updateActiveRoles(guild) {
  await updateActiveRolesByGuild(guild.id, guild);
}

// 内部: ギルドIDベースで更新
async function updateActiveRolesByGuild(guildId, guildInstance = null) {
  const ranking = getRanking(guildId).slice(0, 3);
  if (!guildInstance) {
    // クライアント側で取得
    const client = require('../index').client;
    guildInstance = client.guilds.cache.get(guildId);
  }
  if (!guildInstance) return;

  // 上位3位のIDセット
  const topIds = new Set(ranking.map(r => r[0]));

  // ギルドメンバーのチェック
  await guildInstance.members.fetch();
  guildInstance.members.cache.forEach(member => {
    const hasRole = member.roles.cache.has(ACTIVE_ROLE_ID);
    if (topIds.has(member.id)) {
      if (!hasRole) member.roles.add(ACTIVE_ROLE_ID).catch(()=>{});
    } else {
      if (hasRole) member.roles.remove(ACTIVE_ROLE_ID).catch(()=>{});
    }
  });
}

module.exports = {
  initActivity,
  addMessage,
  getRanking,
  updateActiveRoles,
};