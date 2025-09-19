// weeklyChannelManager.js

require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./utils/storage');

const TOKEN = process.env.TOKEN;
const REQUIRED_MESSAGES = 500;
const COOLDOWN_TIME = 10 * 1000; // 10秒クールダウン
const WEEKLY_CHANNEL_ID = process.env.WEEKLY_CHANNEL_ID; // 宣伝チャンネルID
const DROPBOX_WEEKLY_PATH = '/app-data/userWeeklyMessages.json';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

let messageCounts = {}; // { 'guildId_userId': count }
let cooldowns = new Set();

// ==============================
// データロード
// ==============================
async function loadData() {
  try {
    await ensureDropboxInit();
    const data = await downloadFromDropbox(DROPBOX_WEEKLY_PATH);
    if (data) {
      messageCounts = JSON.parse(data);
      console.log('✅ 週間メッセージデータをDropboxからロードしました');
    } else {
      console.log('⚠️ Dropboxに週間メッセージデータが存在しません。新規作成します');
      messageCounts = {};
    }
  } catch (err) {
    console.error('❌ 週間メッセージデータのロードに失敗:', err);
    messageCounts = {};
  }
}

// ==============================
// データ保存
// ==============================
async function saveData() {
  try {
    await uploadToDropbox(DROPBOX_WEEKLY_PATH, JSON.stringify(messageCounts, null, 2));
    console.log('✅ 週間メッセージデータをDropboxに保存しました');
  } catch (err) {
    console.error('❌ 週間メッセージデータの保存に失敗:', err);
  }
}

// ==============================
// メッセージカウント処理
// ==============================
async function countMessage(message) {
  if (!message.guild || !message.member || message.author.bot) return;

  const key = `${message.guild.id}_${message.author.id}`;
  if (cooldowns.has(key)) return;

  if (!messageCounts[key]) messageCounts[key] = 0;
  messageCounts[key]++;

  cooldowns.add(key);
  setTimeout(() => cooldowns.delete(key), COOLDOWN_TIME);

  // 500メッセージ達成でチャンネル権限付与
  if (messageCounts[key] === REQUIRED_MESSAGES) {
    const channel = message.guild.channels.cache.get(WEEKLY_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      await channel.permissionOverwrites.edit(message.member, { SendMessages: true });
      await channel.send(`🎉 ${message.member} が週間メッセージ500達成！\n宣伝チャンネルが開放されました！`);
    }
  }

  await saveData();
}

// ==============================
// 週初めリセット
// ==============================
async function resetWeeklyChannel() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const channel = guild.channels.cache.get(WEEKLY_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) return;

  // 全員の権限をリセット
  await channel.permissionOverwrites.set([]);

  // メッセージカウントもリセット
  messageCounts = {};
  await saveData();

  console.log('✅ 週間メッセージカウント＆チャンネル権限をリセットしました');
}

// ==============================
// Bot起動
// ==============================
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await loadData();

  // 毎週月曜日0時に自動リセット
  setInterval(() => {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
      resetWeeklyChannel();
    }
  }, 60 * 1000); // 1分ごとにチェック
});

// ==============================
// メッセージイベント
// ==============================
client.on('messageCreate', async (message) => {
  await countMessage(message);
});

client.login(TOKEN);