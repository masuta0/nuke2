// utils/music.js

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const playdl = require('play-dl');
const { YOUTUBE_COOKIE, YOUTUBE_API_KEY } = require('../config.json');
const { google } = require('googleapis');

// ★ デバッグログの追加: APIキーが読み込まれているかを確認
if (!YOUTUBE_API_KEY) {
  console.error('❌ YOUTUBE_API_KEYがconfig.jsonに設定されていません。');
} else {
  console.log('✅ YouTube APIキーが読み込まれました。');
}

// YouTube Data APIの初期化
const youtube = google.youtube({
  version: 'v3',
  auth: YOUTUBE_API_KEY,
});

if (YOUTUBE_COOKIE) {
  playdl.set_cookies([
    { name: '__Secure-3PAPISID', value: YOUTUBE_COOKIE, domain: '.youtube.com' }
  ]).then(() => {
    console.log('✅ YouTube認証クッキーが設定されました');
  }).catch(err => {
    console.error('❌ YouTube認証クッキーの設定に失敗しました:', err);
  });
}

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

  if (!next || !next.url || typeof next.url !== 'string') {
    console.error('⚠️ キューから取り出したアイテムに有効なURLがありません。次の曲にスキップします。');
    if (textChannel) {
      textChannel.send('⚠️ 再生に問題が発生しました。次の曲にスキップします。').catch(() => {});
    }
    if (data.queue.length > 0) {
      _playNext(guildId, textChannel);
    }
    return;
  }

  try {
    const src = await playdl.stream(next.url, { discordPlayerCompatibility: true }).catch(async (e) => {
      console.error('Failed to get YouTube stream:', e);

      const apiResults = await youtube.search.list({
        q: next.url,
        part: 'snippet',
        type: 'video',
        maxResults: 1
      });

      if (!apiResults?.data?.items?.length) throw new Error('API検索失敗');
      const fallbackUrl = `https://www.youtube.com/watch?v=${apiResults.data.items[0].id.videoId}`;

      return await playdl.stream(fallbackUrl, { discordPlayerCompatibility: true });
    });

    const resource = createAudioResource(src.stream, { inputType: src.type });
    data.player.play(resource);
    if (textChannel) {
      textChannel.send(`🎶 再生中: **${next.title}**`).catch(() => {});
    }

    data.player.once(AudioPlayerStatus.Idle, () => {
      _playNext(guildId, textChannel);
    });
  } catch (e) {
    console.error('Playback failed:', e);
    if (textChannel) {
      textChannel.send('⚠️ 再生に失敗しました').catch(() => {});
    }
    _playNext(guildId, textChannel);
  }
}

async function playUrl(guildId, queryOrUrl, textChannel) {
  const data = queues.get(guildId);
  if (!data) return null;

  let url = null; // ★ 修正: URLを初期値`null`で初期化
  let title = queryOrUrl;

  try {
    // ユーザー入力が有効なURLの場合
    const u = new URL(queryOrUrl);
    // play-dlで検証
    if (playdl.yt_validate(queryOrUrl) !== 'search') {
      const info = await playdl.video_info(queryOrUrl).catch(() => null);
      if (info?.video_details?.title) title = info.video_details.title;
      // URLが有効な形式でも、動画情報が取得できない場合はAPI検索にフォールバック
      if (info === null && playdl.yt_validate(queryOrUrl) === 'url') {
        const apiResults = await youtube.search.list({
          q: queryOrUrl,
          part: 'snippet',
          type: 'video',
          maxResults: 1
        });
        if (apiResults?.data?.items?.length) {
          url = `https://www.youtube.com/watch?v=${apiResults.data.items[0].id.videoId}`;
          title = apiResults.data.items[0].snippet.title;
        }
      } else {
        url = queryOrUrl; // play-dlで動画情報が取得できた場合はそのままURLを使用
      }
    } else {
      // ユーザー入力が検索クエリの場合
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
    // ユーザー入力がURLとして無効な場合
    console.log('入力がURLとして無効です。検索に切り替えます。');
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

  // ★ 最終的にURLが取得できたかを確認し、キューに追加
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    console.error(`❌ キューに追加する有効なURLを取得できませんでした。入力: ${queryOrUrl}`);
    return null;
  }

  data.queue.push({ title, url });
  if (data.player.state.status !== AudioPlayerStatus.Playing) {
    _playNext(guildId, textChannel);
  }
  return title;
}

function stopMusic(guildId) {
  const data = queues.get(guildId);
  if (!data) return false;
  try { 
    data.player.stop(); 
  } catch {}
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
