const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ytdl = require('ytdl-core');
const https = require('https');

// 接続情報とキュー
const connections = new Map();
const players = new Map();
const queues = new Map();

// ===== ボイスチャンネル参加 =====
async function joinVoice(guild, channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
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

// ===== 次の曲を再生 =====
async function playNext(guildId, textChannel, voiceChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) return;

  const { url, title, isYouTube } = queue.shift();

  const player = createAudioPlayer();
  let resource;

  if (isYouTube) {
    // yt-dlpで一時ファイルに保存して再生
    const tmpFile = path.join(__dirname, `../tmp_${Date.now()}.mp3`);
    await new Promise((resolve, reject) => {
      const cmd = `yt-dlp -x --audio-format mp3 -o "${tmpFile}" "${url}"`;
      exec(cmd, (err) => (err ? reject(err) : resolve()));
    });
    resource = createAudioResource(tmpFile);
    player.on(AudioPlayerStatus.Idle, () => {
      fs.unlink(tmpFile, () => {});
      playNext(guildId, textChannel, voiceChannel);
    });
  } else {
    // 添付ファイル（ローカルに保存済み）
    resource = createAudioResource(url);
    player.on(AudioPlayerStatus.Idle, () => {
      fs.unlink(url, () => {});
      playNext(guildId, textChannel, voiceChannel);
    });
  }

  player.play(resource);
  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`🎵 再生開始: **${title}**`);
}

// ===== URL（YouTube or 添付）を追加 =====
async function playUrl(guildId, query, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  // YouTube URL判定
  if (query.includes('youtube.com') || query.includes('youtu.be')) {
    let info;
    try {
      info = await ytdl.getInfo(query);
    } catch {
      return null;
    }
    const title = info.videoDetails.title;

    if (!queues.has(guildId)) queues.set(guildId, []);
    queues.get(guildId).push({ url: query, title, isYouTube: true });

    if (players.get(guildId)?.state.status !== AudioPlayerStatus.Playing) {
      playNext(guildId, textChannel, voiceChannel);
    } else {
      textChannel.send(`▶️ キューに追加: **${title}**`);
    }
    return title;
  }

  // 添付ファイル（直接URL）
  if (query.startsWith('http')) {
    const tmpFile = path.join(__dirname, `../tmp_attach_${Date.now()}.mp3`);
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tmpFile);
      https
        .get(query, (res) => {
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
        })
        .on('error', (err) => {
          fs.unlink(tmpFile, () => {});
          reject(err);
        });
    });

    const title = path.basename(query.split('?')[0]);
    if (!queues.has(guildId)) queues.set(guildId, []);
    queues.get(guildId).push({ url: tmpFile, title, isYouTube: false });

    if (players.get(guildId)?.state.status !== AudioPlayerStatus.Playing) {
      playNext(guildId, textChannel, voiceChannel);
    } else {
      textChannel.send(`▶️ キューに追加: **${title}**`);
    }
    return title;
  }

  return null;
}

// ===== 停止 =====
function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  player.stop();
  queues.set(guildId, []);
  return true;
}

module.exports = {
  joinVoice,
  leaveVoice,
  playUrl,
  stopMusic,
};