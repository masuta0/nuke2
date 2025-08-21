require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const https = require('https');
const { Client, GatewayIntentBits, ActivityType, Partials, AuditLogEvent } = require('discord.js');

// utils
const registerSlashCommands = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { ensureDropboxInit, uploadToDropbox, downloadFromDropbox } = require('./utils/storage');
const { preloadQuizzes, askQuiz } = require('./utils/quiz');
const { loadAllLocalWeatherPrefsIfAny } = require('./utils/weather');
const { joinVoice, playUrl, stopMusic, leaveVoice } = require('./utils/music');
const { handleMemberJoin, handleMessage, handleReactionAdd, handleRoleUpdate, handleAuditLogEntry, handleMessageUpdate, handleBotAdd } = require('./utils/anti-raid');
const { loadData, addXp } = require('./utils/level');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const JOIN_LOG_CHANNEL_ID = '1407669514425860136';

// ==== Discord Client ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// ==== Express Keep-Alive ====
const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

if (process.env.SELF_URL) {
  setInterval(() => {
    https
      .get(process.env.SELF_URL, res => console.log(`Keep-Alive: ${res.statusCode}`))
      .on('error', err => console.error('Keep-Alive error:', err.message));
  }, 4 * 60 * 1000);
}

// ==== Ready ====
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  await ensureDropboxInit(); // Dropbox初期化

  preloadQuizzes();
  await loadAllLocalWeatherPrefsIfAny();
  await loadData();

  const start = Date.now();
  const updateUptimeStatus = () => {
    const elapsed = Date.now() - start;
    const h = Math.floor(elapsed / 1000 / 60 / 60);
    const m = Math.floor((elapsed / 1000 / 60) % 60);
    const s = Math.floor((elapsed / 1000) % 60);
    const text = `稼働中 | ${h}h ${m}m ${s}s`;
    try {
      client.user.setActivity(text, { type: ActivityType.Watching });
    } catch (_) {}
  };
  updateUptimeStatus();
  setInterval(updateUptimeStatus, 2000);

  try {
    await registerSlashCommands(client);
    console.log('✅ スラッシュコマンド登録完了');
  } catch (e) {
    console.error('❌ スラッシュコマンド登録失敗:', e);
  }
});

// ==== メッセージイベント ====
client.on('messageCreate', async (message) => {
  await handleMessage(message);

  if (message.author.bot) return;

  await addXp(message.member);

  if (!message.content.startsWith('!')) {
    if (message.mentions.has(client.user) && !message.mentions.everyone) {
      const prompt = message.content.replace(/<@!?(\d+)>/, '').trim();
      if (!prompt) return;
      const res = await chat(prompt, message.author.id);
      await message.reply(res || '⚠️ 返答に失敗しました');
    }
    return;
  }

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  switch (command) {
    case 'join':
      if (!message.member?.voice.channel) return message.reply('❌ ボイスチャンネルに参加してください');
      if (await joinVoice(message.guild, message.member.voice.channel)) {
        message.channel.send(`✅ **${message.member.voice.channel.name}** に参加しました！`);
      } else {
        message.reply('❌ ボイスチャンネルへの参加に失敗しました。');
      }
      break;

    case 'play':
      if (!message.member?.voice.channel) return message.reply('❌ ボイスチャンネルに参加してください');
      const query = args.join(' ');
      if (!query) return message.reply('❌ 曲名またはURLを入力してください');
      const title = await playUrl(message.guild.id, query, message.channel);
      message.channel.send(title ? `▶️ 再生キューに追加: **${title}**` : '❌ 曲が見つかりませんでした');
      break;

    case 'stop':
      const stopped = stopMusic(message.guild.id);
      message.channel.send(stopped ? '⏹️ 再生を停止し、キューをクリアしました' : '❌ 再生中の曲はありません');
      break;

    case 'leave':
      await leaveVoice(message.guild.id);
      message.channel.send('👋 ボイスチャンネルから退出しました');
      break;

    case 'uploadquiz':
      if (!fs.existsSync('./quizzes.json')) return message.reply('❌ quizzes.json が存在しません');
      const contents = fs.readFileSync('./quizzes.json');
      const result = await uploadToDropbox('/quizzes.json', contents);
      message.reply(result ? '✅ Dropboxにアップロードしました' : '❌ アップロード失敗');
      break;

    case 'downloadquiz':
      const data = await downloadFromDropbox('/quizzes.json');
      if (data) {
        fs.writeFileSync('./quizzes.json', JSON.stringify(data, null, 2));
        message.reply('✅ Dropboxからダウンロードしました');
      } else {
        message.reply('❌ ダウンロード失敗');
      }
      break;

    default:
      handlePrefixMessage(client, message);
      break;
  }
});

// ==== 他のイベント（メンバー参加、ロール更新、リアクション、監査ログなど） ====
client.on('guildMemberAdd', async (member) => {
  const fetchedMember = await member.guild.members.fetch(member.id).catch(() => null);
  if (!fetchedMember) return;

  if (fetchedMember.user.bot) {
    const isKicked = await handleBotAdd(fetchedMember);
    if (isKicked) return;
  }

  handleMemberJoin(fetchedMember);
  const logChannel = member.guild.channels.cache.get(JOIN_LOG_CHANNEL_ID);
  if (logChannel) {
    logChannel.send(`🟢 **${fetchedMember.user.tag}** がサーバーに参加しました！`).catch(console.error);
  }
});

client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', async (reaction, user) => {
  await handleReactionAdd(reaction, user);
  if (user.bot) return;
  if (reaction.emoji.name === '👍' && reaction.message.author.id === client.user.id && reaction.message.content.includes('クイズを続けますか？')) {
    await askQuiz(reaction.message.channel, user, 'mix');
  }
});
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);

// ==== Login ====
client.login(TOKEN);