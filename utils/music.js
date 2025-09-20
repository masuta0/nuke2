// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, getVoiceConnection } = require('@discordjs/voice');
const ytDlpExec = require('yt-dlp-exec');
const ffmpeg = require('ffmpeg-static');
const { exec } = require('child_process');

const queues = new Map(); // ギルドIDごとのキュー

function getQueue(guildId) {
    if (!queues.has(guildId)) queues.set(guildId, []);
    return queues.get(guildId);
}

async function playYouTube(guildId, url, textChannel, voiceChannel) {
    const queue = getQueue(guildId);

    // yt-dlp で音声URLを取得
    const info = await ytDlpExec(url, {
        dumpSingleJson: true,
        noWarnings: true,
        format: 'bestaudio',
        simulate: true
    });

    const title = info.title || 'Unknown';
    const streamUrl = info.url;

    queue.push({ url: streamUrl, title });

    textChannel.send(`🎵 **${title}** をキューに追加しました (${queue.length}曲目)`);

    if (!voiceChannel.connection) await joinVoice(voiceChannel);

    if (!queue.player) startQueue(guildId, textChannel, voiceChannel);

    return queue;
}

async function joinVoice(voiceChannel) {
    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator
    });
    return connection;
}

function startQueue(guildId, textChannel, voiceChannel) {
    const queue = getQueue(guildId);
    const player = createAudioPlayer();
    queue.player = player;

    const connection = getVoiceConnection(voiceChannel.guild.id);
    if (!connection) joinVoice(voiceChannel);

    connection.subscribe(player);

    const playNext = () => {
        if (queue.length === 0) {
            player.stop();
            textChannel.send('✅ キューが終了しました');
            queues.delete(guildId);
            return;
        }

        const track = queue.shift();
        const resource = createAudioResource(track.url, { inputType: StreamType.Arbitrary });
        player.play(resource);
        textChannel.send(`▶️ **再生中: ${track.title}**`);

        player.once(AudioPlayerStatus.Idle, playNext);
    };

    playNext();
}

function stopMusic(guildId) {
    const queue = queues.get(guildId);
    if (!queue || !queue.player) return false;

    queue.player.stop();
    queue.length = 0; // キュークリア
    return true;
}

async function leaveVoice(guildId) {
    const connection = getVoiceConnection(guildId);
    if (connection) {
        connection.destroy();
        queues.delete(guildId);
    }
}

async function playAttachment(guildId, url, textChannel, voiceChannel) {
    const queue = getQueue(guildId);
    queue.push({ url, title: '添付ファイル' });

    textChannel.send(`🎵 添付ファイルをキューに追加しました (${queue.length}曲目)`);

    if (!queue.player) startQueue(guildId, textChannel, voiceChannel);
}

module.exports = {
    joinVoice,
    playYouTube,
    playAttachment,
    stopMusic,
    leaveVoice,
};