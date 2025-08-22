// index.js

require('dotenv').config();
const express = require('express');
const https = require('https');
const { Client, GatewayIntentBits, ActivityType, Partials, AuditLogEvent, PermissionsBitField, ChannelType } = require('discord.js');
const path = require('path');
const fs = require('fs');

const registerSlashCommands = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { ensureDropboxInit, uploadToDropbox, downloadFromDropbox } = require('./utils/storage');
const { preloadQuizzes, askQuiz } = require('./utils/quiz');
const { fetchWeather } = require('./utils/weather');
const { joinVoice, playUrl, stopMusic, leaveVoice } = require('./utils/music');

const {
  handleMemberJoin,
  handleMessage,
  handleReactionAdd,
  handleRoleUpdate,
  handleAuditLogEntry,
  handleMessageUpdate,
  handleBotAdd,
  onGuildMemberUpdate,
  onGuildBanAdd,
  onGuildMemberRemove,
  pendingModActions,
  restoreRoles,
} = require('./utils/anti-raid');
const { loadData, addXp } = require('./utils/level');
const { hasManageGuildPermission, backupServerState, restoreServerState } = require('./utils/anti-raid');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const JOIN_LOG_CHANNEL_ID = '1407669514425860136'; // Join log channel ID

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
    GatewayIntentBits.GuildBans, // guildBanAddで必要
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

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

client.on('messageCreate', async (message) => {
  if (message.author.bot) {
    await handleMessage(message);
    return;
  }

  await addXp(message.member);
  await handleMessage(message);

  if (message.channel.type === ChannelType.DM) {
    const pendingAction = pendingModActions.get(message.author.id);
    if (pendingAction) {
      const isAppropriate = await isReasonAppropriate(pendingAction.entry, message.content);
      if (isAppropriate === '適切') {
        await message.reply('✅ 理由が適切と判断されました。ロールを復元します。');
        await restoreRoles(await message.client.guilds.cache.get(pendingAction.entry.guildId).members.fetch(message.author.id));
        pendingModActions.delete(message.author.id);
      } else {
        pendingAction.reasonAttempts++;
        if (pendingAction.reasonAttempts >= 3) {
          await message.reply('❌ 理由が不適切と判断されたため、権限剥奪を継続します。');
          pendingModActions.delete(message.author.id);
        } else {
          await message.reply(`⚠️ 理由が不適切と判断されました。再提出してください。（残り${3 - pendingAction.reasonAttempts}回）`);
        }
      }
      return;
    }
  }

  if (!message.content.startsWith('!')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

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
    case 'backup':
      if (!hasManageGuildPermission(message.member)) return message.reply('⚠️ 管理者権限が必要です');
      await backupServerState(message.guild);
      message.reply('✅ サーバー構成をバックアップしました');
      break;
    case 'restore':
      if (!hasManageGuildPermission(message.member)) return message.reply('⚠️ 管理者権限が必要です');
      await restoreServerState(message.guild);
      message.reply('✅ サーバー構成を復元しました');
      break;
    default:
      handlePrefixMessage(client, message);
      break;
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  await handleMessageUpdate(oldMessage, newMessage);
});

client.on('guildMemberAdd', handleMemberJoin);
client.on('guildMemberRemove', onGuildMemberRemove);
client.on('guildMemberUpdate', onGuildMemberUpdate);
client.on('guildBanAdd', onGuildBanAdd);
client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);

client.login(TOKEN);
