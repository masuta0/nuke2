// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, getVoiceConnection } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');

const queueMap = new Map(); // guildId -> [{ title, url, requestedBy }]
const playerMap = new Map(); // guildId -> AudioPlayer

// 再生可能チャンネルID
const MUSIC_CHANNEL_ID = '1419041571944403046';

// ボイスチャンネル参加
async function joinVoice(guild, voiceChannel) {
  try {
    joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    return true;
  } catch (err) {
    console.error('joinVoice error:', err);
    return false;
  }
}

// 曲情報取得（URLまたは検索）
async function getTrack(query) {
  let url, title;
  if (ytdl.validateURL(query)) {
    url = query;
    const info = await ytdl.getInfo(url);
    title = info.videoDetails.title;
  } else {
    const r = await ytSearch(query);
    const video = r.videos.length > 0 ? r.videos[0] : null;
    if (!video) return null;
    url = video.url;
    title = video.title;
  }
  return { url, title };
}

// 再生開始
async function startPlaying(guildId, channel) {
  const queue = queueMap.get(guildId);
  if (!queue || queue.length === 0) return;

  let player = playerMap.get(guildId);
  if (!player) {
    player = createAudioPlayer();
    playerMap.set(guildId, player);
    player.on(AudioPlayerStatus.Idle, () => {
      queue.shift();
      if (queue.length > 0) startPlaying(guildId, channel);
    });
  }

  const connection = getVoiceConnection(channel.guild.id);
  if (!connection) return;

  const track = queue[0];
  const stream = ytdl(track.url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1<<25 });
  const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
  player.play(resource);
  connection.subscribe(player);

  channel.send(`▶️ 再生開始: **${track.title}** (リクエスト: ${track.requestedBy})`);
}

// 曲をキューに追加 / 再生
async function playUrl(guildId, query, channel, member, msg) {
  if (channel.id !== MUSIC_CHANNEL_ID) {
    await msg?.delete().catch(() => {});
    await member.send('このチャンネルでは !play コマンドを使えません').catch(() => {});
    return null;
  }

  const track = await getTrack(query);
  if (!track) return null;

  if (!queueMap.has(guildId)) queueMap.set(guildId, []);
  const queue = queueMap.get(guildId);

  queue.push({ ...track, requestedBy: member.user.tag });

  if (queue.length === 1) {
    await startPlaying(guildId, channel);
  } else {
    channel.send(`➕ キューに追加: **${track.title}** (リクエスト: ${member.user.tag})`);
  }

  return track.title;
}

// 停止
function stopMusic(guildId) {
  const player = playerMap.get(guildId);
  if (player) {
    player.stop();
    queueMap.set(guildId, []);
    return true;
  }
  return false;
}

// VC退出
async function leaveVoice(guildId) {
  const connection = getVoiceConnection(guildId);
  if (connection) connection.destroy();
  queueMap.set(guildId, []);
  playerMap.delete(guildId);
}

module.exports = {
  joinVoice,
  playUrl,
  stopMusic,
  leaveVoice,
};