// index.js
require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials, ActivityType, ChannelType } = require('discord.js');

// ユーティリティ・モジュール
const registerSlashCommands = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes } = require('./utils/quiz');
const { addXp, loadData } = require('./utils/level');
const { restoreVerifyMessage } = require('./utils/verify');
const { setupWeekly, loadWeeklyData } = require('./utils/weeklyManager');
const {
  handleMemberJoin,
  handleMessage,
  handleReactionAdd,
  handleRoleUpdate,
  handleAuditLogEntry,
  handleMessageUpdate,
  onGuildMemberUpdate,
  onGuildBanAdd,
  onGuildMemberRemove,
} = require('./utils/anti-raid');
const { joinVoice, playAttachment, stopMusic, leaveVoice, playYouTube } = require('./utils/music');

// 定数
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const WEEKLY_CHANNEL_ID = process.env.WEEKLY_CHANNEL_ID;

// Discordクライアント作成
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
    GatewayIntentBits.GuildBans,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// Expressサーバー（監視用）
const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// Bot ready
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  await ensureDropboxInit();
  preloadQuizzes();
  await loadData();
  await restoreVerifyMessage(client);
  await loadWeeklyData();
  setupWeekly(client, WEEKLY_CHANNEL_ID);

  // スラッシュコマンド登録
  try {
    await registerSlashCommands(client);
    console.log('✅ スラッシュコマンド登録完了');
  } catch (e) {
    console.error('❌ スラッシュコマンド登録失敗:', e);
  }

  // 稼働時間ステータス更新
  const start = Date.now();
  const updateUptime = () => {
    const elapsed = Date.now() - start;
    const h = Math.floor(elapsed / 1000 / 60 / 60);
    const m = Math.floor((elapsed / 1000 / 60) % 60);
    const s = Math.floor((elapsed / 1000) % 60);
    try {
      client.user.setActivity(`稼働中 | ${h}h ${m}m ${s}s`, { type: ActivityType.Watching });
    } catch {}
  };
  updateUptime();
  setInterval(updateUptime, 2000);
});

// メッセージ作成イベント
client.on('messageCreate', async (message) => {
  if (message.author.bot) {
    await handleMessage(message);
    return;
  }

  await addXp(message.member);
  await handleMessage(message);

  if (message.channel?.type === ChannelType.DM) return;
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  switch (command) {
    // ボイスチャンネル参加
    case 'join':
      if (!message.member?.voice.channel)
        return message.reply('❌ ボイスチャンネルに参加してください');
      if (await joinVoice(message.guild, message.member.voice.channel)) {
        message.channel.send(`✅ **${message.member.voice.channel.name}** に参加しました！`);
      } else message.reply('❌ ボイスチャンネル参加失敗');
      break;

    // 再生コマンド（YouTube or 添付ファイル）
    case 'play': {
      if (!message.member?.voice.channel)
        return message.reply('❌ ボイスチャンネルに参加してください');

      const target = message.attachments.first()?.url || args[0];
      if (!target) return message.reply('⚠️ URL またはファイルを指定してください');

      if (target.includes('youtube.com') || target.includes('youtu.be')) {
        await playYouTube(message.guild.id, target, message.channel, message.member.voice.channel);
      } else {
        await playAttachment(message.guild.id, target, message.channel, message.member.voice.channel);
      }
      break;
    }

    case 'stop':
      message.channel.send(
        stopMusic(message.guild.id) ? '⏹️ 再生停止・キュークリア' : '❌ 再生中の曲なし'
      );
      break;

    case 'leave':
      await leaveVoice(message.guild.id);
      message.channel.send('👋 ボイスチャンネル退出しました');
      break;
  }
});

// メッセージ更新
client.on('messageUpdate', handleMessageUpdate);

// メンバー入室 / 退室
client.on('guildMemberAdd', handleMemberJoin);
client.on('guildMemberRemove', onGuildMemberRemove);
client.on('guildMemberUpdate', onGuildMemberUpdate);
client.on('guildBanAdd', onGuildBanAdd);
client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);

// ログイン
client.login(TOKEN);