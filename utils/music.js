const playDL = require('play-dl');
const { 
    createAudioResource, 
    createAudioPlayer, 
    joinVoiceChannel, 
    AudioPlayerStatus, 
    StreamType 
} = require('@discordjs/voice');

// 接続を管理するマップ（ギルドごと）
const connections = new Map();

async function joinVoice(guild, voiceChannel) {
    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator
        });
        connections.set(guild.id, connection);
        return connection;
    } catch (err) {
        console.error('❌ VC 接続失敗:', err);
        return null;
    }
}

async function playAttachment(guildId, url, textChannel, voiceChannel) {
    const connection = connections.get(guildId) || await joinVoice(voiceChannel.guild, voiceChannel);
    if (!connection) return false;

    const stream = await playDL.stream(url);
    const resource = createAudioResource(stream.stream, { inputType: StreamType.Arbitrary });

    const player = createAudioPlayer();
    connection.subscribe(player);

    player.play(resource);
    player.once(AudioPlayerStatus.Playing, () => {
        textChannel.send(`▶️ ファイル再生開始: ${url}`);
    });

    return true;
}

async function playYouTube(guildId, url, textChannel, voiceChannel) {
    const connection = connections.get(guildId) || await joinVoice(voiceChannel.guild, voiceChannel);
    if (!connection) return false;

    if (!playDL.yt_validate(url)) {
        textChannel.send('⚠️ URL が正しくありません');
        return false;
    }

    const stream = await playDL.stream(url);
    const resource = createAudioResource(stream.stream, { inputType: StreamType.Arbitrary });

    const player = createAudioPlayer();
    connection.subscribe(player);

    player.play(resource);
    player.once(AudioPlayerStatus.Playing, () => {
        textChannel.send(`▶️ YouTube 再生開始: ${url}`);
    });

    return true;
}

async function leaveVoice(guildId) {
    const connection = connections.get(guildId);
    if (connection) {
        connection.destroy();
        connections.delete(guildId);
    }
}

module.exports = { joinVoice, playAttachment, playYouTube, leaveVoice };