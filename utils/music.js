// music.js
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior
} = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const { google } = require('googleapis');
const urlModule = require('url');

// YouTube APIクライアント
const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY // .envにAPIキーを入れてね
});

// サーバーごとのキュー管理
const queues = new Map();

/**
 * 短縮URLや通常URLからvideoIdを抽出する
 */
function extractVideoId(queryOrUrl) {
  try {
    const parsed = new urlModule.URL(queryOrUrl);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1);
    }
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * ギルドのキューを作成
 */
function initQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      connection: null,
      player: createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause
        }
      }),
      queue: []
    });
  }
}

/**
 * 次の曲を再生
 */
async function _playNext(guildId, textChannel) {
  const data = queues.get(guildId);
  if (!data) return;

  const song = data.queue.shift();
  if (!song) {
    data.connection?.destroy();
    queues.delete(guildId);
    return;
  }

  try {
    const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
    const resource = createAudioResource(stream);
    data.player.play(resource);

    if (textChannel) {
      textChannel.send(`▶️ 再生中: **${song.title}**`).catch(() => {});
    }
  } catch (e) {
    console.error(`❌ 再生エラー: ${e}`);
    if (textChannel) {
      textChannel.send(`❌ 再生できませんでした: **${song.title}**`).catch(() => {});
    }
    _playNext(guildId, textChannel);
  }
}

/**
 * 音楽を再生 (URL または 検索ワード)
 */
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
        maxResults: 1
      });
      if (apiResults?.data?.items?.length) {
        videoId = apiResults.data.items[0].id.videoId;
        url = `https://www.youtube.com/watch?v=${videoId}`;
        title = apiResults.data.items[0].snippet.title;
      }
    }
  } catch (e) {
    console.error('❌ YouTube APIでの情報取得に失敗しました:', e);
    return null;
  }

  if (!url || !title) {
    if (textChannel) {
      textChannel.send('❌ 曲が見つかりませんでした').catch(() => {});
    }
    return null;
  }

  data.queue.push({ title, url });
  if (data.player.state.status !== AudioPlayerStatus.Playing) {
    _playNext(guildId, textChannel);
  }
  return title;
}

/**
 * VCへ参加
 */
function join(voiceChannel) {
  initQueue(voiceChannel.guild.id);
  const data = queues.get(voiceChannel.guild.id);

  if (!data.connection) {
    data.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator
    });
    data.connection.subscribe(data.player);
    data.player.on(AudioPlayerStatus.Idle, () => _playNext(voiceChannel.guild.id, voiceChannel));
  }

  return data;
}

/**
 * 再生をスキップ
 */
function skip(guildId, textChannel) {
  const data = queues.get(guildId);
  if (!data) return;
  if (data.player) {
    data.player.stop();
    if (textChannel) {
      textChannel.send('⏭️ スキップしました').catch(() => {});
    }
  }
}

/**
 * 停止
 */
function stop(guildId, textChannel) {
  const data = queues.get(guildId);
  if (!data) return;
  data.queue = [];
  data.player.stop();
  data.connection?.destroy();
  queues.delete(guildId);
  if (textChannel) {
    textChannel.send('⏹️ 停止しました').catch(() => {});
  }
}

module.exports = {
  join,
  playUrl,
  skip,
  stop
};