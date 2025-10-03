require('dotenv').config();
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

// === Utils ===
const {
    joinVoice,
    playUrl,
    stopMusic,
    leaveVoice
} = require('./utils/music');
const {
    initFaceRecognition,
    isSimilarFace,
    registerFace
} = require('./utils/face');
const {
    registerSlashCommands,
    handleSlashCommand,
    commands
} = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes } = require('./utils/quiz');
const { addXp, loadData: loadLevelData } = require('./utils/level');
const { restoreVerifyMessage } = require('./utils/verify'); // verifysetup用
const { setupWeekly, loadWeeklyData } = require('./utils/weeklyManager');

const antiRaid = require('./utils/anti-raid');
const {
    handleMemberJoin,
    handleReactionAdd,
    handleRoleUpdate,
    handleAuditLogEntry,
    handleMessageUpdate,
    onGuildMemberUpdate,
    onGuildBanAdd,
    onGuildMemberRemove
} = antiRaid;

const {
    addMessage,
    loadActivity,
    resetMonthlyActivity,
    updateActiveRoles
} = require('./utils/activity');

// === Verify & Ticket ===
const verifySetup = require('./commands/verifysetup'); // verifyパネル
const ticket = require('./utils/ticket'); // チケットパネル

// === 設定 ===
const ACTIVE_ROLE_ID = '1422418430958501982';
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const WEEKLY_CHANNEL_ID = process.env.WEEKLY_CHANNEL_ID || null;
const CLIENT_ID = process.env.CLIENT_ID;

const APP_DATA_DIR = path.join(__dirname, 'app-data');
if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });

// === Discord Client ===
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

// === Expressサーバ ===
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log('Server listening on port ' + PORT));

// === Interaction処理 ===
client.on('interactionCreate', async (interaction) => {
    try {
        // --- Slash Command ---
        if (interaction.isChatInputCommand()) {
            await handleSlashCommand(interaction);
        }

        // --- Button ---
        else if (interaction.isButton()) {
            if (verifySetup.buttonHandler) await verifySetup.buttonHandler(interaction);
            if (ticket.buttonHandler) await ticket.buttonHandler(interaction);
        }

        // --- Modal Submit ---
        else if (interaction.isModalSubmit()) {
            if (verifySetup.modalHandler) await verifySetup.modalHandler(interaction);
            if (ticket.modalHandler) await ticket.modalHandler(interaction);
        }
    } catch (err) {
        console.error('interactionCreate error:', err);
    }
});

// === Readyイベント ===
client.once('ready', async () => {
    console.log('Logged in as ' + client.user.tag);

    try {
        // 顔認識初期化
        await initFaceRecognition();
        console.log('Face recognition initialized');

        // デフォルト顔登録（失敗時にログのみ）
        try {
            await registerFace('https://i.imgur.com/DkoHDM9.jpg');
            console.log('Face registered successfully');
        } catch (faceError) {
            console.error('Face registration failed:', faceError.message);
            console.log('Skipping face registration...');
        }

        // Dropbox初期化
        await ensureDropboxInit();

        // データロード
        await loadActivity();
        await loadLevelData();
        preloadQuizzes();
        await restoreVerifyMessage(client); // verify パネル自動再設置
        await loadWeeklyData();

        // 週次処理セットアップ
        setupWeekly(client, WEEKLY_CHANNEL_ID);

        // スラッシュコマンド登録
        await registerSlashCommands(client);
        console.log('Slash commands registered');
    } catch (err) {
        console.error('Ready event initialization error:', err);
    }

    // --- 定期処理: アンチレイド類似顔ハッシュクリーン ---
    setInterval(() => {
        for (const guildTracker of antiRaid.similarityTracker.values()) {
            antiRaid.cleanupSimilarityTracker(guildTracker, antiRaid.SIMILARITY_HASH_EXPIRY_MS);
        }
    }, antiRaid.CLEANUP_INTERVAL_MS);
    console.log('[Anti-Raid] Hash cleanup started.');

    // --- 定期処理: Botステータス更新 ---
    const start = Date.now();
    setInterval(() => {
        const elapsed = Date.now() - start;
        const h = Math.floor(elapsed / 1000 / 60 / 60);
        const m = Math.floor((elapsed / 1000 / 60) % 60);
        const s = Math.floor((elapsed / 1000) % 60);
        try {
            client.user.setActivity(`Running | ${h}h ${m}m ${s}s`, { type: ActivityType.Watching });
        } catch { }
    }, 5000);
});

