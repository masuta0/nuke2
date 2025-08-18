// index.js
require('dotenv').config();
const express = require('express');
const https = require('https');
const fetch = require('node-fetch'); // Dropbox SDK & Node<18 互換
if (!global.fetch) global.fetch = fetch;

const { Client, GatewayIntentBits, ActivityType, Partials } = require('discord.js');

const registerSlashCommands = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes } = require('./utils/quiz');
const { loadAllLocalWeatherPrefsIfAny } = require('./utils/weather');

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
client.on('messageCreate', (msg) => handlePrefixMessage(client, msg));

// ==== AIリプライ（メンション時）====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.mentions.has(client.user)) {
    const prompt = msg.content.replace(/<@!?(\d+)>/, '').trim();
    if (!prompt) return;
    const res = await chat(prompt, msg.author.id);
    await msg.reply(res || '⚠️ 返答に失敗しました');
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