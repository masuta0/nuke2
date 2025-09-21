// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');

// 接続情報と再生キューを保持
const connections = new Map();
const players = new Map();
const queues = new Map();

// ボイスチャンネルに参加
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
  if (conn) conn.destroy();
  connections.delete(guildId);
  players.delete(guildId);
  queues.delete(guildId);
}

// 曲を再生
async function playUrl(guildId, query, textChannel, voiceChannel) {
  // 接続
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  // URLか検索か判定
  let url = query;
  if (!ytdl.validateURL(query)) {
    const searchResult = await ytSearch(query);
    if (!searchResult || !searchResult.videos.length) return null;
    url = searchResult.videos[0].url;
  }

  // キュー初期化
  if (!queues.has(guildId)) queues.set(guildId, []);
  const queue = queues.get(guildId);
  queue.push({ url, textChannel });

  // すでに再生中なら追加のみ
  if (players.has(guildId) && players.get(guildId)._state.status !== AudioPlayerStatus.Idle) {
    return (await ytdl.getInfo(url)).videoDetails.title;
  }

  // 再生関数
  const playNext = async () => {
    const item = queue.shift();
    if (!item) return;

    const stream = ytdl(item.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
    const resource = createAudioResource(stream);
    const player = createAudioPlayer();

    player.play(resource);
    player.on(AudioPlayerStatus.Idle, () => playNext());
    players.set(guildId, player);

    const conn = connections.get(guildId);
    conn.subscribe(player);

    const info = await ytdl.getInfo(item.url);
    item.textChannel.send(`▶️ 再生開始: **${info.videoDetails.title}**`);
  };

  // 再生開始
  await playNext();

  const info = await ytdl.getInfo(url);
  return info.videoDetails.title;
}

// 再生停止
function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  player.stop();
  queues.set(guildId, []); // キュークリア
  return true;
}

module.exports = {
  joinVoice,
  leaveVoice,
  playUrl,
  stopMusic,
};