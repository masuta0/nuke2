const cron = require('node-cron');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Client, GatewayIntentBits, Partials, ActivityType, ChannelType } = require('discord.js');

const { joinVoice, playUrl, stopMusic, leaveVoice } = require('./utils/music');
const { initFaceRecognition, isSimilarFace, registerFace } = require('./utils/face');
const { registerSlashCommands, handleSlashCommand } = require('./commands/slash');
const handlePrefixMessage = require('./commands/prefix');
const { chat } = require('./utils/ai');
const { ensureDropboxInit } = require('./utils/storage');
const { preloadQuizzes } = require('./utils/quiz');
const { addXp, loadData: loadLevelData } = require('./utils/level');
const { restoreVerifyMessage } = require('./utils/verify');
const { setupWeekly, loadWeeklyData } = require('./utils/weeklyManager');

const antiRaid = require('./utils/anti-raid');
const { handleMemberJoin, handleReactionAdd, handleRoleUpdate, handleAuditLogEntry, handleMessageUpdate, onGuildMemberUpdate, onGuildBanAdd, onGuildMemberRemove } = antiRaid;

const { addMessage, loadActivity, resetMonthlyActivity } = require('./utils/activity');
const verify = require('./utils/verify');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT;
const WEEKLY_CHANNEL_ID = process.env.WEEKLY_CHANNEL_ID || null;
const CLIENT_ID = process.env.CLIENT_ID;

const APP_DATA_DIR = path.join(__dirname, 'app-data');
if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });

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

const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log('Server listening on port ' + PORT));

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
        console.error('interactionCreate error:', err);
    }
});

client.once('ready', async () => {
    console.log('Logged in as ' + client.user.tag);

    try {
        await initFaceRecognition();
        console.log('Face recognition initialized');

        try {
            await registerFace('https://i.imgur.com/DkoHDM9.jpg');
            console.log('Face registered successfully');
        } catch (faceError) {
            console.error('Face registration failed:', faceError.message);
            console.log('Skipping face registration...');

            try {
                console.log('Trying alternative URL...');
                await registerFace('https://i.imgur.com/DkoHDM9.png');
                console.log('Alternative URL registration successful');
            } catch (altError) {
                console.error('Alternative URL failed:', altError.message);
                console.log('Please register face manually using /register-face command');
            }
        }

        await ensureDropboxInit();
        await loadActivity();
        await loadLevelData();
        preloadQuizzes();
        await restoreVerifyMessage(client);
        await loadWeeklyData();
        setupWeekly(client, WEEKLY_CHANNEL_ID);

        await registerSlashCommands(CLIENT_ID, TOKEN);
        console.log('Slash commands registered');

    } catch (err) {
        console.error('Ready event initialization error:', err);
    }

    setInterval(() => {
        for (const guildTracker of antiRaid.similarityTracker.values()) {
            antiRaid.cleanupSimilarityTracker(guildTracker, antiRaid.SIMILARITY_HASH_EXPIRY_MS);
        }
    }, antiRaid.CLEANUP_INTERVAL_MS);
    console.log('[Anti-Raid] Hash cleanup started.');

    const start = Date.now();
    setInterval(() => {
        const elapsed = Date.now() - start;
        const h = Math.floor(elapsed / 1000 / 60 / 60);
        const m = Math.floor((elapsed / 1000 / 60) % 60);
        const s = Math.floor((elapsed / 1000) % 60);
        try {
            client.user.setActivity(`Running | ${h}h ${m}m ${s}s`, { type: ActivityType.Watching });
        } catch (error) {
            // ignore
        }
    }, 5000);
});

client.on('messageCreate', async (message) => {
    try {
        if (message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    try {
                        const match = await isSimilarFace(attachment.url);
                        if (match) {
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
                                const logChannel = await client.channels.fetch('1405660583025709106');
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

                            return;
                        }
                    } catch (err) {
                        console.error('Face detection error:', err);
                    }
                }
            }
        }

        await antiRaid.handleMessage(message);
        if (message.author.bot) return;

        if (message.guild && message.author.id && !message.author.bot) {
            await addMessage(message.guild.id, message.author.id, message.content);
        }

        if (message.member) await addXp(message.member);
        if (message.channel && message.channel.type === ChannelType.DM) return;

        if (!message.content.startsWith('!')) return;
        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift();
        if (!command) return;
        const cmd = command.toLowerCase();

        if (cmd === 'ranking' && message.channel.name.includes('chat')) {
            const warn = await message.reply('This command cannot be used in this channel');
            setTimeout(() => warn.delete().catch(() => {}), 5000);
            message.delete().catch(() => {});
            return;
        }

        switch (cmd) {
            case 'join':
                if (!message.member?.voice?.channel) {
                    return message.reply('Please join a voice channel');
                }
                if (await joinVoice(message.guild, message.member.voice.channel)) {
                    message.channel.send(`Joined **${message.member.voice.channel.name}**!`);
                } else {
                    message.reply('Failed to join voice channel');
                }
                break;

            case 'play':
                if (!message.member?.voice?.channel) {
                    return message.reply('Please join a voice channel');
                }
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
                if (!prompt) return message.reply('Usage: !ai hello');
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

cron.schedule('0 0 1 * *', async () => {
    try {
        await resetMonthlyActivity(client);
    } catch (err) {
        console.error('Monthly reset failed:', err);
    }
});

client.on('messageUpdate', antiRaid.handleMessageUpdate);
client.on('guildMemberAdd', handleMemberJoin);
client.on('guildMemberRemove', onGuildMemberRemove);
client.on('guildMemberUpdate', onGuildMemberUpdate);
client.on('guildBanAdd', onGuildBanAdd);
client.on('roleUpdate', handleRoleUpdate);
client.on('messageReactionAdd', handleReactionAdd);
client.on('guildAuditLogEntryCreate', handleAuditLogEntry);
client.on('messageCreate', antiRaid.handleDirectMessage);

client.login(TOKEN);
