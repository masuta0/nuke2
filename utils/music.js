// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { spawn } = require('child_process');
const stream = require('stream');
const path = require('path');
const fs = require('fs');

const connections = new Map();
const players = new Map();
const queues = new Map(); // ギルドごとの再生キュー

// ===== VC参加 =====
async function joinVoice(guild, channel) {
  if (connections.has(guild.id)) return true;
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });
  connections.set(guild.id, connection);
  return true;
}

// ===== VC退出 =====
async function leaveVoice(guildId) {
  const conn = connections.get(guildId);
  if (conn) conn.destroy();
  connections.delete(guildId);
  players.delete(guildId);
  queues.delete(guildId);
}

// ===== YouTube 用 AudioResource 作成 =====
function createYouTubeResource(url) {
  return new Promise((resolve, reject) => {
    try {
      const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url], { stdio: ['ignore', 'pipe', 'ignore'] });
      const ffmpegProcess = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-f', 'opus',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'ignore'] });

      ytdlp.stdout.pipe(ffmpegProcess.stdin);

      const passThrough = new stream.PassThrough();
      ffmpegProcess.stdout.pipe(passThrough);

      const resource = createAudioResource(passThrough, { inlineVolume: true });
      resolve(resource);

      ytdlp.on('error', err => reject(err));
      ffmpegProcess.on('error', err => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

// ===== 添付ファイル用 AudioResource 作成 =====
function createAttachmentResource(filePath) {
  const readStream = fs.createReadStream(filePath);
  return createAudioResource(readStream, { inlineVolume: true });
}

// ===== 再生 =====
async function playNext(guildId, textChannel, voiceChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) return;

  const { url, title, type } = queue.shift();
  let resource;

  try {
    if (type === 'youtube') {
      resource = await createYouTubeResource(url);
    } else if (type === 'attachment') {
      resource = createAttachmentResource(url);
    } else {
      return textChannel.send('⚠️ 再生タイプ不明');
    }
  } catch (err) {
    console.error('再生エラー:', err);
    textChannel.send('❌ 再生に失敗しました');
    return playNext(guildId, textChannel, voiceChannel); // 次を再生
  }

  const player = createAudioPlayer();
  player.play(resource);
  player.on(AudioPlayerStatus.Idle, () => {
    player.stop();
    playNext(guildId, textChannel, voiceChannel);
  });

  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`🎵 再生開始: **${title}**`);
}

// ===== キュー追加共通 =====
async function addToQueue(guildId, url, textChannel, voiceChannel, title = null, type = 'youtube') {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);
  if (!queues.has(guildId)) queues.set(guildId, []);

  queues.get(guildId).push({ url, title: title || url, type });

  if (players.get(guildId)?.state.status !== AudioPlayerStatus.Playing) {
    playNext(guildId, textChannel, voiceChannel);
  } else {
    textChannel.send(`▶️ キューに追加: **${title || url}**`);
  }
}

// ===== 外部関数 =====
async function playUrl(guildId, url, textChannel, voiceChannel, attachmentFilename = null) {
  if (attachmentFilename) return addToQueue(guildId, url, textChannel, voiceChannel, attachmentFilename, 'attachment');
  if (url.includes('youtube.com') || url.includes('youtu.be')) return addToQueue(guildId, url, textChannel, voiceChannel, null, 'youtube');
  return addToQueue(guildId, url, textChannel, voiceChannel, path.basename(url), 'attachment');
}

function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  queues.set(guildId, []);
  player.stop();
  return true;
}

module.exports = {
  joinVoice,
  leaveVoice,
  playUrl,
  stopMusic,
};