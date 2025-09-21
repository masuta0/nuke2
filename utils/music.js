// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const ytSearch = require('yt-search');

const connections = new Map();
const players = new Map();
const queues = new Map();

// ボイスチャンネルに参加
async function joinVoice(guild, channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator
  });
  connections.set(guild.id, connection);
  return connection;
}

// キューに追加して再生
async function playUrl(guildId, query, textChannel, voiceChannel) {
  // ボイス接続
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  // 検索ワードの場合は URL に変換
  let url = query;
  if (!query.startsWith('http')) {
    const result = await ytSearch(query);
    if (!result || !result.videos.length) return null;
    url = result.videos[0].url;
  }

  // キュー管理
  if (!queues.has(guildId)) queues.set(guildId, []);
  const queue = queues.get(guildId);
  queue.push({ url, textChannel });

  // プレイヤー作成
  if (!players.has(guildId)) {
    const player = createAudioPlayer();
    player.on(AudioPlayerStatus.Idle, () => playNext(guildId));
    players.set(guildId, player);
    const connection = connections.get(guildId);
    connection.subscribe(player);
    playNext(guildId);
  }

  return url;
}

// キュー再生
async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) {
    // キューが空なら退出
    const conn = connections.get(guildId);
    if (conn) conn.destroy();
    connections.delete(guildId);
    players.delete(guildId);
    queues.delete(guildId);
    return;
  }

  const { url, textChannel } = queue.shift();

  const tmpFile = path.join(__dirname, `../tmp_${Date.now()}.mp3`);
  // yt-dlp で mp3 ダウンロード
  exec(`yt-dlp -x --audio-format mp3 -o "${tmpFile}" "${url}"`, (err) => {
    if (err) {
      console.error('❌ !play エラー:', err);
      playNext(guildId); // 次の曲へ
      return;
    }

    const player = players.get(guildId);
    const resource = createAudioResource(tmpFile);
    player.play(resource);

    player.once(AudioPlayerStatus.Idle, () => {
      fs.unlink(tmpFile, () => {}); // 再生後削除
      playNext(guildId);
    });

    textChannel.send(`▶️ 再生開始: **${url}**`);
  });
}

// 再生停止
function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  player.stop();
  queues.delete(guildId);
  return true;
}

// VC退出
async function leaveVoice(guildId) {
  const conn = connections.get(guildId);
  if (conn) conn.destroy();
  connections.delete(guildId);
  players.delete(guildId);
  queues.delete(guildId);
}

module.exports = {
  joinVoice,
  playUrl,
  stopMusic,
  leaveVoice
};