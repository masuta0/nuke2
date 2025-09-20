// index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
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

// 音楽ユーティリティ（playDLをindexで直接使わない）
const { joinVoice, playAttachment, playYouTube, stopMusic, leaveVoice } = require('./utils/music');

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

  try {
    await ensureDropboxInit();
  } catch (e) {
    console.warn('Dropbox init failed:', e);
  }

  try {
    preloadQuizzes();
  } catch (e) {
    console.warn('preloadQuizzes failed:', e);
  }

  try {
    await loadData();
  } catch (e) {
    console.warn('loadData failed:', e);
  }

  try {
    await restoreVerifyMessage(client);
  } catch (e) {
    console.warn('restoreVerifyMessage failed:', e);
  }

  try {
    await loadWeeklyData();
    setupWeekly(client, WEEKLY_CHANNEL_ID);
  } catch (e) {
    console.warn('weekly setup failed:', e);
  }

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
    } catch (e) {
      /* ignore */
    }
  };
  updateUptime();
  setInterval(updateUptime, 2000);
});

// メッセージ作成イベント
client.on('messageCreate', async (message) => {
  // bot のメッセージは anti-raid の handleMessage に渡して終了
  if (message.author.bot) {
    await handleMessage(message);
    return;
  }

  // XP 加算・モデレーション等
  try {
    await addXp(message.member);
  } catch (e) {
    console.warn('addXp failed:', e);
  }
  try {
    await handleMessage(message);
  } catch (e) {
    console.warn('handleMessage failed:', e);
  }

  // DM はプレフィックスコマンドの対象外
  if (message.channel?.type === ChannelType.DM) return;

  // プレフィックスコマンド検出
  if (!message.content.startsWith('!')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  try {
    switch (command) {
      // ボイスチャンネル参加
      case 'join':
        if (!message.member?.voice.channel)
          return message.reply('❌ ボイスチャンネルに参加してください');
        if (await joinVoice(message.guild, message.member.voice.channel)) {
          message.channel.send(`✅ **${message.member.voice.channel.name}** に参加しました！`);
        } else {
          message.reply('❌ ボイスチャンネル参加失敗');
        }
        break;

      // 添付ファイル or URL 再生（統合）
      case 'play': {
        if (!message.member?.voice.channel)
          return message.reply('❌ ボイスチャンネルに参加してください');

        // 優先：添付ファイル、なければ引数（URL）
        const attachmentUrl = message.attachments.first()?.url;
        const providedUrl = args.join(' ').trim() || null;
        const target = attachmentUrl || providedUrl;

        if (!target) return message.reply('⚠️ 添付ファイルかURLを指定してください');

        // まず VC に接続（joinVoice は内部で joinVoiceChannel を呼んで接続を確立する実装を想定）
        const ok = await joinVoice(message.guild, message.member.voice.channel);
        if (!ok) return message.reply('⚠️ VC に接続できませんでした');

        // 判定：YouTube の URL かどうか（簡易判定）
        const isYouTube = /(?:youtube\.com\/watch\?v=|youtu\.be\/)/i.test(target);

        if (isYouTube) {
          // utils/music.js 内の playYouTube を呼ぶ（内部で play-dl / yt-dlp 等を扱う）
          const success = await playYouTube(message.guild.id, target, message.channel, message.member.voice.channel);
          return message.reply(success ? '▶️ YouTube を再生中です' : '⚠️ YouTube の再生に失敗しました');
        } else {
          // 通常は添付ファイルや直接リンクを再生
          const success = await playAttachment(message.guild.id, target, message.channel, message.member.voice.channel);
          return message.reply(success ? '▶️ 再生中です' : '⚠️ 再生に失敗しました');
        }
      }

      // 再生停止
      case 'stop':
        message.channel.send(
          stopMusic(message.guild.id) ? '⏹️ 再生停止・キュークリア' : '❌ 再生中の曲なし'
        );
        break;

      // VC 退出
      case 'leave':
        await leaveVoice(message.guild.id);
        message.channel.send('👋 ボイスチャンネル退出しました');
        break;

      // Dropbox クイズアップロード
      case 'uploadquiz':
        try {
          const contents = await fs.readFile(path.join(__dirname, 'quizzes.json'));
          const result = await uploadToDropbox('/quizzes.json', contents.toString());
          message.reply(result ? '✅ Dropboxにアップロードしました' : '❌ アップロード失敗');
        } catch (err) {
          message.reply(err.code === 'ENOENT' ? '❌ quizzes.json が存在しません' : `❌ エラー: ${err.message}`);
        }
        break;

      // Dropbox クイズダウンロード
      case 'downloadquiz':
        try {
          const data = await downloadFromDropbox('/quizzes.json');
          if (data) await fs.writeFile(path.join(__dirname, 'quizzes.json'), data);
          message.reply(data ? '✅ Dropboxからダウンロード' : '❌ ダウンロード失敗');
        } catch (err) {
          message.reply(`❌ ダウンロード中エラー: ${err.message}`);
        }
        break;

      // AI チャット
      case 'ai': {
        const prompt = args.join(' ').trim();
        if (!prompt) return message.reply('❌ 使用例: `!ai こんにちは`');
        const thinking = await message.reply('💬 AIが考え中...');
        try {
          const res = await chat(prompt, message.author.id);
          await thinking.edit(res || '⚠️ AIの応答に失敗しました');
        } catch (e) {
          console.error('!ai error:', e);
          await thinking.edit('❌ AIとの通信中にエラーが発生しました。');
        }
        break;
      }

      // その他は既存のハンドラへ委譲
      default:
        handlePrefixMessage(client, message);
        break;
    }
  } catch (err) {
    console.error('Prefix command error:', err);
  }
}); // ← messageCreate イベントの閉じカッコ

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