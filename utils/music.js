const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const connections = new Map();
const players = new Map();
const queues = new Map(); // 🔹 ギルドごとの再生キュー

// VC参加
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
    queues.delete(guildId);
  }
}

// 再生処理
async function playNext(guildId, textChannel, voiceChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) return;

  const { url, title, isYouTube } = queue.shift();
  let resourcePath = url;

  // YouTubeなら一時ファイルに保存
  if (isYouTube) {
    resourcePath = path.join(__dirname, `../tmp_${Date.now()}.mp3`);
    await new Promise((resolve, reject) => {
      const cmd = `yt-dlp -x --audio-format mp3 -o "${resourcePath}" "${url}"`;
      exec(cmd, (err) => (err ? reject(err) : resolve()));
    });
  }

  const player = createAudioPlayer();
  const resource = createAudioResource(resourcePath);
  player.play(resource);

  player.on(AudioPlayerStatus.Idle, () => {
    player.stop();
    if (isYouTube) fs.unlink(resourcePath, () => {}); // YouTubeは再生後削除
    playNext(guildId, textChannel, voiceChannel); // 次を再生
  });

  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`🎵 再生開始: **${title}**`);
}

// 添付ファイルを追加
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

// YouTubeを追加
async function playYouTube(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  // タイトル取得
  const title = await new Promise((resolve) => {
    exec(`yt-dlp --get-title "${url}"`, (err, stdout) => {
      resolve(err ? '不明なタイトル' : stdout.trim());
    });
  });

  if (!queues.has(guildId)) queues.set(guildId, []);
  queues.get(guildId).push({ url, title, isYouTube: true });

  if (players.get(guildId)?.state.status !== AudioPlayerStatus.Playing) {
    playNext(guildId, textChannel, voiceChannel);
  } else {
    textChannel.send(`▶️ キューに追加: **${title}**`);
  }
  return title;
}

// 共通エントリ
async function playUrl(guildId, url, textChannel, voiceChannel) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return playYouTube(guildId, url, textChannel, voiceChannel);
  } else {
    return playAttachment(guildId, url, textChannel, voiceChannel);
  }
}

// 停止
function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  queues.set(guildId, []); // キューも空にする
  player.stop();
  return true;
}

module.exports = {
  joinVoice,
  leaveVoice,
  playUrl,
  stopMusic
};