// index.js
const cron = require('node-cron');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  ActivityType, 
  ChannelType 
} = require('discord.js');

const { 
  joinVoice, 
  playUrl, 
  stopMusic, 
  leaveVoice 
} = require('./utils/music');

const { registerSlashCommands, handleSlashCommand } = require("./commands/slash");
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes } = require('./utils/quiz');
const { addXp, loadData: loadLevelData } = require('./utils/level');
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
const { addMessage, loadActivity, resetMonthlyActivity } = require('./utils/activity');

// verify.js を読み込み
const verify = require('./utils/verify');

// --- 設定 ---
const TOKEN = process.env.TOKEN || 'YOUR_TOKEN_HERE';
const PORT = process.env.PORT || 3000;
const WEEKLY_CHANNEL_ID = process.env.WEEKLY_CHANNEL_ID || null;
const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_CLIENT_ID_HERE'; // スラッシュ用

// --- app-data作成 ---
const APP_DATA_DIR = path.join(__dirname, 'app-data');
if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });

// --- Discord Client ---
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

// --- Express ---
const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// --- interactionCreate: スラッシュ/ボタン/モーダル ---
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      await verify.buttonHandler(interaction);
    } else if (interaction.isModalSubmit()) {
      await verify.modalHandler(interaction);
    }
  } catch (err) {
    console.error('❌ interactionCreateでエラー:', err);
  }
});

// --- Bot Ready ---
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    await ensureDropboxInit();
    await loadActivity(); // 月間・週間アクティビティロード
    await loadLevelData(); // レベルデータロード
  } catch (err) {
    console.error('❌ 初期化エラー:', err);
  }

  preloadQuizzes();
  await restoreVerifyMessage(client);
  await loadWeeklyData();
  setupWeekly(client, WEEKLY_CHANNEL_ID);

  // スラッシュコマンド登録
  try {
    await registerSlashCommands(CLIENT_ID, TOKEN);
    console.log('✅ スラッシュコマンド登録完了');
  } catch (err) {
    console.error('❌ スラッシュコマンド登録失敗:', err);
  }

  // 稼働時間ステータス
  const start = Date.now();
  setInterval(() => {
    const elapsed = Date.now() - start;
    const h = Math.floor(elapsed / 1000 / 60 / 60);
    const m = Math.floor((elapsed / 1000 / 60) % 60);
    const s = Math.floor((elapsed / 1000) % 60);
    try {
      client.user.setActivity(`稼働中 | ${h}h ${m}m ${s}s`, { type: ActivityType.Watching });
    } catch {}
  }, 5000);
});

// --- メッセージイベント ---
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return handleMessage(message);

    // サーバー全体アクティビティ
    if (message.guild && message.author.id && !message.author.bot) {
      await addMessage(message.guild.id, message.author.id, message.content);
    }

    // レベル
    if (message.member) await addXp(message.member);

    await handleMessage(message);

    if (message.channel?.type === ChannelType.DM) return;

    if (!message.content.startsWith('!')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    // 雑談チャンネルで !ranking 禁止
    if (command === 'ranking' && message.channel.name.includes('雑談')) {
      const warn = await message.reply('❌ このチャンネルでは !ranking は使えません');
      setTimeout(() => warn.delete().catch(() => {}), 5000);
      message.delete().catch(() => {});
      return;
    }

    switch (command) {
      case 'join':
        if (!message.member?.voice?.channel) return message.reply('❌ ボイスチャンネルに参加してください');
        if (await joinVoice(message.guild, message.member.voice.channel)) {
          message.channel.send(`✅ **${message.member.voice.channel.name}** に参加しました！`);
        } else message.reply('❌ ボイスチャンネル参加失敗');
        break;

      case 'play':
        if (!message.member?.voice?.channel) return message.reply('❌ ボイスチャンネルに参加してください');
        try {
          await joinVoice(message.guild, message.member.voice.channel);
          const musicTitle = await playUrl(message.guild.id, args.join(' '), message.channel, message.member.voice.channel);
          await message.channel.send(musicTitle ? `▶️ 再生キューに追加: **${musicTitle}**` : '❌ 曲が見つかりません');
        } catch {
          await message.reply('❌ 再生中にエラーが発生しました');
        }
        break;

      case 'stop':
        message.channel.send(stopMusic(message.guild.id) ? '⏹️ 再生停止・キュークリア' : '❌ 再生中の曲なし');
        break;

      case 'leave':
        await leaveVoice(message.guild.id);
        message.channel.send('👋 ボイスチャンネル退出しました');
        break;

      case 'ai':
        const prompt = args.join(' ').trim();
        if (!prompt) return message.reply('❌ 使用例: `!ai こんにちは`');
        const replyMsg = await message.reply('💬 AIが考え中...');
        try {
          const aiResponse = await chat(prompt, message.author.id);
          await replyMsg.edit(aiResponse || 'AIからの応答に失敗しました。');
        } catch {
          await replyMsg.edit('❌ AIとの通信中にエラーが発生しました。');
        }
        break;

      default:
        await handlePrefixMessage(client, message);
        break;
    }
  } catch (err) {
    console.error('❌ messageCreate処理でエラー:', err);
  }
});

// --- cron: 毎月1日0時に月間リセット ---
cron.schedule('0 0 1 * *', async () => {
  try { await resetMonthlyActivity(client); } 
  catch (err) { console.error('❌ 月間リセット失敗:', err); }
});

// --- その他イベント ---
client.on('messageUpdate', handleMessageUpdate);
client.on('guildMemberAdd', handleMemberJoin);
client.on('guildMemberRemove', onGuildMemberRemove);
client.on('guildMemberUpdate', onGuildMemberUpdate);
client.on('guildBanAdd', onGuildBanAdd);
client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);

// --- ログイン ---
client.login(TOKEN);