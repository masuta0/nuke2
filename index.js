// index.js
require('dotenv').config();
const express = require('express');
const https = require('https');
const { Client, GatewayIntentBits, ActivityType, Partials } = require('discord.js');

// `node-fetch` v3以降はESM形式のため、動的インポートを使用
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
if (!global.fetch) global.fetch = fetch;

const registerSlashCommands = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes } = require('./utils/quiz');
const { loadAllLocalWeatherPrefsIfAny } = require('./utils/weather');

// 音楽再生機能のインポート
const { joinVoice, playUrl, stopMusic, leaveVoice } = require('./utils/music');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;

// ==== Discord Client ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
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

  await ensureDropboxInit();
  await preloadQuizzes();
  await loadAllLocalWeatherPrefsIfAny();

  const start = Date.now();
  const updateUptimeStatus = () => {
    const elapsed = Date.now() - start;
    const h = Math.floor(elapsed / 1000 / 60 / 60);
    const m = Math.floor((elapsed / 1000 / 60) % 60);
    const s = Math.floor((elapsed / 1000) % 60);
    const text = `稼働中 | ${h}h ${m}m ${s}s`;
    try {
      client.user.setActivity(text, { type: ActivityType.Watching });
    } catch (_) { }
  };
  updateUptimeStatus();
  setInterval(updateUptimeStatus, 5000);

  try {
    await registerSlashCommands(client);
    console.log('✅ スラッシュコマンド登録完了');
  } catch (e) {
    console.error('❌ スラッシュコマンド登録失敗:', e);
  }
});

// ==== Message: Prefix (!...) ====
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) {
    // メンション応答ロジックをここに移動
    if (message.mentions.has(client.user)) {
      const prompt = message.content.replace(/<@!?(\d+)>/, '').trim();
      if (!prompt) return;
      const res = await chat(prompt, message.author.id);
      await message.reply(res || '⚠️ 返答に失敗しました');
    }
    return;
  }

  // Prefixコマンド処理
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // 音楽コマンドの追加
  switch (command) {
    case 'join':
      if (!message.member?.voice.channel) {
        return message.reply('❌ ボイスチャンネルに参加してからコマンドを実行してください。');
      }
      const joinSuccess = await joinVoice(message.guild, message.member.voice.channel);
      if (joinSuccess) {
        message.channel.send(`✅ **${message.member.voice.channel.name}** に参加しました！`);
      } else {
        message.reply('❌ ボイスチャンネルへの参加に失敗しました。');
      }
      break;

    case 'play':
      if (!message.member?.voice.channel) {
        return message.reply('❌ ボイスチャンネルに参加してからコマンドを実行してください。');
      }
      const query = args.join(' ');
      if (!query) {
        return message.reply('❌ 再生したい曲名またはURLを入力してください。');
      }
      const title = await playUrl(message.guild.id, query, message.channel);
      if (title) {
        message.channel.send(`▶️ 再生キューに追加: **${title}**`);
      } else {
        message.channel.send('❌ 申し訳ありません、曲が見つかりませんでした。');
      }
      break;

    case 'stop':
      const stopped = stopMusic(message.guild.id);
      if (stopped) {
        message.channel.send('⏹️ 再生を停止し、キューをクリアしました。');
      } else {
        message.reply('❌ 再生中の曲はありません。');
      }
      break;

    case 'leave':
      await leaveVoice(message.guild.id);
      message.channel.send('👋 ボイスチャンネルから退出しました。');
      break;

    // 既存のprefixコマンドハンドラーを呼び出す
    default:
      handlePrefixMessage(client, message);
      break;
  }
});

// ==== クイズ 続行リアクション ====
const { askQuiz } = require('./utils/quiz');
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name === '👍') {
    if (reaction.message.author.id !== client.user.id) return;
    if (reaction.message.content.includes('クイズを続けますか？')) {
      await askQuiz(reaction.message.channel, user, 'mix');
    }
  }
});

// ==== Login ====
client.login(TOKEN);
