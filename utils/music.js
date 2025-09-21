const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { spawn } = require('child_process');
const ytSearch = require('yt-search');

const queues = new Map();

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

  // URLか検索かを判定
  if (/^https?:\/\//.test(query)) {
    song = { title: query, url: query };
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
      channelId: textChannel.guild.members.me.voice.channel?.id || textChannel.member.voice.channel.id,
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
  const ytDlp = spawn('yt-dlp', [
    '-f', 'bestaudio',
    '-o', '-',
    song.url
  ], { shell: false });

  const resource = createAudioResource(ytDlp.stdout);
  serverQueue.player.play(resource);
  serverQueue.textChannel.send(`▶️ 再生開始: **${song.title}**`);

  ytDlp.stderr.on('data', (data) => {
    console.error(`yt-dlp error: ${data}`);
  });
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