const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { spawn } = require('child_process');
const stream = require('stream');
const ffmpeg = require('ffmpeg-static');

const connections = new Map();
const players = new Map();
const queues = new Map();

// VC参加
async function joinVoice(guild, channel) {
  if (!connections.has(guild.id)) {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    connections.set(guild.id, connection);
  }
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

// 次の曲再生
async function playNext(guildId, textChannel, voiceChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) return;

  const { url, title, isYouTube, isAttachment } = queue.shift();
  let resource;

  try {
    if (isYouTube) {
      const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url]);
      const passThrough = new stream.PassThrough();
      ytdlp.stdout.pipe(passThrough);
      resource = createAudioResource(passThrough);
    } else if (isAttachment) {
      const ffmpegProc = spawn(ffmpeg, ['-i', url, '-f', 'mp3', '-ar', '48000', '-ac', '2', 'pipe:1']);
      const passThrough = new stream.PassThrough();
      ffmpegProc.stdout.pipe(passThrough);
      resource = createAudioResource(passThrough);
    } else {
      resource = createAudioResource(url);
    }

    const player = createAudioPlayer();
    player.play(resource);
    player.on(AudioPlayerStatus.Idle, () => playNext(guildId, textChannel, voiceChannel));

    const conn = connections.get(guildId);
    conn.subscribe(player);
    players.set(guildId, player);

    textChannel.send(`🎵 再生開始: **${title}**`);
  } catch (err) {
    console.error('再生エラー:', err);
    textChannel.send(`❌ 再生できませんでした: **${title}**`);
    playNext(guildId, textChannel, voiceChannel);
  }
}

// YouTube再生（タイトル不明でも再生）
async function playYouTube(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  let title = '不明なタイトル';
  try {
    const data = await new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', ['--get-title', '--no-warnings', url]);
      let buffer = '';
      ytdlp.stdout.on('data', d => buffer += d.toString());
      ytdlp.on('close', () => resolve(buffer.trim() || '不明なタイトル'));
      ytdlp.on('error', reject);
    });
    title = data;
  } catch {}

  if (!queues.has(guildId)) queues.set(guildId, []);
  const queue = queues.get(guildId);
  const isPlaying = players.get(guildId)?.state.status === AudioPlayerStatus.Playing;

  queue.push({ url, title, isYouTube: true, isAttachment: false });
  if (!isPlaying) playNext(guildId, textChannel, voiceChannel);
  else textChannel.send(`▶️ キューに追加: **${title}**`);

  return title;
}

// 添付ファイル再生
async function playAttachment(guildId, attachmentUrl, filename, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  if (!queues.has(guildId)) queues.set(guildId, []);
  const queue = queues.get(guildId);
  const isPlaying = players.get(guildId)?.state.status === AudioPlayerStatus.Playing;

  queue.push({ url: attachmentUrl, title: filename, isYouTube: false, isAttachment: true });
  if (!isPlaying) playNext(guildId, textChannel, voiceChannel);
  else textChannel.send(`▶️ キューに追加: **${filename}**`);

  return filename;
}

// 共通入口
async function playUrl(guildId, url, textChannel, voiceChannel, attachmentFilename = null) {
  if (attachmentFilename) return playAttachment(guildId, url, attachmentFilename, textChannel, voiceChannel);
  else if (url.includes('youtube.com') || url.includes('youtu.be')) return playYouTube(guildId, url, textChannel, voiceChannel);
  else return playAttachment(guildId, url, url.split('/').pop(), textChannel, voiceChannel);
}

// 停止
function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  queues.set(guildId, []);
  player.stop();
  return true;
}

module.exports = { joinVoice, leaveVoice, playUrl, stopMusic, AudioPlayerStatus, players };