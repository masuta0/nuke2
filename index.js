require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, ActivityType, Partials, ChannelType } = require('discord.js');
const path = require('path');
const fs = require('fs').promises;

// モジュール読み込み
const registerSlashCommands = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes } = require('./utils/quiz');
const { addXp, loadData } = require('./utils/level');
const { restoreVerifyMessage } = require('./utils/verify');
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
const { joinVoice, playUrl, stopMusic, leaveVoice } = require('./utils/music');

// 定数
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const LOG_PATH = path.join(__dirname, 'logs/anti_raid.log');

// クライアント作成
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

// Expressサーバー
const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// ログイン時処理
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  await ensureDropboxInit();
  preloadQuizzes();
  await loadData();
  await restoreVerifyMessage(client);

  // 稼働時間表示
  const start = Date.now();
  const updateUptimeStatus = () => {
    const elapsed = Date.now() - start;
    const h = Math.floor(elapsed / 1000 / 60 / 60);
    const m = Math.floor((elapsed / 1000 / 60) % 60);
    const s = Math.floor((elapsed / 1000) % 60);
    try {
      client.user.setActivity(`稼働中 | ${h}h ${m}m ${s}s`, { type: ActivityType.Watching });
    } catch (_) {}
  };
  updateUptimeStatus();
  setInterval(updateUptimeStatus, 2000);

  // スラッシュコマンド登録
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

  // === DM処理 ===
  if (message.channel?.type === ChannelType.DM) {
    const pendingAction = pendingModActions.get(message.author.id);
    if (pendingAction) {
      const prompt = `以下の理由がDiscordサーバーのルール違反に対する妥当な理由か判断してください。「適切」か「不適切」のいずれかで回答してください。\n理由: ${message.content}`;
      const aiResponse = await chat(prompt, message.author.id);
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
          await message.reply(`⚠️ 理由が不適切です。再提出してください。（残り${3 - pendingAction.reasonAttempts}回）`);
        }
      }
      return;
    }
  }

  // === プレフィックスコマンド ===
  if (!message.content.startsWith('!')) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  switch (command) {
    // 音楽系
    case 'join':
      if (!message.member?.voice.channel) return message.reply('❌ ボイスチャンネルに参加してください');
      if (await joinVoice(message.guild, message.member.voice.channel)) {
        message.channel.send(`✅ **${message.member.voice.channel.name}** に参加しました！`);
      } else message.reply('❌ ボイスチャンネル参加失敗');
      break;
    case 'play':
      if (!message.member?.voice.channel) return message.reply('❌ ボイスチャンネルに参加してください');
      const query = args.join(' ');
      if (!query) return message.reply('❌ 曲名またはURLを入力してください');
      const musicTitle = await playUrl(message.guild.id, query, message.channel);
      message.channel.send(musicTitle ? `▶️ 再生キューに追加: **${musicTitle}**` : '❌ 曲が見つかりません');
      break;
    case 'stop':
      message.channel.send(stopMusic(message.guild.id) ? '⏹️ 再生停止・キュークリア' : '❌ 再生中の曲なし');
      break;
    case 'leave':
      await leaveVoice(message.guild.id);
      message.channel.send('👋 ボイスチャンネル退出しました');
      break;

    // Dropboxクイズ
    case 'uploadquiz':
      try {
        const contents = await fs.readFile(path.join(__dirname, 'quizzes.json'));
        const result = await uploadToDropbox('/quizzes.json', contents.toString());
        message.reply(result ? '✅ Dropboxにアップロードしました' : '❌ アップロード失敗');
      } catch (err) {
        message.reply(err.code === 'ENOENT' ? '❌ quizzes.json が存在しません' : `❌ エラー: ${err.message}`);
      }
      break;
    case 'downloadquiz':
      try {
        const data = await downloadFromDropbox('/quizzes.json');
        if (data) await fs.writeFile(path.join(__dirname, 'quizzes.json'), data);
        message.reply(data ? '✅ Dropboxからダウンロード' : '❌ ダウンロード失敗');
      } catch (err) {
        message.reply(`❌ ダウンロード中エラー: ${err.message}`);
      }
      break;

    // サーバー管理
    case 'backup':
      if (!hasManageGuildPermission(message.member)) return message.reply('⚠️ 管理者権限必要');
      await backupServerState(message.guild);
      message.reply('✅ サーバー構成をバックアップしました');
      break;
    case 'restore':
      if (!hasManageGuildPermission(message.member)) return message.reply('⚠️ 管理者権限必要');
      await restoreServerState(message.guild);
      message.reply('✅ サーバー構成を復元しました');
      break;

    // AIチャット
    case 'ai':
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

    default:
      handlePrefixMessage(client, message);
      break;
  }
});

// メッセージ更新
client.on('messageUpdate', handleMessageUpdate);

// メンバー入室
client.on('guildMemberAdd', handleMemberJoin);
client.on('guildMemberRemove', onGuildMemberRemove);
client.on('guildMemberUpdate', onGuildMemberUpdate);
client.on('guildBanAdd', onGuildBanAdd);
client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);

// ログイン
client.login(TOKEN);