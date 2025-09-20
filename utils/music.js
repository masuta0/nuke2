// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const ytdl = require('ytdl-core');

const ALLOWED_CHANNEL_ID = '1419041571944403046'; // !play コマンドが使えるチャンネルID
const queues = new Map(); // guildId → { connection, player, songs: [], textChannel }

async function playYouTube(guildId, url, textChannel, voiceChannel) {
  if (textChannel.id !== ALLOWED_CHANNEL_ID) {
    await textChannel.send('❌ このチャンネルでは !play コマンドを使えません');
    return false;
  }

  _ensureQueue(guildId, textChannel, voiceChannel);
  const queue = queues.get(guildId);

  queue.songs.push({ url, type: 'youtube' });

  if (queue.songs.length > 1) {
    queue.textChannel.send(`➕ キューに追加: **${await getYouTubeTitle(url)}**`);
  }

  if (queue.player.state.status !== AudioPlayerStatus.Playing) {
    _playNext(guildId);
  }

  return true;
}

async function playAttachment(guildId, url, textChannel, voiceChannel) {
  if (textChannel.id !== ALLOWED_CHANNEL_ID) {
    await textChannel.send('❌ このチャンネルでは !play コマンドを使えません');
    return false;
  }

  _ensureQueue(guildId, textChannel, voiceChannel);
  const queue = queues.get(guildId);

  queue.songs.push({ url, type: 'file' });

  if (queue.songs.length > 1) {
    queue.textChannel.send(`➕ キューに追加: 添付ファイル / URL`);
  }

  if (queue.player.state.status !== AudioPlayerStatus.Playing) {
    _playNext(guildId);
  }

  return true;
}

// --- 内部関数 ---
function _ensureQueue(guildId, textChannel, voiceChannel) {
  if (!queues.has(guildId)) {
    const player = createAudioPlayer();
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    connection.subscribe(player);
    queues.set(guildId, { connection, player, songs: [], textChannel });
  }
}

async function _playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.songs.length === 0) {
    stopMusic(guildId);
    return;
  }

  const song = queue.songs[0];
  let resource;

  if (song.type === 'youtube') {
    const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
    resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
    queue.textChannel.send(`▶️ 再生開始: **${await getYouTubeTitle(song.url)}**`);
  } else {
    resource = createAudioResource(song.url);
    queue.textChannel.send(`▶️ 再生開始: 添付ファイル / URL`);
  }

  queue.player.play(resource);

  queue.player.once(AudioPlayerStatus.Idle, () => {
    queue.songs.shift();
    _playNext(guildId);
  });
}

function stopMusic(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.songs = [];
  queue.player.stop(true);
  return true;
}

async function leaveVoice(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;
  queue.player.stop();
  queue.connection.destroy();
  queues.delete(guildId);
}

async function getYouTubeTitle(url) {
  try {
    const info = await ytdl.getInfo(url);
    return info.videoDetails.title;
  } catch {
    return '不明な曲';
  }
}

module.exports = {
  playYouTube,
  playAttachment,
  stopMusic,
  leaveVoice,
};