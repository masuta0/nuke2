const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ytdl = require('ytdl-core'); // 🔹 ストリーミング用

const connections = new Map();
const players = new Map();
const queues = new Map();

// ===== VC参加 =====
async function joinVoice(guild, channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator
  });
  connections.set(guild.id, connection);
  return true;
}

// ===== VC退出 =====
async function leaveVoice(guildId) {
  const conn = connections.get(guildId);
  if (conn) {
    conn.destroy();
    connections.delete(guildId);
    players.delete(guildId);
    queues.delete(guildId);
  }
}

// ===== 再生処理 =====
async function playNext(guildId, textChannel, voiceChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) return;

  const { url, title, isYouTube } = queue.shift();
  const player = createAudioPlayer();
  let resource;

  if (isYouTube) {
    // 🔹 ytdl-core を使ってストリーミング再生
    const stream = ytdl(url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25 // バッファ拡大で安定性アップ
    });
    resource = createAudioResource(stream);
  } else {
    // 添付ファイル（URLそのまま再生）
    resource = createAudioResource(url);
  }

  player.play(resource);

  player.on(AudioPlayerStatus.Idle, () => {
    player.stop();
    playNext(guildId, textChannel, voiceChannel); // 次の曲へ
  });

  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`🎵 再生開始: **${title}**`);
}

// ===== 添付ファイルを追加 =====
async function playAttachment(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  const title = path.basename(url);
  if (!queues.has(guildId)) queues.set(guildId, []);
  queues.get(guildId).push({ url, title, isYouTube: false });

  if (players.get(guildId)?.state.status !== AudioPlayerStatus.Playing) {
    playNext(guildId, textChannel, voiceChannel);
  } else {
    textChannel.send(`▶️ キューに追加: **${title}**`);
  }
  return title;
}

// ===== YouTubeを追加（高速化済み） =====
async function playYouTube(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  // 🔹 タイトルだけ取得
  let title = '不明なタイトル';
  try {
    const info = await ytdl.getInfo(url);
    title = info.videoDetails.title;
  } catch (e) {
    console.error('タイトル取得失敗:', e);
  }

  if (!queues.has(guildId)) queues.set(guildId, []);
  queues.get(guildId).push({ url, title, isYouTube: true });

  if (players.get(guildId)?.state.status !== AudioPlayerStatus.Playing) {
    playNext(guildId, textChannel, voiceChannel);
  } else {
    textChannel.send(`▶️ キューに追加: **${title}**`);
  }
  return title;
}

// ===== 共通エントリ =====
async function playUrl(guildId, url, textChannel, voiceChannel) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return playYouTube(guildId, url, textChannel, voiceChannel);
  } else {
    return playAttachment(guildId, url, textChannel, voiceChannel);
  }
}

// ===== 停止 =====
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