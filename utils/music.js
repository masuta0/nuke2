const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');

let queue = new Map(); // guildIdごとにキューを保持

async function playSong(guild, song, interaction) {
    const serverQueue = queue.get(guild.id);

    if (!song) {
        serverQueue.connection.destroy();
        queue.delete(guild.id);
        return;
    }

    const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
    const resource = createAudioResource(stream);
    serverQueue.player.play(resource);

    serverQueue.player.once(AudioPlayerStatus.Playing, () => {
        interaction.followUp(`▶️ 再生開始: **${song.title}**\n${song.url}`);
    });

    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
        serverQueue.songs.shift();
        playSong(guild, serverQueue.songs[0], interaction);
    });
}

async function execute(interaction) {
    const args = interaction.options.getString('query'); // スラッシュコマンドの入力
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
        return interaction.reply('❌ ボイスチャンネルに参加してから使ってください！');
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        return interaction.reply('❌ ボイスチャンネルに参加・発言する権限がありません！');
    }

    let songInfo;
    let song;

    // YouTube URL かどうか判定
    if (ytdl.validateURL(args)) {
        songInfo = await ytdl.getInfo(args);
        song = { title: songInfo.videoDetails.title, url: songInfo.videoDetails.video_url };
    } else {
        const { videos } = await ytSearch(args);
        if (!videos.length) return interaction.reply('❌ 曲が見つかりませんでした！');
        song = { title: videos[0].title, url: videos[0].url };
    }

    let serverQueue = queue.get(interaction.guild.id);

    if (!serverQueue) {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
        });

        const player = createAudioPlayer();
        connection.subscribe(player);

        serverQueue = {
            voiceChannel,
            connection,
            player,
            songs: [],
        };

        queue.set(interaction.guild.id, serverQueue);
        serverQueue.songs.push(song);

        await interaction.reply(`🎶 キューに追加: **${song.title}**`);
        playSong(interaction.guild, serverQueue.songs[0], interaction);
    } else {
        serverQueue.songs.push(song);
        return interaction.reply(`🎶 キューに追加: **${song.title}**`);
    }
}

function skip(interaction) {
    const serverQueue = queue.get(interaction.guild.id);
    if (!serverQueue) return interaction.reply('❌ スキップできる曲がありません！');
    serverQueue.player.stop();
    interaction.reply('⏭️ スキップしました！');
}

function stop(interaction) {
    const serverQueue = queue.get(interaction.guild.id);
    if (!serverQueue) return interaction.reply('❌ 停止できる曲がありません！');
    serverQueue.songs = [];
    serverQueue.player.stop();
    interaction.reply('🛑 停止しました！');
}

module.exports = {
    execute,
    skip,
    stop,
};