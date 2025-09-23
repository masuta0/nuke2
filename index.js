require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const fetch = require('node-fetch');

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  ChannelType,
  MessageActionRow,
  MessageButton,
  AudioPlayerStatus
} = require('discord.js');

const translate = require('@iamtraction/google-translate');

// ====== ユーティリティ / モジュール ======
const {
  joinVoice, playUrl, stopMusic, leaveVoice, players
} = require('./utils/music');

const { chat, checkAiCooldown, setAiCooldown } = require('./utils/ai');
const {
  addMessage, getRanking, updateActiveRoles, initActivity
} = require('./utils/activity');

const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes, askQuiz } = require('./utils/quiz');
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
  onGuildMemberRemove
} = require('./utils/anti-raid');

const { hasManageGuildPermission, backupServer, restoreServer, nukeChannel, clearMessages, addRoleToAll } = require('./utils/guild');
const { saveUserWeatherPref, loadUserWeatherPref, fetchWeather } = require('./utils/weather');

// ====== 定数 ======
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const WEEKLY_CHANNEL_ID = process.env.WEEKLY_CHANNEL_ID;
const CMD_PREFIX = '!';
const COOLDOWN_TIME = 10; // 秒
const cooldowns = new Map();

// ====== Discord Client ======
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
    GatewayIntentBits.GuildBans
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// ====== Express サーバー ======
const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// ====== クールダウンユーティリティ ======
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ====== Bot Ready ======
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  await ensureDropboxInit();
  preloadQuizzes();
  await loadData();
  await restoreVerifyMessage(client);
  await loadWeeklyData();
  setupWeekly(client, WEEKLY_CHANNEL_ID);

  // 稼働時間ステータス
  const start = Date.now();
  setInterval(() => {
    const elapsed = Date.now() - start;
    const h = Math.floor(elapsed/1000/60/60);
    const m = Math.floor((elapsed/1000/60)%60);
    const s = Math.floor((elapsed/1000)%60);
    client.user.setActivity(`稼働中 | ${h}h ${m}m ${s}s`, { type: ActivityType.Watching }).catch(() => {});
  }, 5000);
});

