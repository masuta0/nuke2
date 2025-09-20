// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const queueMap = new Map(); // guildId -> { channel, connection, player, queue: [], playing }

// 許可チャンネルID
const ALLOWED_CHANNEL_ID = '1419041571944403046';

async function joinVoice(guild, channel) {
    if (!guild || !channel) return false;

    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    queueMap.set(guild.id, { channel, connection, player, queue: [], playing: false });

    return true;
}

function leaveVoice(guildId) {
    const data = queueMap.get(guildId);
    if (!data) return false;
    data.player.stop();
    data.connection.destroy();
    queueMap.delete(guildId);
    return true;
}

function stopMusic(guildId) {
    const data = queueMap.get(guildId);
    if (!data) return false;
    data.queue = [];
    data.player.stop();
    return true;
}

// yt-dlp で MP3 を取得して再生
function downloadAndPlay(guildId, url, channel, callback) {
    const data = queueMap.get(guildId);
    if (!data) return callback(null);

    const tmpDir = path.join(__dirname, '..', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    const outFile = path.join(tmpDir, `${Date.now()}.mp3`);

    // URL の余計なクエリを削除
    const safeUrl = url.split('?')[0];

    const cmd = `yt-dlp -x --audio-format mp3 -o "${outFile}" "${safeUrl}"`;

    exec(cmd, (err) => {
        if (err) return callback(null);

        const resource = createAudioResource(outFile);
        data.player.play(resource);
        data.playing = true;

        data.player.once(AudioPlayerStatus.Idle, () => {
            fs.unlink(outFile, () => {});
            data.playing = false;
            if (data.queue.length > 0) {
                const next = data.queue.shift();
                downloadAndPlay(guildId, next.url, channel, next.callback);
                channel.send(`▶️ 次の曲を再生: **${next.title}**`);
            }
        });

        callback(outFile);
    });
}

// キュー再生＆チャンネル制限
async function playUrl(guildId, query, channel) {
    // チャンネル制限
    if (channel.id !== ALLOWED_CHANNEL_ID) {
        channel.send(`❌ このチャンネルでは !play は使用できません`).then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 5000);
            channel.messages.fetch({ limit: 1 }).then(msgs => {
                msgs.forEach(m => {
                    if (m.author.bot) return;
                    m.delete().catch(() => {});
                });
            });
        }).catch(() => {});
        return null;
    }

    const data = queueMap.get(guildId);
    if (!data) return null;

    const isUrl = query.startsWith('http');
    let title = query;

    if (isUrl) {
        title = query.split('?')[0].split('/').pop();
    }

    if (data.playing) {
        data.queue.push({ url: query, title, callback: () => {} });
        channel.send(`⏱ キューに追加: **${title}**`);
        return title;
    }

    return new Promise((resolve) => {
        downloadAndPlay(guildId, query, channel, () => {
            channel.send(`▶️ 再生開始: **${title}**`);
            resolve(title);
        });
    });
}

module.exports = {
    joinVoice,
    leaveVoice,
    stopMusic,
    playUrl,
};