const playDL = require('play-dl');
const { createAudioResource, AudioPlayer, StreamType, joinVoiceChannel } = require('@discordjs/voice');

// 既存の添付ファイル再生
async function playAttachment(guildId, url, textChannel, voiceChannel) {
    const stream = await playDL.stream(url);
    const resource = createAudioResource(stream.stream, { inputType: StreamType.Arbitrary });

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator
    });

    const player = new AudioPlayer();
    player.play(resource);
    connection.subscribe(player);

    textChannel.send(`▶️ ファイル再生開始: ${url}`);
    return true;
}

// YouTube 再生
async function playYouTube(guildId, url, textChannel, voiceChannel) {
    if (!playDL.yt_validate(url)) {
        textChannel.send('⚠️ URL が正しくありません');
        return false;
    }

    const stream = await playDL.stream(url);
    const resource = createAudioResource(stream.stream, { inputType: StreamType.Arbitrary });

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator
    });

    const player = new AudioPlayer();
    player.play(resource);
    connection.subscribe(player);

    textChannel.send(`▶️ YouTube 再生開始: ${url}`);
    return true;
}

module.exports = { playAttachment, playYouTube, joinVoice: async () => true, stopMusic: () => true, leaveVoice: async () => {} };