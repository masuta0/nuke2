// utils/weeklyManager.js
require('dotenv').config();
const { PermissionsBitField } = require('discord.js');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./storage');
const path = require('path');

const REQUIRED_MESSAGES = 500;
const COOLDOWN_TIME = 10 * 1000; // 10秒クールダウン
const DROPBOX_WEEKLY_PATH = '/app-data/userWeeklyMessages.json';

let messageCounts = {}; // { 'guildId_userId': count }
let cooldowns = new Set();

/**
 * Dropboxからデータロード
 */
async function loadWeeklyData() {
  try {
    await ensureDropboxInit();
    const data = await downloadFromDropbox(DROPBOX_WEEKLY_PATH);
    messageCounts = data ? JSON.parse(data) : {};
    console.log('✅ 週間メッセージデータをDropboxからロードしました');
  } catch (err) {
    console.error('❌ 週間メッセージデータのロードに失敗:', err);
    messageCounts = {};
  }
}

/**
 * Dropboxへデータ保存
 */
async function saveWeeklyData() {
  try {
    await uploadToDropbox(DROPBOX_WEEKLY_PATH, JSON.stringify(messageCounts, null, 2));
    console.log('✅ 週間メッセージデータをDropboxに保存しました');
  } catch (err) {
    console.error('❌ 週間メッセージデータの保存に失敗:', err);
  }
}

/**
 * メッセージカウント処理
 */
async function handleMessage(message, weeklyChannelId) {
  if (!message.guild || !message.member || message.author.bot) return;

  const key = `${message.guild.id}_${message.author.id}`;
  if (cooldowns.has(key)) return;

  if (!messageCounts[key]) messageCounts[key] = 0;
  messageCounts[key]++;

  cooldowns.add(key);
  setTimeout(() => cooldowns.delete(key), COOLDOWN_TIME);

  if (messageCounts[key] === REQUIRED_MESSAGES) {
    const channel = message.guild.channels.cache.get(weeklyChannelId);
    if (channel?.isTextBased()) {
      await channel.permissionOverwrites.edit(message.member, { SendMessages: true });
      await channel.send(
        `🎉 ${message.member} が週間メッセージ500達成！\n宣伝チャンネルが開放されました！`
      );
    }
  }

  await saveWeeklyData();
}

/**
 * 週初めに全員権限リセット
 */
async function resetWeeklyChannel(client, weeklyChannelId) {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const channel = guild.channels.cache.get(weeklyChannelId);
  if (!channel?.isTextBased()) return;

  await channel.permissionOverwrites.set([]);
  messageCounts = {};
  await saveWeeklyData();

  console.log('✅ 週間メッセージカウント＆チャンネル権限をリセットしました');
}

/**
 * Botにイベントを登録してweekly監視を開始
 */
function setupWeekly(client, weeklyChannelId) {
  client.on('messageCreate', async (message) => {
    await handleMessage(message, weeklyChannelId);
  });

  // 毎週月曜日0時に自動リセット
  setInterval(() => {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
      resetWeeklyChannel(client, weeklyChannelId);
    }
  }, 60 * 1000); // 1分ごとにチェック
}

module.exports = { setupWeekly, loadWeeklyData, resetWeeklyChannel };