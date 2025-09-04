// index.js

require('dotenv').config();
const express = require('express');
const https = require('https');
const { Client, GatewayIntentBits, ActivityType, Partials, ChannelType } = require('discord.js');
const path = require('path');
const fs = require('fs').promises;

// 各機能のモジュール
const registerSlashCommands = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes, askQuiz } = require('./utils/quiz');
const { fetchWeather } = require('./utils/weather');
const { joinVoice, playUrl, stopMusic, leaveVoice } = require('./utils/music');
const setupDisusoku = require("./utils/disusoku");

// アンチレイド機能のモジュール
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
  hasManageGuildPermission,
  backupServerState,
  restoreServerState,
  pendingModActions,
  restoreRoles,
} = require('./utils/anti-raid');
const { loadData, addXp } = require('./utils/level');
const { restoreVerifyMessage } = require('./utils/verify');

// 定数
const LOG_PATH = path.join(__dirname, 'logs/anti_raid.log');
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const DISUSOKU_CHANNEL_ID = "1413221071850832174"; // ディス速を投稿するチャンネルID
const DISUSOKU_URL = "https://dissoku.net/ja"; // ディス速のURL

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
    // Disusokuの機能に必要なintentも追加
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// Expressサーバーの設定
const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // 各種の初期化処理
  await ensureDropboxInit();
  preloadQuizzes();
  await loadData();
  await restoreVerifyMessage(client);

  // ディス速の自動投稿機能をセットアップ
  setupDisusoku(client, DISUSOKU_CHANNEL_ID, DISUSOKU_URL);

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

