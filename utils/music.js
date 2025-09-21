// utils/music.js
const { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus 
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const https = require('https');

// 接続情報を保持する Map
const connections = new Map();
const players = new Map();

// === ボイスチャンネル参加 ===
async function joinVoice(guild, channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false
  });
  connections.set(guild.id, connection);
  return true;
}

// === VC退出 ===
async function leaveVoice(guildId) {
  const conn = connections.get(guildId);
  if (conn) {
    conn.destroy();
    connections.delete(guildId);
    players.delete(guildId);
  }
}

// === 添付ファイルをダウンロードして再生 ===
async function playAttachment(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  const tmpFile = path.join(__dirname, `../tmp_attach_${Date.now()}.mp3`);

  // ダウンロード
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tmpFile);
    https.get(url, response => {
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlink(tmpFile, () => {});
      reject(err);
    });
  });

  const player = createAudioPlayer();
  const resource = createAudioResource(tmpFile, { inlineVolume: true });
  resource.volume.setVolume(0.8);

  player.play(resource);

  player.on(AudioPlayerStatus.Idle, () => {
    player.stop();
    fs.unlink(tmpFile, () => {}); // 再生後に削除
  });
  player.on('error', err => console.error('❌ Player error (attachment):', err));

  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`📎 添付ファイル再生開始: ${url}`);
}

// === YouTube再生（yt-dlp利用） ===
async function playYouTube(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  const tmpFile = path.join(__dirname, `../tmp_${Date.now()}.wav`);

  await new Promise((resolve, reject) => {
    const cmd = `yt-dlp -x --audio-format wav -o "${tmpFile}" "${url}"`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });

  const player = createAudioPlayer();
  const resource = createAudioResource(tmpFile, { inlineVolume: true });
  resource.volume.setVolume(0.8);

  player.play(resource);

  player.on(AudioPlayerStatus.Idle, () => {
    player.stop();
    fs.unlink(tmpFile, () => {});
  });
  player.on('error', err => console.error('❌ Player error (YouTube):', err));

  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`🎵 YouTube再生開始: ${url}`);
}

// === 再生停止 ===
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