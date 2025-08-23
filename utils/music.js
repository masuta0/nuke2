const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const config = require('../config.json');
const { google } = require('googleapis');
const urlModule = require('url');

const YOUTUBE_API_KEY = config.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;

if (!YOUTUBE_API_KEY) {
  console.error('❌ YOUTUBE_API_KEYが設定されていません。');
}

const youtube = google.youtube({
  version: 'v3',
  auth: YOUTUBE_API_KEY,
});

const queues = new Map();

async function joinVoice(guild, voiceChannel) {
  try {
    const conn = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator
    });
    const player = createAudioPlayer();
    conn.subscribe(player);
    queues.set(guild.id, queues.get(guild.id) || { connection: conn, player, queue: [] });

    conn.on(VoiceConnectionStatus.Disconnected, () => {
      try { conn.destroy(); } catch {}
      queues.delete(guild.id);
    });

    const state = await entersState(conn, VoiceConnectionStatus.Ready, 10_000).catch(() => null);
    return !!state;
  } catch {
    return false;
  }
}

async function _playNext(guildId, textChannel) {
  const data = queues.get(guildId);
  if (!data) return;
  const next = data.queue.shift();

  if (!next || !next.url || typeof next.url !== 'string' || !ytdl.validateURL(next.url)) {
    if (textChannel) textChannel.send('⚠️ 再生に問題が発生しました。次の曲にスキップします。').catch(() => {});
    if (data.queue.length > 0) _playNext(guildId, textChannel);
    return;
  }

  try {
    const stream = ytdl(next.url, {
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25
    });

    const resource = createAudioResource(stream);
    data.player.play(resource);
    if (textChannel) {
      textChannel.send(`🎶 再生中: **${next.title}**`).catch(() => {});
    }

    data.player.once(AudioPlayerStatus.Idle, () => {
      _playNext(guildId, textChannel);
    });
  } catch (e) {
    if (textChannel) textChannel.send('⚠️ 再生に失敗しました').catch(() => {});
    _playNext(guildId, textChannel);
  }
}

async function playUrl(guildId, queryOrUrl, textChannel) {
  const data = queues.get(guildId);
  if (!data) return null;

  let url = null;
  let title = null;

  try {
    const isUrl = ytdl.validateURL(queryOrUrl);

    if (isUrl) {
      const videoId = new urlModule.URL(queryOrUrl).searchParams.get('v') || queryOrUrl.split('/').pop().split('?')[0];
      const apiResults = await youtube.videos.list({
        id: videoId,
        part: 'snippet',
      });
      if (apiResults?.data?.items?.length) {
        url = `https://www.youtube.com/watch?v=${apiResults.data.items[0].id}`;
        title = apiResults.data.items[0].snippet.title || queryOrUrl;
      }
    } else {
      const apiResults = await youtube.search.list({
        q: queryOrUrl,
        part: 'snippet',
        type: 'video',
        maxResults: 1
      });
      if (apiResults?.data?.items?.length) {
        url = `https://www.youtube.com/watch?v=${apiResults.data.items[0].id.videoId}`;
        title = apiResults.data.items[0].snippet.title || queryOrUrl;
      }
    }
  } catch (e) {
    console.error('❌ YouTube APIでの情報取得に失敗しました:', e);
    return null;
  }

  if (!url) return null;

  data.queue.push({ title, url });
  if (data.player.state.status !== AudioPlayerStatus.Playing) {
    _playNext(guildId, textChannel);
  }
  return title;
}

function stopMusic(guildId) {
  const data = queues.get(guildId);
  if (!data) return false;
  try { data.player.stop(); } catch {}
  data.queue = [];
  return true;
}

async function leaveVoice(guildId) {
  const data = queues.get(guildId);
  if (!data) return;
  try { data.player.stop(); } catch {}
  try { data.connection.destroy(); } catch {}
  queues.delete(guildId);
}

module.exports = {
  joinVoice,
  playUrl,
  stopMusic,
  leaveVoice
};