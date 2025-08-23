// index.js

require('dotenv').config();
const express = require('express');
const https = require('https');
const { Client, GatewayIntentBits, ActivityType, Partials, AuditLogEvent, PermissionsBitField, ChannelType } = require('discord.js');
const path = require('path');
const fs = require('fs').promises; // fsをpromises版に変更

const registerSlashCommands = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./utils/storage');
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
  hasManageGuildPermission,
  backupServerState,
  restoreServerState,
  pendingModActions,
  restoreRoles,
} = require('./utils/anti-raid');
const { loadData, addXp } = require('./utils/level');

// ログファイルのパスを定義
const LOG_PATH = path.join(__dirname, 'logs/anti_raid.log');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const JOIN_LOG_CHANNEL_ID = '1407669514425860136'; // Join log channel ID
const AI_COOLDOWN_EXEMPT_ROLE = '1408879622870925525'; // AIクールダウンを無効にするロールID

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

  // ユーザーのメッセージごとにXPを付与
  await addXp(message.member);
  await handleMessage(message);

  if (message.channel.type === ChannelType.DM) {
    const pendingAction = pendingModActions.get(message.author.id);
    if (pendingAction) {
      // AIを使ってDMの理由をチェック
      const prompt = `以下の理由が、Discordサーバーのルール違反に対する妥当な理由かどうか判断してください。「適切」か「不適切」のいずれかで回答してください。理由: ${message.content}`;
      const aiResponse = await chat(prompt);

      const isAppropriate = aiResponse.includes('適切');

      if (isAppropriate) {
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
            files: [{ attachment: Buffer.from(logContent), name: 'anti_raid.log' }]
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
        const prompt = `以下のDiscordサーバーの最近のメッセージ履歴を分析してください。どのような荒らし行為が行われているか、その傾向（例：スパム、不適切な画像、Fワードの連呼など）を日本語で簡潔にまとめてください。荒らし行為が見られない場合は、その旨を報告してください。\n\nログ:\n${recentMessages}`;
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