// ====== メッセージイベント ======
client.on('messageCreate', async message => {
  if (message.author.bot) {
    await handleMessage(message);
    return;
  }

  // メッセージ数カウント
  if (message.guild) await addMessage(message.guild.id, message.author.id);

  // レベル
  if (message.member) await addXp(message.member);

  await handleMessage(message);

  if (message.channel?.type === ChannelType.DM) return;

  if (!message.content.startsWith(CMD_PREFIX)) return;

  const args = message.content.slice(CMD_PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  // クールダウンチェック
  if (cooldowns.has(message.author.id)) {
    const lastUsed = cooldowns.get(message.author.id);
    const remaining = (lastUsed + COOLDOWN_TIME*1000) - Date.now();
    if (remaining > 0) {
      const warnMsg = await message.reply(`⚠️ コマンドはクールダウン中です。あと${Math.ceil(remaining/1000)}秒`);
      setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      return;
    }
  }
  cooldowns.set(message.author.id, Date.now());

  // ====== コマンド ======
  try {
    switch(cmd) {
      case 'ping':
        await message.reply('Pong!');
        break;

      case 'ranking': {
        const ranking = getRanking(message.guild.id).slice(0, 10);
        if (!ranking.length) return message.reply('ランキングデータはありません');
        let text = '🏆 月間アクティブユーザーランキング 🏆\n';
        for (let i=0; i<ranking.length; i++) {
          const [userId, count] = ranking[i];
          const member = await message.guild.members.fetch(userId).catch(()=>null);
          const name = member ? member.user.username : '不明ユーザー';
          text += `${i+1}位: **${name}** (${count} 件)\n`;
        }
        await message.channel.send(text);
        await updateActiveRoles(message.guild);
        break;
      }

      case 'ai': {
        const remaining = checkAiCooldown(message.author.id);
        if (remaining > 0) return message.reply(`❌ AIは${remaining}秒クールダウン中`);
        setAiCooldown(message.author.id);
        const prompt = args.join(' ').trim();
        if (!prompt) return message.reply('❌ 使用例: !ai こんにちは');
        const thinkingMsg = await message.reply('💬 AIが考え中...');
        const res = await chat(prompt, message.author.id);
        await thinkingMsg.edit(res);
        break;
      }

      case '天気': {
        const loc = args.join(' ').trim();
        if (!loc) return message.reply('❌ 使用例: !天気 東京');
        try {
          const res = await fetch(`https://wttr.in/${encodeURIComponent(loc)}?format=3`).then(r=>r.text());
          await message.reply(res);
        } catch {
          await message.reply('⚠️ 天気情報取得失敗');
        }
        break;
      }

      case 'クイズ':
        const category = args[0]?.toLowerCase() || 'mix';
        await askQuiz(message.channel, message.author, category);
        break;

      case 'join':
        if (!message.member?.voice.channel) return message.reply('❌ ボイスチャンネルに参加してください');
        await joinVoice(message.guild, message.member.voice.channel);
        await message.reply(`✅ 参加しました: ${message.member.voice.channel.name}`);
        break;

      case 'play': {
        const query = args.join(' ');
        if (!query) return message.reply('❌ 曲名またはURLを入力してください');
        if (!message.member?.voice.channel) return message.reply('❌ ボイスチャンネルに参加してください');

        await joinVoice(message.guild, message.member.voice.channel);
        const musicTitle = await playUrl(message.guild.id, query, message.channel, message.member.voice.channel);

        if (musicTitle) {
          const player = players.get(message.guild.id);
          if (player?.state.status === AudioPlayerStatus.Playing) {
            await message.channel.send(`▶️ キューに追加: **${musicTitle}**`);
          }
        }
        break;
      }

      case 'stop':
        const result = stopMusic(message.guild.id);
        message.channel.send(result ? '⏹️ 再生停止・キュークリア' : '❌ 再生中の曲なし');
        break;

      case 'leave':
        await leaveVoice(message.guild.id);
        message.channel.send('👋 ボイスチャンネル退出しました');
        break;

      case 'backup':
        if (!hasManageGuildPermission(message.member)) return message.reply('⚠️ 管理者権限必要');
        await backupServer(message.guild);
        message.reply('✅ サーバー構成をバックアップしました');
        break;

      case 'restore':
        if (!hasManageGuildPermission(message.member)) return message.reply('⚠️ 管理者権限必要');
        const ok = await restoreServer(message.guild, message.channel);
        message.reply(ok ? '✅ 復元完了' : '⚠️ バックアップが見つかりません');
        break;

      case 'addrole': {
        if (!hasManageGuildPermission(message.member)) return message.reply('⚠️ 管理者権限必要');
        const roleName = args.join(' ');
        if (!roleName) return message.reply('使い方: !addrole <ロール名>');
        const result = await addRoleToAll(message.guild, roleName);
        message.channel.send(result.success ? `🎉 全${result.count}ユーザーに付与` : `❌ エラー: ${result.error}`);
        break;
      }

      case 'nuke':
        if (!hasManageGuildPermission(message.member)) return message.reply('⚠️ 管理者権限必要');
        await nukeChannel(message.channel);
        break;

      case 'clear': {
        if (!hasManageGuildPermission(message.member)) return message.reply('⚠️ 管理者権限必要');
        let amount = parseInt(args[0],10);
        if (!amount || amount <1 || amount>1000) return message.reply('⚠️ 1〜1000件指定');
        let targetUser = message.mentions.members.first() || null;
        await message.delete().catch(()=>{});
        let totalDeleted = 0;
        while(amount>0) {
          const fetchAmount = Math.min(amount,100);
          const fetched = await message.channel.messages.fetch({limit: fetchAmount});
          let messagesToDelete = targetUser ? fetched.filter(m=>m.author.id===targetUser.id) : fetched;
          if(!messagesToDelete.size) break;
          const deleted = await message.channel.bulkDelete(messagesToDelete,true);
          totalDeleted += deleted.size;
          amount -= deleted.size;
          if(deleted.size<fetchAmount) break;
        }
        const notice = await message.channel.send(`🧹 ${totalDeleted}件削除`);
        setTimeout(()=>notice.delete().catch(()=>{}),5000);
        break;
      }

      case 'uploadquiz':
        try {
          const data = await fs.readFile(path.join(__dirname,'quizzes.json'));
          await uploadToDropbox('/quizzes.json', data.toString());
          message.reply('✅ Dropboxにアップロード');
        } catch (err) { message.reply(`❌ エラー: ${err.message}`); }
        break;

      case 'downloadquiz':
        try {
          const data = await downloadFromDropbox('/quizzes.json');
          if(data) await fs.writeFile(path.join(__dirname,'quizzes.json'),data);
          message.reply(data ? '✅ Dropboxから取得' : '❌ ダウンロード失敗');
        } catch(err){message.reply(`❌ エラー: ${err.message}`);}
        break;

      default: {
        const langMap = { 英語:'en', 日本語:'ja', 中国語:'zh-CN', 韓国語:'ko', フランス語:'fr', スペイン語:'es', ドイツ語:'de' };
        if(!langMap[cmd]) return;
        const text = args.join(' ').trim();
        if(!text) return;
        const res = await translate(text, {to: langMap[cmd]});
        await message.reply(res.text||'翻訳失敗');
      }
    }
  } catch(e){console.error('Prefix command error:',e);}
});

// ====== 他イベント ======
client.on('messageUpdate', handleMessageUpdate);
client.on('guildMemberAdd', handleMemberJoin);
client.on('guildMemberRemove', onGuildMemberRemove);
client.on('guildMemberUpdate', onGuildMemberUpdate);
client.on('guildBanAdd', onGuildBanAdd);
client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);

// ====== ログイン ======
client.login(TOKEN);