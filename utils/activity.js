const fs = require("fs").promises;
const path = require("path");
const { uploadToDropbox } = require("./storage");

const DATA_DIR = path.join(__dirname, "../app-data");
const ACTIVITY_FILE = path.join(DATA_DIR, "userMonthlyActivity.json");

// 除外するユーザーID
const EXCLUDED_USERS = [
  "1366740571707801610",
  "1399725671357354014"
];

// 付与するロールID
const ACTIVE_ROLE_ID = "1419894684263911505";

// 短文無視用（1文字や「あ」など）
const MIN_MESSAGE_LENGTH = 2;

let activityData = {};

async function initActivity() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const data = await fs.readFile(ACTIVITY_FILE, "utf8");
    activityData = JSON.parse(data);
  } catch {
    activityData = {};
    await saveActivity();
  }
}

async function saveActivity() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(ACTIVITY_FILE, JSON.stringify(activityData, null, 2));
    await uploadToDropbox(ACTIVITY_FILE, JSON.stringify(activityData, null, 2));
  } catch (err) {
    console.error("❌ activityData 保存失敗:", err);
  }
}

// メッセージ追加
async function addMessage(userId, guildId, content) {
  if (!content || content.trim().length < MIN_MESSAGE_LENGTH) return;
  if (EXCLUDED_USERS.includes(userId)) return;

  if (!activityData[guildId]) activityData[guildId] = {};
  if (!activityData[guildId][userId]) activityData[guildId][userId] = 0;

  activityData[guildId][userId]++;
  await saveActivity();
}

// 月間ランキング取得
function getRanking(guildId) {
  if (!activityData[guildId]) return [];
  return Object.entries(activityData[guildId])
    .sort((a, b) => b[1] - a[1]);
}

// 上位3位にロール付与（非対象ユーザーはスキップ）
async function updateActiveRoles(guild) {
  if (!guild) return;
  try {
    const ranking = getRanking(guild.id);
    const top3 = ranking.slice(0, 3);
    const members = await guild.members.fetch();

    // 一旦全員からロールを除去
    for (const member of members.values()) {
      if (member.roles.cache.has(ACTIVE_ROLE_ID)) {
        await member.roles.remove(ACTIVE_ROLE_ID).catch(() => {});
      }
    }

    // 上位3位のみロール付与
    for (const [userId] of top3) {
      if (EXCLUDED_USERS.includes(userId)) continue;
      const member = members.get(userId);
      if (member) {
        await member.roles.add(ACTIVE_ROLE_ID).catch(() => {});
      }
    }
  } catch (err) {
    console.error("❌ updateActiveRoles error:", err);
  }
}

module.exports = {
  initActivity,
  addMessage,
  getRanking,
  updateActiveRoles
};