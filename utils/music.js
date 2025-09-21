// utils/music.js
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  getVoiceConnection 
} = require('@discordjs/voice');
const ytSearch = require('yt-search');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// VC接続情報と曲キューを保持する Map
const connections = new Map();
const queues = new Map();
const players = new Map();

// VCに参加
async function joinVoice(guild, channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator
  });
  connections.set(guild.id, connection);
  return true;
}

// VC退出
async function leaveVoice(guildId) {
  const conn = connections.get(guildId);
  if (conn) {
    conn.destroy();
    connections.delete(guildId);
    queues.delete(guildId);
    players.delete(guildId);
  }
}

// 曲を再生
async function playNext(guildId, textChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) return;

  const track = queue.shift(); // 次の曲を取り出す
  const tmpFile = path.join(__dirname, `../tmp_${Date.now()}.mp3`);

  await new Promise((resolve, reject) => {
    const cmd = `yt-dlp -x --audio-format mp3 -o "${tmpFile}" "${track.url}"`;
    exec(cmd, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  let player = players.get(guildId);
  if (!player) {
    player = createAudioPlayer();
    players.set(guildId, player);

    player.on(AudioPlayerStatus.Idle, () => {
      fs.unlink(tmpFile, () => {}); // 再生後にファイル削除
      playNext(guildId, textChannel); // 自動で次の曲
    });
  }

  const resource = createAudioResource(tmpFile);
  player.play(resource);

  const conn = connections.get(guildId);
  conn.subscribe(player);

  textChannel.send(`🎵 再生開始: **${track.title}**`);
}

// !play コマンド用
async function playUrl(guildId, query, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  let video;
  if (query.startsWith('http')) {
    video = { url: query, title: query };
  } else {
    const result = await ytSearch(query);
    if (!result || !result.videos || result.videos.length === 0) return null;
    video = result.videos[0];
  }

  // キュー追加
  const queue = queues.get(guildId) || [];
  queue.push(video);
  queues.set(guildId, queue);

  // キューの最初の曲なら再生開始
  if (queue.length === 1) await playNext(guildId, textChannel);

  return video.title;
}

// 再生停止
function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  player.stop();
  queues.delete(guildId);
  return true;
}

module.exports = {
  joinVoice,
  leaveVoice,
  playUrl,
  stopMusic
};