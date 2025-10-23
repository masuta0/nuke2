// https://github.com/masuta0/nuke2/blob/main/utils/music.js
// utils/music.js - yt-dlp がない場合は ytdl-core にフォールバックし、spawn の error をハンドルして落ちないようにする
// 使い方の簡易互換性を保つため、joinVoice(channel)、play(channel, url, textChannel) などのシグネチャを提供します.

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const { spawn } = require('child_process');
const stream = require('stream');
const ffmpegPath = require('ffmpeg-static');

let ytdl;
try {
  ytdl = require('ytdl-core');
} catch (e) {
  // ytdl-core が無い場合はフォールバックで使えないが、yt-dlp があれば動く
  ytdl = null;
}

const connections = new Map(); // guildId -> connection
const players = new Map(); // guildId -> player
const queues = new Map(); // guildId -> [{ url, title, isYouTube, isAttachment }]

const delay = ms => new Promise(r => setTimeout(r, ms));

// --- ユーティリティ: 安全に spawn してストリームを返す（yt-dlp がない場合にエラーを返すが error イベントを握りつぶす） ---
function spawnYtdlpStream(url) {
  try {
    const cp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url], { stdio: ['ignore', 'pipe', 'pipe'] });

    // attach handlers so 'error' doesn't propagate to uncaughtException
    cp.on('error', (err) => {
      // will be handled by caller; log for debugging
      console.error('yt-dlp spawn error:', err?.code || err?.message || err);
    });
    return cp.stdout;
  } catch (err) {
    // spawn may throw synchronously in some environments
    console.error('Failed to spawn yt-dlp:', err);
    return null;
  }
}

function spawnFfmpegConvertStream(inputStreamOrUrl) {
  // inputStreamOrUrl: can be a readable stream or a file/url
  // Use ffmpeg-static path
  const args = [
    '-i', 'pipe:0',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1'
  ];
  const ffmpeg = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'ignore'] });
  ffmpeg.on('error', err => {
    console.error('ffmpeg spawn error:', err);
  });

  // If caller provided a stream, pipe it; if string (url/path), write it via spawn of ffmpeg would require different args.
  // For simplicity here we expect a stream (ytdlp.stdout or attachment stream).
  if (inputStreamOrUrl && typeof inputStreamOrUrl.pipe === 'function') {
    inputStreamOrUrl.pipe(ffmpeg.stdin);
  }
  return ffmpeg.stdout;
}

// --- 接続管理 ---
// joinVoice: accept a VoiceChannel object
async function joinVoice(channel) {
  if (!channel) throw new Error('Voice channel is required to join');
  const guildId = channel.guild.id;
  if (!connections.has(guildId)) {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });
    connections.set(guildId, connection);
  }
  return connections.get(guildId);
}

// leaveVoice: accept guildId string or VoiceChannel
async function leaveVoice(guildOrChannel) {
  const guildId = typeof guildOrChannel === 'string' ? guildOrChannel : (guildOrChannel?.guild?.id);
  if (!guildId) return false;
  const conn = connections.get(guildId);
  if (conn) {
    try { conn.destroy(); } catch {}
  }
  connections.delete(guildId);
  const player = players.get(guildId);
  if (player) {
    try { player.stop(); } catch {}
  }
  players.delete(guildId);
  queues.delete(guildId);
  return true;
}

