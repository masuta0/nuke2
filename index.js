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
// --- anti-raid.js から必要なモジュールを全てインポート
const antiRaid = require('./utils/anti-raid'); 
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
  // handleMessage, // handleMessage は botのメッセージ処理と競合するため、ここではインポートしないが、後続で antiRaid.handleMessage として使う
} = antiRaid;
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
      // verify.js 内の buttonHandler を呼ぶ
      await verify.buttonHandler(interaction);
    } else if (interaction.isModalSubmit()) {
      // verify.js 内の modalHandler を呼ぶ
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

  // ★ 【追加】1時間ごとのハッシュクリーンアップ処理の実行設定
  setInterval(() => {
    // antiRaid モジュールから similarityTracker と定数を取得し、クリーンアップを実行
    for (const guildTracker of antiRaid.similarityTracker.values()) {
        antiRaid.cleanupSimilarityTracker(guildTracker, antiRaid.SIMILARITY_HASH_EXPIRY_MS);
    }
  }, antiRaid.CLEANUP_INTERVAL_MS);

  console.log(`[Anti-Raid] Hash cleanup started. (Interval: ${antiRaid.CLEANUP_INTERVAL_MS / 1000 / 60} minutes).`);

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
    // 顔画像判定（画像が含まれている場合）
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        if (attachment.contentType?.startsWith('image/')) {
          try {
            const match = await isSimilarFace(attachment.url);
            if (match) {
              await message.delete();
              console.log(`🧠 類似顔画像を削除しました: ${message.id}`);
              return;
            }
          } catch (err) {
            console.error('❌ 顔画像判定エラー:', err);
          }
        }
      }
    }

    // anti-raid.js のメッセージ処理を実行
    await antiRaid.handleMessage(message);
    if (message.author.bot) return;

    // サーバー全体アクティビティ
    if (message.guild && message.author.id && !message.author.bot) {
      await addMessage(message.guild.id, message.author.id, message.content);
    }

    // レベル処理
    if (message.member) await addXp(message.member);
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
client.on('messageUpdate', antiRaid.handleMessageUpdate); // antiRaidから直接呼び出し
client.on('guildMemberAdd', handleMemberJoin);
client.on('guildMemberRemove', onGuildMemberRemove);
client.on('guildMemberUpdate', onGuildMemberUpdate);
client.on('guildBanAdd', onGuildBanAdd);
client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);
// DM処理を追加
client.on('messageCreate', antiRaid.handleDirectMessage);

// --- ログイン ---
client.login(TOKEN);