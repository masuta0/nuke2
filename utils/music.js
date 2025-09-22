// utils/music.js
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus 
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const stream = require('stream');
const path = require('path');
const ffmpeg = require('ffmpeg-static');

const connections = new Map();
const players = new Map();
const queues = new Map();

// VC参加
async function joinVoice(guild, voiceChannel) {
  if (!voiceChannel) return false;
  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    connections.set(guild.id, connection);
    return true;
  } catch (err) {
    console.error("joinVoice error:", err);
    return false;
  }
}

// VC退出
async function leaveVoice(guildId) {
  try {
    const conn = connections.get(guildId);
    if (conn) conn.destroy();
  } catch (err) {
    console.error("leaveVoice error:", err);
  } finally {
    connections.delete(guildId);
    players.delete(guildId);
    queues.delete(guildId);
  }
}

// 次の曲を再生
async function playNext(guildId, textChannel, voiceChannel) {
  try {
    const queue = queues.get(guildId);
    if (!queue || queue.length === 0) return;

    const { url, title, isYouTube, isAttachment } = queue.shift();
    let resource;

    if (isYouTube) {
      const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', url]);
      ytdlp.on('error', err => console.error("yt-dlp spawn error:", err));
      const passThrough = new stream.PassThrough();
      ytdlp.stdout.pipe(passThrough);
      resource = createAudioResource(passThrough);
    } else if (isAttachment) {
      const ffmpegProcess = spawn(ffmpeg, [
        '-i', url,
        '-f', 'mp3',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
      ]);
      ffmpegProcess.on('error', err => console.error("ffmpeg error:", err));
      const passThrough = new stream.PassThrough();
      ffmpegProcess.stdout.pipe(passThrough);
      resource = createAudioResource(passThrough);
    } else {
      resource = createAudioResource(url);
    }

    const player = createAudioPlayer();
    player.play(resource);

    player.on(AudioPlayerStatus.Idle, () => {
      try { playNext(guildId, textChannel, voiceChannel); } 
      catch (err) { console.error("playNext recursive error:", err); }
    });

    const conn = connections.get(guildId);
    if (conn) conn.subscribe(player);
    players.set(guildId, player);

    if (textChannel) {
      textChannel.send(`🎵 再生開始: **${title}**`).catch(() => {});
    }

  } catch (err) {
    console.error("playNext error:", err);
    if (textChannel) textChannel.send("⚠️ 再生中にエラーが発生しました").catch(() => {});
  }
}

// 再生追加（YouTube or 添付ファイル）
async function playUrl(guildId, url, textChannel, voiceChannel, attachmentFilename = null) {
  try {
    if (!voiceChannel && !connections.has(guildId)) {
      if (textChannel) textChannel.send("❌ VCに参加してください").catch(() => {});
      return null;
    }
    if (!queues.has(guildId)) queues.set(guildId, []);

    let title = attachmentFilename || "不明なタイトル";

    if (attachmentFilename) {
      queues.get(guildId).push({ url, title, isYouTube: false, isAttachment: true });
    } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
      title = await new Promise(resolve => {
        try {
          const ytdlp = spawn('yt-dlp', ['--get-title', url]);
          let data = '';
          ytdlp.stdout.on('data', chunk => data += chunk.toString());
          ytdlp.on('close', () => resolve(data.trim() || "不明なタイトル"));
          ytdlp.on('error', err => { console.error("yt-dlp title error:", err); resolve("不明なタイトル"); });
        } catch { resolve("不明なタイトル"); }
      });
      queues.get(guildId).push({ url, title, isYouTube: true, isAttachment: false });
    } else {
      queues.get(guildId).push({ url, title, isYouTube: false, isAttachment: false });
    }

    const player = players.get(guildId);
    if (!player || player.state.status !== AudioPlayerStatus.Playing) {
      await playNext(guildId, textChannel, voiceChannel);
    } else {
      if (textChannel) textChannel.send(`▶️ キューに追加: **${title}**`).catch(() => {});
    }

    return title;
  } catch (err) {
    console.error("playUrl error:", err);
    if (textChannel) textChannel.send("⚠️ 再生に失敗しました").catch(() => {});
    return null;
  }
}

// 停止
function stopMusic(guildId) {
  try {
    const player = players.get(guildId);
    if (!player) return false;
    queues.set(guildId, []);
    player.stop();
    return true;
  } catch (err) {
    console.error("stopMusic error:", err);
    return false;
  }
}

module.exports = {
  joinVoice,
  leaveVoice,
  playUrl,
  stopMusic,
};