// メッセージ作成イベント
client.on('messageCreate', async (message) => {
  if (message.author.bot) {
    await handleMessage(message);
    return;
  }

  await addXp(message.member);
  await handleMessage(message);

  // === DM処理ブロック ===
  if (message.channel && message.channel.type === ChannelType.DM) {
    const pendingAction = pendingModActions.get(message.author.id);
    if (pendingAction) {
      const prompt = `以下の理由が、Discordサーバーのルール違反に対する妥当な理由かどうか判断してください。「適切」か「不適切」のいずれかで回答してください。理由: ${message.content}`;
      const aiResponse = await chat(prompt);
      const isAppropriate = aiResponse.includes('適切');

      if (isAppropriate) {
        await message.reply('✅ 理由が適切と判断されました。ロールを復元します。');
        await restoreRoles(
          await message.client.guilds.cache
            .get(pendingAction.entry.guildId)
            .members.fetch(message.author.id)
        );
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
      return; // DM処理が終わったら終了
    }
  }

  // === プレフィックスコマンド処理 ===
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  switch (command) {
    case 'join':
      if (!message.member?.voice.channel) return message.reply('❌ ボイスチャンネルに参加してください');
      const voiceChannel = message.member.voice.channel;
      if (await joinVoice(message.guild, voiceChannel)) {
        message.channel.send(`✅ **${voiceChannel.name}** に参加しました！`);
      } else {
        message.reply('❌ ボイスチャンネルへの参加に失敗しました。');
      }
      break;
    case 'play':
      if (!message.member?.voice.channel) return message.reply('❌ ボイスチャンネルに参加してください');
      const query = args.join(' ');
      if (!query) return message.reply('❌ 曲名またはURLを入力してください');
      const musicTitle = await playUrl(message.guild.id, query, message.channel);
      message.channel.send(musicTitle ? `▶️ 再生キューに追加: **${musicTitle}**` : '❌ 曲が見つかりませんでした');
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
      try {
        const contents = await fs.readFile(path.join(__dirname, 'quizzes.json'));
        const result = await uploadToDropbox('/quizzes.json', contents.toString());
        message.reply(result ? '✅ Dropboxにアップロードしました' : '❌ アップロード失敗');
      } catch (err) {
        if (err.code === 'ENOENT') {
          message.reply('❌ quizzes.json が存在しません');
        } else {
          message.reply(`❌ アップロード中にエラーが発生しました: ${err.message}`);
        }
      }
      break;
    case 'downloadquiz':
      try {
        const data = await downloadFromDropbox('/quizzes.json');
        if (data) {
          await fs.writeFile(path.join(__dirname, 'quizzes.json'), data);
          message.reply('✅ Dropboxからダウンロードしました');
        } else {
          message.reply('❌ ダウンロード失敗');
        }
      } catch (err) {
        message.reply(`❌ ダウンロード中にエラーが発生しました: ${err.message}`);
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
    case 'monitor':
      if (!hasManageGuildPermission(message.member)) return message.reply("⚠️ このコマンドは管理者のみが使用できます。");
      try {
        await fs.access(LOG_PATH);
        const logContent = await fs.readFile(LOG_PATH, 'utf-8');
        if (logContent.trim().length === 0) {
          await message.channel.send("✅ 監視ログは空です。");
        } else {
          await message.channel.send({
            content: "**サーバー監視ログ**\n```\n" + logContent + "\n```",
            files: [{ attachment: Buffer.from(logContent), name: 'anti-raid.log' }]
          });
          await message.channel.send("✅ 監視ログを正常に確認しました。");
        }
        await fs.unlink(LOG_PATH);
        await message.channel.send("✅ 監視ログを削除しました。");
      } catch (e) {
        if (e.code === 'ENOENT') {
          await message.channel.send("⚠️ 監視ログファイルが見つかりませんでした。");
        } else {
          console.error("監視ログの処理中にエラーが発生しました:", e);
          await message.channel.send("❌ 監視ログの処理中にエラーが発生しました。");
        }
      }
      break;
    case 'raid_report':
      if (!hasManageGuildPermission(message.member)) {
        return message.reply("⚠️ このコマンドはサーバー管理者のみが使用できます。");
      }
      await message.channel.send("AIが荒らしレポートを作成中です...少々お待ちください。");
      try {
        const messages = await message.channel.messages.fetch({ limit: 50 });
        const recentMessages = messages.map(m => {
          if (m.author.bot) return null;
          return `[${m.author.username}]: ${m.content}`;
        }).filter(Boolean).reverse().join('\n');
        if (!recentMessages) {
          return message.channel.send('直近のメッセージ履歴がありません。');
        }
        const prompt = `以下のDiscordサーバーの最近のメッセージ履歴を分析してください。どのような荒らし行為が行われているか、その傾向（例：スパム）を日本語で簡潔にまとめてください。荒らし行為が見られない場合は、その旨を報告してください。\n\nログ:\n${recentMessages}`;
        const aiResponse = await chat(prompt);
        await message.channel.send(`**サーバー荒らしレポート**\n${aiResponse || 'AIによる分析に失敗しました。'}`);
      } catch (e) {
        console.error('荒らしレポートの作成に失敗しました:', e);
        await message.channel.send('レポートの作成中にエラーが発生しました。');
      }
      break;
    default:
      handlePrefixMessage(client, message);
      break;
  }
});

// その他のイベントハンドラ
client.on('messageUpdate', async (oldMessage, newMessage) => {
  await handleMessageUpdate(oldMessage, newMessage);
});

client.on('guildMemberAdd', async member => {
  const targetChannelId = '1407717252945543250';
  const channel = member.guild.channels.cache.get(targetChannelId);

  if (!channel || channel.type !== ChannelType.GuildText) {
    console.log(`指定されたチャンネルが見つからないか、テキストチャンネルではありません。ID: ${targetChannelId}`);
    return;
  }

  try {
    const welcomeMessage = await channel.send(`<@${member.id}> さん、サーバーへようこそ！`);
    setTimeout(() => {
      welcomeMessage.delete()
        .then(() => console.log(`メッセージを削除しました。`))
        .catch(error => {
          console.error('メッセージの削除中にエラーが発生しました:', error);
        });
    }, 5000);
  } catch (error) {
    console.error('メッセージの送信中にエラーが発生しました:', error);
  }
});

client.on('guildMemberRemove', async member => {
  const leaveMessage = `「**${member.guild.name}**」からの退出は許されていません。\n https://discord.gg/dmTWfKg6T5`;
  try {
    await member.user.send(leaveMessage);
    console.log(`✅ ${member.user.tag} に退出DMを送信しました。`);
  } catch (error) {
    console.error(`❌ ${member.user.tag} にDMを送信できませんでした。`, error);
  }
});

client.on('guildMemberRemove', onGuildMemberRemove);
client.on('guildMemberUpdate', onGuildMemberUpdate);
client.on('guildBanAdd', onGuildBanAdd);
client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);

client.login(TOKEN);
