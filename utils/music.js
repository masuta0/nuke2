const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const { execFile } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const sodium = require('libsodium-wrappers');
const ytdlp = require('yt-dlp-exec');

const connections = new Map(); // guildId -> { connection, player, queue }

async function joinVoice(guild, channel) {
  if (!channel) return false;
  let connData = connections.get(guild.id);
  if (connData) return true; // 既に接続済み

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });

  const player = createAudioPlayer();

  player.on('error', e => console.error('AudioPlayerError:', e));

  connection.subscribe(player);

  connections.set(guild.id, { connection, player, queue: [] });
  return true;
}

async function leaveVoice(guildId) {
  const connData = connections.get(guildId);
  if (!connData) return false;
  connData.player.stop();
  connData.connection.destroy();
  connections.delete(guildId);
  return true;
}

function stopMusic(guildId) {
  const connData = connections.get(guildId);
  if (!connData) return false;
  connData.player.stop();
  connData.queue = [];
  return true;
}

async function playAttachment(guildId, url, textChannel) {
  const connData = connections.get(guildId);
  if (!connData) return false;

  try {
    const resource = createAudioResource(url, { inputType: 'arbitrary' });
    connData.player.play(resource);
    return true;
  } catch (err) {
    console.error('❌ playAttachment Error:', err);
    return false;
  }
}

async function playYouTube(guildId, url, textChannel) {
  const connData = connections.get(guildId);
  if (!connData) return false;

  try {
    // yt-dlp で URL から音声ファイルダウンロード
    const tempFile = path.join(__dirname, `../temp/${Date.now()}.mp3`);
    await fs.promises.mkdir(path.dirname(tempFile), { recursive: true });

    await ytdlp(url, {
      output: tempFile,
      format: 'bestaudio[ext=m4a]/bestaudio',
      ffmpegLocation: ffmpeg,
    });

    const resource = createAudioResource(tempFile);
    connData.player.play(resource);

    resource.playStream.on('end', () => {
      fs.promises.unlink(tempFile).catch(() => {});
    });

    return true;
  } catch (err) {
    console.error('❌ playYouTube Error:', err);
    return false;
  }
}

module.exports = { joinVoice, leaveVoice, stopMusic, playAttachment, playYouTube };