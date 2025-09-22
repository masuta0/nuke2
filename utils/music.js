const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { spawn } = require('child_process');
const stream = require('stream');
const ffmpeg = require('ffmpeg-static');
const path = require('path');

// ギルドごとの状態管理
const connections = new Map();
const players = new Map();
const queues = new Map();

// VC参加
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

// VC退出
async function leaveVoice(guildId) {
  const conn = connections.get(guildId);
  if (conn) conn.destroy();
  connections.delete(guildId);
  players.delete(guildId);
  queues.delete(guildId);
}

// 次の曲を再生
async function playNext(guildId, textChannel, voiceChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) return;

  const { url, title, isYouTube, isAttachment } = queue.shift();
  let resource;

  if (isYouTube) {
    const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url], { stdio: ['ignore', 'pipe', 'ignore'] });
    const passThrough = new stream.PassThrough();
    ytdlp.stdout.pipe(passThrough);
    resource = createAudioResource(passThrough);
  } else if (isAttachment) {
    const passThrough = new stream.PassThrough();
    const ffmpegProcess = spawn(ffmpeg, ['-i', url, '-f', 'mp3', '-ar', '48000', '-ac', '2', 'pipe:1']);
    ffmpegProcess.stdout.pipe(passThrough);
    resource = createAudioResource(passThrough);
  } else {
    resource = createAudioResource(url);
  }

  const player = createAudioPlayer();
  player.play(resource);

  players.set(guildId, player);
  const conn = connections.get(guildId);
  conn.subscribe(player);

  // 再生開始メッセージはここだけ
  await textChannel.send(`🎵 再生開始: **${title}**`);

  player.on(AudioPlayerStatus.Idle, () => {
    if (queues.get(guildId)?.length > 0) {
      playNext(guildId, textChannel, voiceChannel);
    } else {
      players.delete(guildId);
    }
  });
}

// 添付ファイル再生
async function playAttachment(guildId, attachmentUrl, filename, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  if (!queues.has(guildId)) queues.set(guildId, []);
  queues.get(guildId).push({ url: attachmentUrl, title: filename, isYouTube: false, isAttachment: true });

  if (!players.get(guildId)) {
    playNext(guildId, textChannel, voiceChannel);
  }

  return filename;
}

// YouTube再生
async function playYouTube(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  const title = await new Promise((resolve, reject) => {
    const ytdlp = spawn('yt-dlp', ['--get-title', url]);

    let data = '';
    let errData = '';

    ytdlp.stdout.on('data', chunk => data += chunk.toString());
    ytdlp.stderr.on('data', chunk => errData += chunk.toString());

    ytdlp.on('close', (code) => {
      if (code !== 0 || !data) {
        console.error('yt-dlp error:', errData);
        return reject(new Error('タイトル取得に失敗しました'));
      }
      resolve(data.trim());
    });

    ytdlp.on('error', reject);
  });

  if (!queues.has(guildId)) queues.set(guildId, []);
  queues.get(guildId).push({ url, title, isYouTube: true, isAttachment: false });

  if (!players.get(guildId)) {
    playNext(guildId, textChannel, voiceChannel);
  }

  return title;
}

// 共通エントリ
async function playUrl(guildId, url, textChannel, voiceChannel, attachmentFilename = null) {
  if (attachmentFilename) return playAttachment(guildId, url, attachmentFilename, textChannel, voiceChannel);
  else if (url.includes('youtube.com') || url.includes('youtu.be')) return playYouTube(guildId, url, textChannel, voiceChannel);
  else return playAttachment(guildId, url, path.basename(url), textChannel, voiceChannel);
}

// 停止
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
  stopMusic
};