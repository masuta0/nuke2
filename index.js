require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { Client, GatewayIntentBits, Partials, ActivityType, ChannelType, MessageActionRow, MessageButton } = require('discord.js');
const translate = require('@iamtraction/google-translate');
const fetch = require('node-fetch');
const { spawn } = require('child_process');

// ====== Discord Client ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildBans
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// ====== Express サーバー ======
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// ====== 定数・ストレージ ======
const TOKEN = process.env.TOKEN;
const CMD_PREFIX = '!';
const COOLDOWN_TIME = 10; // 秒
const cooldowns = new Map();
const ACTIVE_ROLE_ID = 'YOUR_ACTIVE_ROLE_ID'; // アクティブユーザーロールID
const ACTIVITY_FILE = '/app-data/userMonthlyMessages.json';
let activityData = {}; // { guildId: { userId: count } }

// ====== ユーティリティ ======
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function saveToDropbox(file, data) {
  // Dropbox 連携仮実装
  await fs.writeFile(file, JSON.stringify(data, null, 2));
  console.log(`✅ Dropboxに保存: ${file}`);
}

async function loadFromDropbox(file) {
  try {
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// ====== 活動管理 ======
async function addMessage(guildId, userId) {
  if (!activityData[guildId]) activityData[guildId] = {};
  if (!activityData[guildId][userId]) activityData[guildId][userId] = 0;
  activityData[guildId][userId] += 1;
  await saveToDropbox(ACTIVITY_FILE, activityData);
}

function getRanking(guildId) {
  if (!activityData[guildId]) return [];
  const entries = Object.entries(activityData[guildId]);
  entries.sort((a, b) => b[1] - a[1]);
  return entries;
}

async function updateActiveRoles(guild) {
  const ranking = getRanking(guild.id).slice(0, 3);
  const activeIds = ranking.map(e => e[0]);
  const role = guild.roles.cache.get(ACTIVE_ROLE_ID);
  if (!role) return;

  for (const [memberId, member] of guild.members.cache) {
    if (activeIds.includes(memberId)) {
      if (!member.roles.cache.has(ACTIVE_ROLE_ID)) await member.roles.add(role).catch(() => {});
    } else {
      if (member.roles.cache.has(ACTIVE_ROLE_ID)) await member.roles.remove(role).catch(() => {});
    }
  }
}

// ====== AIチャット（ダミー） ======
const aiCooldowns = new Map();
function checkAiCooldown(userId) {
  const last = aiCooldowns.get(userId) || 0;
  const diff = Math.floor((Date.now() - last) / 1000);
  return diff < 10 ? 10 - diff : 0;
}
function setAiCooldown(userId) { aiCooldowns.set(userId, Date.now()); }
async function chat(prompt, userId) { return `AI応答: ${prompt}`; }

// ====== メッセージイベント ======
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // メッセージ数カウント
  if (message.guild) await addMessage(message.guild.id, message.author.id);

  // クールダウンチェック
  if (cooldowns.has(message.author.id)) {
    const lastUsed = cooldowns.get(message.author.id);
    const remaining = (lastUsed + COOLDOWN_TIME * 1000) - Date.now();
    if (remaining > 0) {
      const warnMsg = await message.reply(`⚠️ コマンドはクールダウン中です。あと${Math.ceil(remaining / 1000)}秒`);
      setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      return;
    }
  }
  cooldowns.set(message.author.id, Date.now());

  // DM は無視
  if (message.channel.type === ChannelType.DM) return;

  // プレフィックスコマンド
  if (!message.content.startsWith(CMD_PREFIX)) return;
  const args = message.content.slice(1).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  switch (cmd) {
    case 'ping':
      await message.reply('Pong!');
      break;

    case 'ranking': {
      const ranking = getRanking(message.guild.id).slice(0, 10);
      if (ranking.length === 0) return message.reply('ランキングデータはありません');
      let text = '🏆 月間アクティブユーザーランキング 🏆\n';
      for (let i = 0; i < ranking.length; i++) {
        const [userId, count] = ranking[i];
        const member = await message.guild.members.fetch(userId).catch(() => null);
        const name = member ? member.user.username : '不明ユーザー';
        text += `${i + 1}位: **${name}** (${count} メッセージ)\n`;
      }
      await message.channel.send(text);
      await updateActiveRoles(message.guild);
      break;
    }

    case 'ai': {
      const remaining = checkAiCooldown(message.author.id);
      if (remaining > 0) return message.reply(`❌ AIは${remaining}秒クールダウン中`);
      setAiCooldown(message.author.id);
      const prompt = args.join(' ').trim();
      if (!prompt) return message.reply('❌ 使用例: !ai こんにちは');
      const thinkingMsg = await message.reply('💬 AIが考え中...');
      const res = await chat(prompt, message.author.id);
      await thinkingMsg.edit(res);
      break;
    }

    case '天気': {
      const loc = args.join(' ').trim();
      if (!loc) return message.reply('❌ 使用例: !天気 東京');
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(loc)}?format=3`).then(r => r.text());
        await message.reply(res);
      } catch { await message.reply('⚠️ 天気情報取得失敗'); }
      break;
    }

    default: {
      const langMap = { 英語:'en', 日本語:'ja', 中国語:'zh-CN', 韓国語:'ko', フランス語:'fr', スペイン語:'es', ドイツ語:'de' };
      if (!langMap[cmd]) return;
      const text = args.join(' ').trim();
      if (!text) return;
      const res = await translate(text, { to: langMap[cmd] });
      await message.reply(res.text || '翻訳失敗');
    }
  }
});

// ====== ボット稼働準備 ======
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  activityData = await loadFromDropbox(ACTIVITY_FILE);

  // ステータス更新
  const start = Date.now();
  setInterval(() => {
    const elapsed = Date.now() - start;
    const h = Math.floor(elapsed/1000/60/60);
    const m = Math.floor((elapsed/1000/60)%60);
    const s = Math.floor((elapsed/1000)%60);
    client.user.setActivity(`稼働中 | ${h}h ${m}m ${s}s`, { type: ActivityType.Watching }).catch(()=>{});
  }, 5000);
});

// ====== ログイン ======
client.login(TOKEN);