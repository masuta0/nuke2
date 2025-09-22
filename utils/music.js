// utils/music.js
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const { spawn } = require("child_process");
const stream = require("stream");
const path = require("path");

// yt-dlp と ffmpeg のフルパス
const YTDLP_PATH = "/usr/local/bin/yt-dlp";
const FFMPEG_PATH = "/usr/bin/ffmpeg";

// ギルドごとの接続やプレイヤー情報を保存
const connections = new Map();
const players = new Map();
const queues = new Map();

// VCに参加
async function joinVoice(guild, channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
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

// 次の曲を再生
async function playNext(guildId, textChannel, voiceChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) return;

  const { url, title } = queue.shift();
  const passThrough = new stream.PassThrough();

  // yt-dlp + ffmpeg でストリーム作成
  const ytdlp = spawn(YTDLP_PATH, ["-f", "bestaudio", "-o", "-", url], {
    stdio: ["ignore", "pipe", "ignore"],
  });

  const ffmpeg = spawn(FFMPEG_PATH, [
    "-i",
    "pipe:0",
    "-f",
    "opus",
    "-ar",
    "48000",
    "-ac",
    "2",
    "pipe:1",
  ]);

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(passThrough);

  const resource = createAudioResource(passThrough);
  const player = createAudioPlayer();

  player.play(resource);
  player.on(AudioPlayerStatus.Idle, () => {
    player.stop();
    playNext(guildId, textChannel, voiceChannel);
  });

  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`🎵 再生開始: **${title}**`);
}

// URL再生
async function playUrl(guildId, url, textChannel, voiceChannel) {
  if (!connections.has(guildId)) {
    await joinVoice(voiceChannel.guild, voiceChannel);
  }

  // yt-dlpでタイトル取得
  const title = await new Promise((resolve) => {
    const ytdlp = spawn(YTDLP_PATH, ["--get-title", url]);
    let data = "";
    ytdlp.stdout.on("data", (chunk) => {
      data += chunk.toString();
    });
    ytdlp.on("close", () => resolve(data.trim() || "不明なタイトル"));
  });

  if (!queues.has(guildId)) queues.set(guildId, []);
  queues.get(guildId).push({ url, title });

  const player = players.get(guildId);
  if (!player || player.state.status !== AudioPlayerStatus.Playing) {
    playNext(guildId, textChannel, voiceChannel);
  } else {
    textChannel.send(`▶️ キューに追加: **${title}**`);
  }

  return title;
}

// 再生停止
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
  stopMusic,
};