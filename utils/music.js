// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection, NoSubscriberBehavior } = require('@discordjs/voice');
const { execFile } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

const queueMap = new Map(); // guildId -> { queue: [], player, textChannel, voiceChannel }

async function joinVoice(guild, voiceChannel, textChannel) {
  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });

    // 初期化
    if (!queueMap.has(guild.id)) {
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
      connection.subscribe(player);
      queueMap.set(guild.id, { queue: [], player, textChannel, voiceChannel });
      player.on(AudioPlayerStatus.Idle, () => playNext(guild.id));
    } else {
      // textChannel 更新
      queueMap.get(guild.id).textChannel = textChannel;
    }
    return true;
  } catch (err) {
    console.error('joinVoice error:', err);
    return false;
  }
}

async function playUrl(guildId, urlOrQuery, textChannel) {
  const guildQueue = queueMap.get(guildId);
  if (!guildQueue) return null;

  const ytFile = path.join(__dirname, `tmp-${Date.now()}.mp3`);
  let title = '';

  await new Promise((resolve, reject) => {
    const ytdlp = execFile('yt-dlp', ['-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3', '-o', ytFile, urlOrQuery], (err, stdout, stderr) => {
      if (err) return reject(err);
      // 曲名取得
      const lines = stdout.toString().split('\n');
      const infoLine = lines.find(l => l.includes('[ExtractAudio] Destination:'));
      if (infoLine) title = path.basename(infoLine.split(':')[1].trim());
      resolve();
    });
  }).catch(err => {
    console.error('yt-dlp error:', err);
    textChannel.send('❌ YouTube 取得失敗');
  });

  guildQueue.queue.push({ file: ytFile, title });

  if (guildQueue.queue.length > 1) {
    textChannel.send(`➕ キューに追加: **${title}**`);
  }

  if (guildQueue.player.state.status !== AudioPlayerStatus.Playing) {
    playNext(guildId);
  }

  return title;
}

function playNext(guildId) {
  const guildQueue = queueMap.get(guildId);
  if (!guildQueue) return;

  const nextSong = guildQueue.queue.shift();
  if (!nextSong) return;

  const resource = createAudioResource(nextSong.file);
  guildQueue.player.play(resource);

  if (guildQueue.textChannel) {
    guildQueue.textChannel.send(`▶️ 再生中: **${nextSong.title}**`);
  }

  guildQueue.player.once(AudioPlayerStatus.Idle, () => {
    fs.unlink(nextSong.file, () => {});
    playNext(guildId);
  });
}

function stopMusic(guildId) {
  const guildQueue = queueMap.get(guildId);
  if (!guildQueue) return false;

  guildQueue.queue = [];
  guildQueue.player.stop(true);
  return true;
}

async function leaveVoice(guildId) {
  const guildQueue = queueMap.get(guildId);
  if (!guildQueue) return;

  const connection = getVoiceConnection(guildId);
  if (connection) connection.destroy();
  queueMap.delete(guildId);
}

module.exports = { joinVoice, playUrl, stopMusic, leaveVoice };