// === 類似顔検出処理 ===
async function handleFaceMatch(message) {
    await message.delete();
    console.log('🧹 類似顔画像を削除: ' + message.id);

    const member = message.member;
    let timeoutResult = '❌ タイムアウト失敗';
    let timeoutTag = '不明';

    if (member && member.manageable) {
        try {
            await member.timeout(7 * 24 * 60 * 60 * 1000, 'Face image auto timeout');
            timeoutResult = '✅ タイムアウト成功';
            timeoutTag = member.user.tag;
            console.log('⏱️ 1週間タイムアウト: ' + timeoutTag);
        } catch (err) {
            console.error('⛔ タイムアウトエラー:', err);
        }
    }

    try {
        const logChannel = await client.channels.fetch('1422418574730989638');
        if (logChannel && logChannel.isTextBased()) {
            await logChannel.send({
                content:
                    `🧹 類似顔画像を削除しました\n` +
                    `👤 投稿者: ${timeoutTag} (<@${message.author.id}>)\n` +
                    `📨 メッセージID: ${message.id}\n` +
                    `⏱️ タイムアウト結果: ${timeoutResult}\n` +
                    `📍 チャンネル: <#${message.channel.id}>`,
                allowedMentions: { users: [], roles: [] }
            });
        }
    } catch (logErr) {
        console.error('📛 ログ送信エラー:', logErr);
    }
}

// === メッセージ処理 ===
client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;

        // 添付画像チェック
        for (const attachment of message.attachments.values()) {
            if (attachment.contentType?.startsWith('image/')) {
                if (await isSimilarFace(attachment.url)) {
                    await handleFaceMatch(message);
                    return;
                }
            }
        }

        // 本文内画像リンクチェック
        const urls = message.content.match(/https?:\/\/[^\s]+/g) || [];
        for (const url of urls) {
            if (url.match(/\.(jpg|jpeg|png|webp)$/i)) {
                if (await isSimilarFace(url)) {
                    await handleFaceMatch(message);
                    return;
                }
            }
        }

        // 通常処理
        await antiRaid.handleMessage(message);

        // アクティブロール処理
        if (message.guild && message.author.id) {
            await addMessage(message.guild.id, message.author.id, client, ACTIVE_ROLE_ID);
        }

        // レベルXP加算
        if (message.member) await addXp(message.member);

        // DM チェック
        if (message.channel.type === ChannelType.DM) return;

        // プレフィックスコマンド
        if (!message.content.startsWith('!')) return;
        const args = message.content.slice(1).trim().split(/ +/);
        const cmd = args.shift().toLowerCase();

        switch (cmd) {
            case 'join':
                if (!message.member?.voice?.channel) return message.reply('Please join a voice channel');
                if (await joinVoice(message.guild, message.member.voice.channel)) {
                    message.channel.send(`Joined **${message.member.voice.channel.name}**!`);
                } else message.reply('Failed to join voice channel');
                break;

            case 'play':
                if (!message.member?.voice?.channel) return message.reply('Please join a voice channel');
                try {
                    await joinVoice(message.guild, message.member.voice.channel);
                    const musicTitle = await playUrl(message.guild.id, args.join(' '), message.channel, message.member.voice.channel);
                    await message.channel.send(musicTitle ? `Added to queue: **${musicTitle}**` : 'Song not found');
                } catch {
                    await message.reply('Error occurred during playback');
                }
                break;

            case 'stop':
                message.channel.send(stopMusic(message.guild.id) ? 'Playback stopped and queue cleared' : 'No songs playing');
                break;

            case 'leave':
                await leaveVoice(message.guild.id);
                message.channel.send('Left voice channel');
                break;

            case 'ai':
                const prompt = args.join(' ').trim();
                if (!prompt) return message.reply('Usage: !ai <message>');
                const replyMsg = await message.reply('AI thinking...');
                try {
                    const aiResponse = await chat(prompt, message.author.id);
                    await replyMsg.edit(aiResponse || 'Failed to get AI response.');
                } catch {
                    await replyMsg.edit('Error occurred while communicating with AI.');
                }
                break;

            default:
                await handlePrefixMessage(client, message);
                break;
        }

    } catch (err) {
        console.error('messageCreate processing error:', err);
    }
});

// === 毎月1日にアクティビティリセット ===
cron.schedule('0 0 1 * *', async () => {
    try {
        await resetMonthlyActivity(client);
    } catch (err) {
        console.error('Monthly reset failed:', err);
    }
});

// === 追加イベントハンドラ ===
client.on('messageUpdate', handleMessageUpdate);
client.on('guildMemberAdd', handleMemberJoin);
client.on('guildMemberRemove', onGuildMemberRemove);
client.on('guildMemberUpdate', onGuildMemberUpdate);
client.on('guildBanAdd', onGuildBanAdd);
client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);

// DM専用
client.on('messageCreate', antiRaid.handleDirectMessage);

// === ログイン ===
client.login(TOKEN);