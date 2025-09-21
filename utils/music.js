const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');

const queues = new Map(); // guildIdごとにキューを保存

function joinVoice(guild, voiceChannel) {
  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    return connection;
  } catch (err) {
    console.error('❌ joinVoice エラー:', err);
    return null;
  }
}

async function playUrl(guildId, query, textChannel) {
  let song;

  // URLか検索ワードかを判定
  if (ytdl.validateURL(query)) {
    const info = await ytdl.getInfo(query);
    song = { title: info.videoDetails.title, url: info.videoDetails.video_url };
  } else {
    const { videos } = await ytSearch(query);
    if (!videos.length) return null;
    song = { title: videos[0].title, url: videos[0].url };
  }

  let serverQueue = queues.get(guildId);

  if (!serverQueue) {
    serverQueue = {
      songs: [],
      player: createAudioPlayer(),
      connection: null,
      textChannel,
    };
    queues.set(guildId, serverQueue);

    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
      serverQueue.songs.shift();
      if (serverQueue.songs.length > 0) {
        playNext(guildId);
      } else {
        serverQueue.textChannel.send('✅ キュー終了');
      }
    });
  }

  serverQueue.songs.push(song);

  if (!serverQueue.connection) {
    const connection = joinVoiceChannel({
      channelId: textChannel.guild.members.me.voice.channel?.id || textChannel.guild.members.cache.get(textChannel.client.user.id)?.voice.channel?.id || textChannel.guild.members.me.voice?.channelId,
      guildId: textChannel.guild.id,
      adapterCreator: textChannel.guild.voiceAdapterCreator,
    });
    serverQueue.connection = connection;
    connection.subscribe(serverQueue.player);

    playNext(guildId);
  }

  return song.title;
}

function playNext(guildId) {
  const serverQueue = queues.get(guildId);
  if (!serverQueue || !serverQueue.songs.length) return;

  const song = serverQueue.songs[0];
  const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
  const resource = createAudioResource(stream);

  serverQueue.player.play(resource);
  serverQueue.textChannel.send(`▶️ 再生開始: **${song.title}**`);
}

function stopMusic(guildId) {
  const serverQueue = queues.get(guildId);
  if (!serverQueue) return false;
  serverQueue.songs = [];
  serverQueue.player.stop();
  return true;
}

function leaveVoice(guildId) {
  const serverQueue = queues.get(guildId);
  if (!serverQueue || !serverQueue.connection) return false;
  serverQueue.connection.destroy();
  queues.delete(guildId);
  return true;
}

module.exports = {
  joinVoice,
  playUrl,
  stopMusic,
  leaveVoice,
};