const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const queueMap = new Map(); // guildId -> queue info

function getQueue(guildId) {
  if (!queueMap.has(guildId)) {
    queueMap.set(guildId, {
      connection: null,
      player: createAudioPlayer(),
      tracks: [],
      playing: false
    });
  }
  return queueMap.get(guildId);
}

// VC に参加
async function joinVoice(guild, channel) {
  const queue = getQueue(guild.id);
  if (!queue.connection) {
    queue.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator
    });
    queue.connection.subscribe(queue.player);
  }
  return true;
}

// 曲を再生
async function playUrl(guildId, url, textChannel) {
  const queue = getQueue(guildId);

  let title = url;

  // yt-dlp で URL の情報取得
  if (url.startsWith('http')) {
    const outputFile = path.join(__dirname, `../tmp/${Date.now()}.mp3`);
    try {
      await new Promise((resolve, reject) => {
        exec(`mkdir -p tmp && yt-dlp -x --audio-format mp3 -o "${outputFile}" "${url}"`, (err, stdout, stderr) => {
          if (err) return reject(err);
          resolve();
        });
      });
      title = path.basename(outputFile);
      queue.tracks.push({ title, file: outputFile });
    } catch (err) {
      console.error('yt-dlp error:', err);
      return null;
    }
  } else {
    // ローカルファイルや添付ファイル
    queue.tracks.push({ title, file: url });
  }

  // 再生開始
  if (!queue.playing) playNext(guildId, textChannel);
  else textChannel.send(`➕ キューに追加: **${title}**`);

  return title;
}

function playNext(guildId, textChannel) {
  const queue = getQueue(guildId);
  const next = queue.tracks.shift();
  if (!next) {
    queue.playing = false;
    return;
  }

  const resource = createAudioResource(next.file, { inputType: StreamType.Arbitrary });
  queue.player.play(resource);
  queue.playing = true;
  textChannel.send(`▶️ 再生中: **${next.title}**`);

  queue.player.once(AudioPlayerStatus.Idle, () => {
    // 再生が終わったら次の曲
    playNext(guildId, textChannel);
    // ファイル削除
    if (next.file.startsWith(path.join(__dirname, '../tmp'))) fs.unlink(next.file, () => {});
  });
}

// 再生停止・キュークリア
function stopMusic(guildId) {
  const queue = getQueue(guildId);
  if (!queue.playing) return false;
  queue.player.stop();
  queue.tracks = [];
  queue.playing = false;
  return true;
}

// VC 退出
async function leaveVoice(guildId) {
  const queue = getQueue(guildId);
  if (queue.connection) {
    queue.player.stop();
    queue.connection.destroy();
    queue.connection = null;
    queue.tracks = [];
    queue.playing = false;
  }
}

module.exports = {
  joinVoice,
  playUrl,
  stopMusic,
  leaveVoice
};