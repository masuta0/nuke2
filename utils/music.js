// utils/music.js

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const { google } = require('googleapis');
const ytdl = require('ytdl-core');

// サーバーごとのキュー管理
const queues = new Map();
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const youtube = google.youtube({
  version: 'v3',
  auth: YOUTUBE_API_KEY,
});

function extractVideoId(url) {
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// ボイスチャンネルに参加し、キューを初期化する関数
async function joinVoice(guild, voiceChannel) {
  if (queues.has(guild.id)) return false;

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });

  connection.subscribe(player);

  queues.set(guild.id, {
    voiceChannel,
    connection,
    player,
    queue: [],
    playing: false,
  });

  player.once(AudioPlayerStatus.Idle, () => {
    _playNext(guild.id, voiceChannel.guild.channels.cache.find(c => c.type === 0)); // チャンネルを特定する必要がある
  });

  return true;
}

// URLまたはクエリで音楽を再生キューに追加する関数
async function playUrl(guildId, queryOrUrl, textChannel) {
  const data = queues.get(guildId);
  if (!data) return null;

  let url = null;
  let title = null;

  try {
    const isUrl = ytdl.validateURL(queryOrUrl);
    let videoId = null;

    if (isUrl) {
      videoId = extractVideoId(queryOrUrl);
      if (videoId) {
        const apiResults = await youtube.videos.list({
          id: videoId,
          part: 'snippet',
        });
        if (apiResults?.data?.items?.length) {
          url = `https://www.youtube.com/watch?v=${videoId}`;
          title = apiResults.data.items[0].snippet.title;
        }
      }
    } else {
      const apiResults = await youtube.search.list({
        q: queryOrUrl,
        part: 'snippet',
        type: 'video',
        maxResults: 1,
      });

      if (apiResults?.data?.items?.length) {
        videoId = apiResults.data.items[0].id.videoId;
        url = `https://www.youtube.com/watch?v=${videoId}`;
        title = apiResults.data.items[0].snippet.title;
      } else {
        const info = await ytdl.getInfo(queryOrUrl).catch(() => null);
        if (info) {
          url = info.videoDetails.video_url;
          title = info.videoDetails.title;
        }
      }
    }
  } catch (e) {
    console.error('❌ YouTube情報取得エラー:', e);
  }

  if (!url || !title) {
    if (textChannel) {
      textChannel.send('❌ 曲が見つかりませんでした (APIキー or URLエラー)').catch(() => {});
    }
    return null;
  }

  data.queue.push({ title, url });
  if (data.player.state.status !== AudioPlayerStatus.Playing) {
    _playNext(guildId, textChannel);
  }
  return title;
}

function _playNext(guildId, textChannel) {
  const data = queues.get(guildId);
  if (!data || data.queue.length === 0) {
    data.playing = false;
    return;
  }

  const song = data.queue.shift();
  if (!song) return;

  const stream = ytdl(song.url, {
    filter: 'audioonly',
    quality: 'highestaudio',
    highWaterMark: 1 << 25,
  });

  const resource = createAudioResource(stream);
  data.player.play(resource);
  data.playing = true;

  textChannel.send(`🎶 再生中: **${song.title}**`).catch(() => {});

  data.player.once(AudioPlayerStatus.Idle, () => {
    _playNext(guildId, textChannel);
  });
}

function stopMusic(guildId) {
  const data = queues.get(guildId);
  if (!data) return false;
  data.queue = [];
  data.player.stop();
  data.connection.destroy();
  queues.delete(guildId);
  return true;
}

async function leaveVoice(guildId) {
  const data = queues.get(guildId);
  if (data) {
    data.connection.destroy();
    queues.delete(guildId);
    return true;
  }
  return false;
}

module.exports = {
  joinVoice,
  playUrl,
  stopMusic,
  leaveVoice,
};
