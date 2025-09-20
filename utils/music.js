// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ffmpeg = require('ffmpeg-static');

// 接続情報を保持する Map
const connections = new Map();
const players = new Map();

// ボイスチャンネルに参加
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
    players.delete(guildId);
  }
}

// 添付ファイル再生
async function playAttachment(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  const player = createAudioPlayer();
  const resource = createAudioResource(url);
  player.play(resource);

  player.on(AudioPlayerStatus.Idle, () => {
    player.stop();
  });

  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`🎵 再生開始: ${url}`);
}

// YouTube再生（yt-dlpを直接利用）
async function playYouTube(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  const tmpFile = path.join(__dirname, `../tmp_${Date.now()}.mp3`);
  // yt-dlp + ffmpeg で mp3 に変換して保存
  await new Promise((resolve, reject) => {
    const cmd = `yt-dlp -x --audio-format mp3 -o "${tmpFile}" "${url}"`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });

  const player = createAudioPlayer();
  const resource = createAudioResource(tmpFile);
  player.play(resource);

  player.on(AudioPlayerStatus.Idle, () => {
    player.stop();
    fs.unlink(tmpFile, () => {}); // 再生後にファイル削除
  });

  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`🎵 YouTube再生開始: ${url}`);
}

// 再生停止
function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  player.stop();
  return true;
}

module.exports = {
  joinVoice,
  leaveVoice,
  playAttachment,
  playYouTube,
  stopMusic
};