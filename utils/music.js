// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection, NoSubscriberBehavior } = require('@discordjs/voice');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const connections = new Map();
const players = new Map();

// ボイスチャンネルに参加
async function joinVoice(guild, channel) {
    try {
        const connection = joinVoiceChannel({
            guildId: guild.id,
            channelId: channel.id,
            adapterCreator: guild.voiceAdapterCreator,
        });
        connections.set(guild.id, connection);

        const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
        players.set(guild.id, player);
        connection.subscribe(player);

        return true;
    } catch (err) {
        console.error('joinVoice error:', err);
        return false;
    }
}

// 添付ファイルを再生
async function playAttachment(guildId, url, textChannel) {
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        const tmpPath = path.join(__dirname, '..', 'tmp', `${Date.now()}.mp3`);
        await fs.promises.mkdir(path.dirname(tmpPath), { recursive: true });
        await fs.promises.writeFile(tmpPath, Buffer.from(res.data));

        const resource = createAudioResource(tmpPath);
        const player = players.get(guildId);
        player.play(resource);

        player.once(AudioPlayerStatus.Idle, async () => {
            await fs.promises.unlink(tmpPath).catch(() => {});
        });

        return true;
    } catch (err) {
        console.error('playAttachment error:', err);
        return false;
    }
}

// YouTube 再生
async function playYouTube(guildId, url, textChannel) {
    try {
        // yt-dlp で直接音声URLを取得
        const streamUrl = await new Promise((resolve, reject) => {
            exec(`yt-dlp -f bestaudio -g "${url}"`, (err, stdout, stderr) => {
                if (err) return reject(err);
                resolve(stdout.trim());
            });
        });

        if (!streamUrl) return false;

        const resource = createAudioResource(streamUrl);
        const player = players.get(guildId);
        player.play(resource);

        return true;
    } catch (err) {
        console.error('playYouTube error:', err);
        return false;
    }
}

// 停止
function stopMusic(guildId) {
    const player = players.get(guildId);
    if (!player) return false;
    player.stop();
    return true;
}

// VC退出
async function leaveVoice(guildId) {
    const connection = getVoiceConnection(guildId);
    if (connection) connection.destroy();
    connections.delete(guildId);
    players.delete(guildId);
    return true;
}

module.exports = { joinVoice, playAttachment, playYouTube, stopMusic, leaveVoice };