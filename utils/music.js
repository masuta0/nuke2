// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { execFile } = require('child_process');
const path = require('path');

const queues = new Map(); // ギルドごとのキュー

// ギルドのボイスチャンネルに接続
async function joinVoice(guild, voiceChannel) {
  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    return !!connection;
  } catch {
    return false;
  }
}

// 音楽停止＆キュークリア
function stopMusic(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.player.stop();
  queue.songs = [];
  return true;
}

// VCから退出
function leaveVoice(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;
  queue.connection.destroy();
  queues.delete(guildId);
}

// 内部：次の曲を再生
async function _playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.songs.length === 0) {
    stopMusic(guildId);
    return;
  }

  const song = queue.songs[0];
  let resource;

  if (song.type === 'youtube') {
    const audioPath = await _getYouTubeAudio(song.url);
    resource = createAudioResource(audioPath);
  } else {
    resource = createAudioResource(song.url);
  }

  queue.player.play(resource);
  queue.player.once(AudioPlayerStatus.Idle, () => {
    queue.songs.shift();
    _playNext(guildId);
  });
}

// yt-dlpでYouTube音声を取得（ローカルにダウンロードしてパスを返す）
function _getYouTubeAudio(url) {
  return new Promise((resolve, reject) => {
    const filePath = path.resolve(__dirname, '../tmp/audio.mp3'); // 上書き
    execFile('yt-dlp', ['-x', '--audio-format', 'mp3', '-o', filePath, url], (err) => {
      if (err) return reject(err);
      resolve(filePath);
    });
  });
}

// 曲をキューに追加（YouTube）
async function playYouTube(guildId, url, voiceChannel) {
  if (!queues.has(guildId)) {
    const player = createAudioPlayer();
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    connection.subscribe(player);
    queues.set(guildId, { connection, player, songs: [] });
  }

  const queue = queues.get(guildId);
  queue.songs.push({ url, type: 'youtube' });

  if (queue.player.state.status !== AudioPlayerStatus.Playing) {
    _playNext(guildId);
  }
}

// 曲をキューに追加（添付ファイル / URL）
async function playAttachment(guildId, url, voiceChannel) {
  if (!queues.has(guildId)) {
    const player = createAudioPlayer();
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    connection.subscribe(player);
    queues.set(guildId, { connection, player, songs: [] });
  }

  const queue = queues.get(guildId);
  queue.songs.push({ url, type: 'file' });

  if (queue.player.state.status !== AudioPlayerStatus.Playing) {
    _playNext(guildId);
  }
}

module.exports = {
  joinVoice,
  playYouTube,
  playAttachment,
  stopMusic,
  leaveVoice,
};