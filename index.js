// index.js

require('dotenv').config();
const express = require('express');
const https = require('https');
const { Client, GatewayIntentBits, ActivityType, Partials, AuditLogEvent, ChannelType } = require('discord.js');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
if (!global.fetch) global.fetch = fetch;

const registerSlashCommands = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes, askQuiz } = require('./utils/quiz');
const { fetchWeather } = require('./utils/weather');
const { joinVoice, playUrl, stopMusic, leaveVoice } = require('./utils/music');

const { handleMemberJoin, handleMessage, handleReactionAdd, handleRoleUpdate, handleAuditLogEntry, handleMessageUpdate, handleBotAdd, pendingModActions, DANGER_ACTIONS } = require('./utils/anti-raid');
const { loadData, addXp } = require('./utils/level');
const { restoreRoles } = require('./utils/anti-raid');

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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
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
  preloadQuizzes();
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
    } catch (_) { }
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

// ==== 荒らし対策とコマンド処理 ====
client.on('messageCreate', async (message) => {
  // DMからのメッセージの場合
  if (message.channel.type === ChannelType.DM) {
    const pendingAction = pendingModActions.get(message.author.id);
    if (pendingAction) {
      const aiResponse = await chat(`ユーザーからの返信: "${message.content}"。
      この返信が、以前のサーバー操作（${AuditLogEvent[pendingAction.entry.action]}）の適切な理由として妥当かを判断してください。
      - 妥当と判断した場合は「適切」と、そうでない場合は「不適切」と回答してください。`, message.author.id);

      if (aiResponse.includes('適切')) {
        await message.reply('✅ 理由が確認されました。');
        await restoreRoles(await message.client.guilds.cache.get(pendingAction.entry.guild.id).members.fetch(message.author.id));
        pendingModActions.delete(message.author.id);
      } else {
        pendingAction.reasonAttempts++;
        if (pendingAction.reasonAttempts >= 3) {
          await message.reply('❌ 理由が不適切と判断されたため、権限を剥奪します。');
          const member = await message.client.guilds.cache.get(pendingAction.entry.guild.id).members.fetch(message.author.id);
          await member.roles.set([], 'DMでの理由確認が不適切');
          pendingModActions.delete(message.author.id);
        } else {
          await message.reply(`⚠️ 理由が不適切と判断されました。再提出してください。\n（残り${3 - pendingAction.reasonAttempts}回）`);
        }
      }
    }
    return;
  }

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

    case 'quiz':
      await askQuiz(message.channel, message.author, args[0]);
      break;

    case 'weather':
      if (args.length === 0) {
        return message.reply('❌ 都市名を入力してください。例: `!weather Tokyo`');
      }
      const location = args.join(' ');
      const weatherInfo = await fetchWeather(location);
      if (weatherInfo) {
        message.channel.send(weatherInfo);
      } else {
        message.reply('❌ 天気情報の取得に失敗しました。都市名を確認してください。');
      }
      break;

    default:
      handlePrefixMessage(client, message);
      break;
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  await handleMessageUpdate(oldMessage, newMessage);
});

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
    const welcomeMessage = `🟢 **${fetchedMember.user.tag}** がサーバーに参加しました！`;
    logChannel.send(welcomeMessage).catch(console.error);
  }
});

client.on('roleUpdate', async (oldRole, newRole) => {
    handleRoleUpdate(oldRole, newRole);
});


client.on('messageReactionAdd', async (reaction, user) => {
  await handleReactionAdd(reaction, user);

  if (user.bot) return;
  if (reaction.emoji.name === '👍') {
    if (reaction.message.author.id !== client.user.id) return;
    if (reaction.message.content.includes('クイズを続けますか？')) {
      await askQuiz(reaction.message.channel, user, 'mix');
    }
  }
});

// ★ 監査ログエントリ作成時のイベント
client.on('guildAuditLogEntryCreate', async (entry) => {
    await handleAuditLogEntry(entry);
});

client.login(TOKEN);
