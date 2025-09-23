// index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { Client, GatewayIntentBits, Partials, ActivityType, ChannelType } = require('discord.js');
const { joinVoice, playUrl, stopMusic, leaveVoice } = require('./utils/music');
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

// 追加: activity.js の読み込み
const { addMessage } = require('./utils/activity');

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

  // メッセージ数カウント (月間アクティブ用)
  if (message.guild) {
    addMessage(message.guild.id, message.author.id);
  }

  // レベルシステム
  if (message.member) {
    await addXp(message.member);
  }

  await handleMessage(message);

  // DMでのモデレーション対応
  if (message.channel?.type === ChannelType.DM) return;

  // === プレフィックスコマンド ===
  if (!message.content.startsWith('!')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  switch (command) {
    // 音楽
    case 'join': {
      if (!message.member?.voice.channel) return message.reply('❌ ボイスチャンネルに参加してください');
      if (await joinVoice(message.guild, message.member.voice.channel)) {
        message.channel.send(`✅ **${message.member.voice.channel.name}** に参加しました！`);
      } else {
        message.reply('❌ ボイスチャンネル参加失敗');
      }
      break;
    }
    case 'play': {
      const query = args.join(' ');
      if (!query) return message.reply('❌ 曲名またはURLを入力してください');
      const voiceChannel = message.member?.voice.channel;
      if (!voiceChannel) return message.reply('❌ ボイスチャンネルに参加してください');

      try {
        // VC接続して再生
        await joinVoice(message.guild, voiceChannel);
        const musicTitle = await playUrl(message.guild.id, query, message.channel, voiceChannel);

        if (musicTitle) {
          await message.channel.send(`▶️ 再生キューに追加: **${musicTitle}**`);
        } else {
          await message.channel.send('❌ 曲が見つかりません');
        }
      } catch (err) {
        console.error('!play error:', err);
        await message.reply('❌ 再生中にエラーが発生しました');
      }
      break;
    }
    case 'stop': {
      const result = stopMusic(message.guild.id);
      message.channel.send(result ? '⏹️ 再生停止・キュークリア' : '❌ 再生中の曲なし');
      break;
    }
    case 'leave': {
      await leaveVoice(message.guild.id);
      message.channel.send('👋 ボイスチャンネル退出しました');
      break;
    }

    // Dropboxクイズ
    case 'uploadquiz': {
      try {
        const contents = await fs.readFile(path.join(__dirname, 'quizzes.json'));
        const result = await uploadToDropbox('/quizzes.json', contents.toString());
        message.reply(result ? '✅ Dropboxにアップロードしました' : '❌ アップロード失敗');
      } catch (err) {
        message.reply(err.code === 'ENOENT' ? '❌ quizzes.json が存在しません' : `❌ エラー: ${err.message}`);
      }
      break;
    }
    case 'downloadquiz': {
      try {
        const data = await downloadFromDropbox('/quizzes.json');
        if (data) await fs.writeFile(path.join(__dirname, 'quizzes.json'), data);
        message.reply(data ? '✅ Dropboxからダウンロード' : '❌ ダウンロード失敗');
      } catch (err) {
        message.reply(`❌ ダウンロード中エラー: ${err.message}`);
      }
      break;
    }

    // AIチャット
    case 'ai': {
      const prompt = args.join(' ').trim();
      if (!prompt) return message.reply('❌ 使用例: `!ai こんにちは`');
      const replyMsg = await message.reply('💬 AIが考え中...');
      try {
        const aiResponse = await chat(prompt, message.author.id);
        await replyMsg.edit(aiResponse || 'AIからの応答に失敗しました。');
      } catch (err) {
        console.error('❌ !ai エラー:', err);
        await replyMsg.edit('❌ AIとの通信中にエラーが発生しました。');
      }
      break;
    }

    default:
      handlePrefixMessage(client, message);
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