// 内部: 次の曲を再生
async function playNext(guildId, textChannel, voiceChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) {
    // 切断まで少し待つ/自動切断する実装はここで可能
    return;
  }

  const item = queue.shift();
  const { url, title, isYouTube, isAttachment } = item;
  let resource = null;

  try {
    // 1) Try yt-dlp (spawn) if YouTube
    if (isYouTube) {
      const ytdlpStdout = spawnYtdlpStream(url);
      if (ytdlpStdout) {
        // Use ffmpeg to convert to raw pcm for stable playback
        const ffout = spawn(ffmpegPath, ['-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
        ffout.on('error', e => console.error('ffmpeg error:', e));
        ytdlpStdout.pipe(ffout.stdin);
        resource = createAudioResource(ffout.stdout, { inputType: StreamType.Raw });
      } else if (ytdl) {
        // fallback to ytdl-core
        const ytdlStream = ytdl(url, { filter: 'audioonly', highWaterMark: 1 << 25 });
        const ffout = spawn(ffmpegPath, ['-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
        ffout.on('error', e => console.error('ffmpeg error:', e));
        ytdlStream.pipe(ffout.stdin);
        resource = createAudioResource(ffout.stdout, { inputType: StreamType.Raw });
      } else {
        throw new Error('再生に必要な yt-dlp または ytdl-core が見つかりません。');
      }
    } else if (isAttachment) {
      // attachments: we expect a URL to a media file; use ffmpeg to transcode
      const ffout = spawn(ffmpegPath, ['-i', url, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
      ffout.on('error', e => console.error('ffmpeg error:', e));
      resource = createAudioResource(ffout.stdout, { inputType: StreamType.Raw });
    } else {
      // If a raw stream or direct opus/pcm resource URL is provided, let createAudioResource handle it
      resource = createAudioResource(url);
    }

    // create player and play
    const player = createAudioPlayer();
    player.play(resource);
    player.on('error', err => {
      console.error('Audio player error:', err);
      // proceed to next track
      setTimeout(() => playNext(guildId, textChannel, voiceChannel), 1000);
    });
    player.on(AudioPlayerStatus.Idle, () => {
      // play next
      setTimeout(() => playNext(guildId, textChannel, voiceChannel), 250);
    });

    // subscribe connection
    const conn = connections.get(guildId);
    if (!conn) {
      // try to rejoin
      if (voiceChannel) await joinVoice(voiceChannel);
    }
    const connection = connections.get(guildId);
    if (connection) connection.subscribe(player);
    players.set(guildId, player);

    // notify text channel
    if (textChannel && typeof textChannel.send === 'function') {
      textChannel.send(`🎵 再生開始: **${title || '不明なタイトル'}**`).catch(() => {});
    }
  } catch (err) {
    console.error('再生エラー:', err);
    if (textChannel && typeof textChannel.send === 'function') {
      textChannel.send(`❌ 再生できませんでした: **${title || '不明なタイトル'}**\n理由: ${err.message || err}`).catch(() => {});
    }
    // try next track
    setTimeout(() => playNext(guildId, textChannel, voiceChannel), 1000);
  }
}

// YouTube 再生登録
async function playYouTube(channel, url, textChannel) {
  // channel: VoiceChannel
  if (!channel) throw new Error('Voice channel is required');
  const guildId = channel.guild.id;
  await joinVoice(channel);

  // try to get title with yt-dlp if available, else fallback
  let title = '不明なタイトル';
  try {
    const p = spawn('yt-dlp', ['--get-title', '--no-warnings', url]);
    let buf = '';
    p.stdout.on('data', d => buf += d.toString());
    await new Promise((res, rej) => {
      p.on('close', () => res());
      p.on('error', () => res()); // if error, just resolve
    });
    if (buf.trim()) title = buf.trim();
  } catch (e) {
    // ignore
  }

  if (!queues.has(guildId)) queues.set(guildId, []);
  const queue = queues.get(guildId);
  const isPlaying = players.get(guildId)?.state?.status === AudioPlayerStatus.Playing;

  queue.push({ url, title, isYouTube: true, isAttachment: false });
  if (!isPlaying) playNext(guildId, textChannel, channel);
  else if (textChannel && typeof textChannel.send === 'function') textChannel.send(`▶️ キューに追加: **${title}**`).catch(()=>{});

  return title;
}

// 添付ファイルや直接URLを再生キューに登録
async function playAttachment(channel, attachmentUrl, filename, textChannel) {
  if (!channel) throw new Error('Voice channel is required');
  const guildId = channel.guild.id;
  await joinVoice(channel);

  if (!queues.has(guildId)) queues.set(guildId, []);
  const queue = queues.get(guildId);
  const isPlaying = players.get(guildId)?.state?.status === AudioPlayerStatus.Playing;

  queue.push({ url: attachmentUrl, title: filename, isYouTube: false, isAttachment: true });
  if (!isPlaying) playNext(guildId, textChannel, channel);
  else if (textChannel && typeof textChannel.send === 'function') textChannel.send(`▶️ キューに追加: **${filename}**`).catch(()=>{});

  return filename;
}

// 共通入口: accept (voiceChannel, url, textChannel)
// 互換のため、もし最初の引数が guildId (string) で渡されたらそれを許容しない — 呼び出し側は voiceChannel を渡すようにすることを推奨
async function play(channelOrGuildOrId, url, textChannel, attachmentFilename = null) {
  // flexible handling
  let channel = null;
  if (!channelOrGuildOrId) throw new Error('Voice channel is required');
  if (typeof channelOrGuildOrId === 'string') {
    // guildId provided — try to find connection and not know voice channel => cannot join
    throw new Error('guildId ではなく VoiceChannel を渡してください');
  } else {
    channel = channelOrGuildOrId;
  }

  if (attachmentFilename) return playAttachment(channel, url, attachmentFilename, textChannel);
  if ((typeof url === 'string') && (url.includes('youtube.com') || url.includes('youtu.be'))) {
    return playYouTube(channel, url, textChannel);
  }
  return playAttachment(channel, url, url.split('/').pop(), textChannel);
}

// 停止
function stop(guildOrChannel) {
  const guildId = typeof guildOrChannel === 'string' ? guildOrChannel : (guildOrChannel?.guild?.id);
  const player = players.get(guildId);
  if (!player) return false;
  queues.set(guildId, []);
  try { player.stop(); } catch (e) { console.error('stop error:', e); }
  return true;
}

module.exports = {
  joinVoice,      // joinVoice(VoiceChannel)
  leaveVoice,     // leaveVoice(guildId or VoiceChannel)
  play,           // play(VoiceChannel, url, textChannel)
  stop,           // stop(guildId or VoiceChannel)
  // 互換性のため旧名もエクスポート（もし呼び出し側が playUrl を使っているならそれも使える）
  playUrl: async function(...args) { return play(...args); },
  stopMusic: stop,
  players,
};