const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const connections = new Map();
const players = new Map();

async function joinVoice(guild, channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator
  });
  connections.set(guild.id, connection);
  return true;
}

async function leaveVoice(guildId) {
  const conn = connections.get(guildId);
  if (conn) {
    conn.destroy();
    connections.delete(guildId);
    players.delete(guildId);
  }
}

async function playAttachment(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  const player = createAudioPlayer();
  const resource = createAudioResource(url);
  player.play(resource);

  player.on(AudioPlayerStatus.Idle, () => player.stop());

  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`🎵 再生開始: ${url}`);
  return url;
}

async function playYouTube(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  const tmpFile = path.join(__dirname, `../tmp_${Date.now()}.mp3`);
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
    fs.unlink(tmpFile, () => {}); // 再生後削除
  });

  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`🎵 YouTube再生開始: ${url}`);
  return url;
}

// 🔹 ここ追加
async function playUrl(guildId, url, textChannel, voiceChannel) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return playYouTube(guildId, url, textChannel, voiceChannel);
  } else {
    return playAttachment(guildId, url, textChannel, voiceChannel);
  }
}

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
  playUrl, // ← 追加
  stopMusic
};