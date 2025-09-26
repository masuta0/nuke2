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

const { initFaceRecognition, isSimilarFace, registerFace } = require('./utils/face');
const { registerSlashCommands, handleSlashCommand } = require("./commands/slash");
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes } = require('./utils/quiz');
const { addXp, loadData: loadLevelData } = require('./utils/level');
const { restoreVerifyMessage } = require('./utils/verify');
const { setupWeekly, loadWeeklyData } = require('./utils/weeklyManager');

// --- anti-raid.js から必要なモジュールを全てインポート ---
const antiRaid = require('./utils/anti-raid'); 
const {
  handleMemberJoin,
  handleReactionAdd,
  handleRoleUpdate,
  handleAuditLogEntry,
  handleMessageUpdate,
  onGuildMemberUpdate,
  onGuildBanAdd,
  onGuildMemberRemove,
} = antiRaid;

const { addMessage, loadActivity, resetMonthlyActivity } = require('./utils/activity');
const verify = require('./utils/verify');

// --- 設定 ---
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT;
const WEEKLY_CHANNEL_ID = process.env.WEEKLY_CHANNEL_ID || null;
const CLIENT_ID = process.env.CLIENT_ID;

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
  }// Bot Ready イベントの修正版
client.once(‘ready’, async () => {
console.log(`✅ Logged in as ${client.user.tag}`);

try {
// 顔認識初期化
await initFaceRecognition();
console.log(‘⚡ 顔認識初期化完了’);

```
// --- 顔登録（エラーハンドリング追加） ---
try {
  // 元のURL: https://i.imgur.com/DkoHDM9.png
  // .jpg 拡張子を明示的に指定してみる
  await registerFace('https://i.imgur.com/DkoHDM9.jpg');
  console.log('✅ 自分の顔を登録しました');
} catch (faceError) {
  console.error('❌ 顔登録失敗:', faceError.message);
  console.log('⚠️ 顔登録をスキップして続行します...');

  // 代替案: 異なる形式のURLを試す
  try {
    console.log('🔄 代替画像URLで再試行...');
    await registerFace('https://i.imgur.com/DkoHDM9.png');
    console.log('✅ 代替URLで顔登録成功');
  } catch (altError) {
    console.error('❌ 代替URLでも失敗:', altError.message);
    console.log('ℹ️ 手動で顔を登録してください: /register-face コマンドを使用');
  }
}

// 既存の初期化処理
await ensureDropboxInit();
await loadActivity();
await loadLevelData();
preloadQuizzes();
await restoreVerifyMessage(client);
await loadWeeklyData();
setupWeekly(client, WEEKLY_CHANNEL_ID);

// スラッシュコマンド登録
await registerSlashCommands(CLIENT_ID, TOKEN);
console.log('✅ スラッシュコマンド登録完了');
```

} catch (err) {
console.error(‘❌ Readyイベント初期化エラー:’, err);
}

// 1時間ごとのハッシュクリーンアップ
setInterval(() => {
for (const guildTracker of antiRaid.similarityTracker.values()) {
antiRaid.cleanupSimilarityTracker(guildTracker, antiRaid.SIMILARITY_HASH_EXPIRY_MS);
}
}, antiRaid.CLEANUP_INTERVAL_MS);
console.log(`[Anti-Raid] Hash cleanup started.`);

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
// --- メッセージ処理 ---
client.on('messageCreate', async (message) => {
  try {
    // 顔画像判定
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        if (attachment.contentType?.startsWith('image/')) {
          try {
            const match = await isSimilarFace(attachment.url);
            if (match) {
              await message.delete();
              console.log(`🧠 類似顔画像を削除しました: ${message.id}`);

              // 1週間タイムアウト
              const member = message.member;
              if (member?.manageable) {
                await member.timeout(7 * 24 * 60 * 60 * 1000, '顔画像投稿による自動タイムアウト');
                console.log(`⏱ 1週間タイムアウト: ${member.user.tag}`);
              }

              // ログ送信
              const logChannel = await client.channels.fetch('1405660583025709106');
              if (logChannel?.isTextBased()) {
                await logChannel.send({
                  content: `🧹 類似顔画像を削除 & 1週間タイムアウトを実行しました。\n投稿者: <@${message.author.id}>\nチャンネル: <#${message.channel.id}>`,
                  allowedMentions: { users: [], roles: [] }
                });
              }

              return;
            }
          } catch (err) {
            console.error('❌ 顔画像判定エラー:', err);
          }
        }
      }
    }

    // anti-raid.js メッセージ処理
    await antiRaid.handleMessage(message);
    if (message.author.bot) return;

    if (message.guild && message.author.id && !message.author.bot) {
      await addMessage(message.guild.id, message.author.id, message.content);
    }

    if (message.member) await addXp(message.member);
    if (message.channel?.type === ChannelType.DM) return;

    if (!message.content.startsWith('!')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

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
client.on('messageUpdate', antiRaid.handleMessageUpdate);
client.on('guildMemberAdd', handleMemberJoin);
client.on('guildMemberRemove', onGuildMemberRemove);
client.on('guildMemberUpdate', onGuildMemberUpdate);
client.on('guildBanAdd', onGuildBanAdd);
client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);
client.on('messageCreate', antiRaid.handleDirectMessage);

// --- ログイン ---
client.login(TOKEN);
