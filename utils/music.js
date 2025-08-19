// utils/music.js

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const playdl = require('play-dl');
const { YOUTUBE_COOKIE } = require('../config.json');

// play-dlに認証クッキーを設定
if (YOUTUBE_COOKIE) {
  playdl.set_cookies([
    { name: '__Secure-3PAPISID', value: YOUTUBE_COOKIE, domain: '.youtube.com' }
  ]).then(() => {
    console.log('✅ YouTube認証クッキーが設定されました');
  }).catch(err => {
    console.error('❌ YouTube認証クッキーの設定に失敗しました:', err);
  });
}

const queues = new Map(); // guildId -> { connection, player, queue: [{title,url}] }

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

  // ★ 修正1: キューから取り出したアイテムとURLが有効かを確認
  if (!next || !next.url || typeof next.url !== 'string') {
    console.error('⚠️ キューから取り出したアイテムに有効なURLがありません。次の曲にスキップします。');
    if (textChannel) {
      textChannel.send('⚠️ 再生に問題が発生しました。次の曲にスキップします。').catch(() => {});
    }
    // 次の曲があれば、再帰的に_playNextを呼び出す
    if (data.queue.length > 0) {
      _playNext(guildId, textChannel);
    }
    return;
  }

  try {
    const src = await playdl.stream(next.url, { discordPlayerCompatibility: true }).catch(async (e) => {
      console.error('Failed to get YouTube stream:', e);

      const results = await playdl.search(next.url, { limit: 1 });
      if (!results?.length) throw new Error('検索失敗');

      return await playdl.stream(results[0].url, { discordPlayerCompatibility: true });
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

  let url = queryOrUrl;
  let title = queryOrUrl;

  try {
    const u = new URL(queryOrUrl);
    if (playdl.yt_validate(queryOrUrl) !== 'search') {
      const info = await playdl.video_info(queryOrUrl).catch(() => null);
      if (info?.video_details?.title) title = info.video_details.title;
      // URLがYouTubeのものでない場合、そのままでは再生できない可能性があるため、検索にフォールバック
      if (info === null && playdl.yt_validate(queryOrUrl) === 'url') {
        const results = await playdl.search(queryOrUrl, { limit: 1 });
        if (results?.length) {
          url = results[0].url;
          title = results[0].title;
        } else {
          // 検索でも見つからない場合は処理を終了
          console.error(`URLから動画情報を取得できませんでした: ${queryOrUrl}`);
          return null;
        }
      }
    }
  } catch {
    // URLとして無効な場合は、検索クエリとして扱う
    const results = await playdl.search(queryOrUrl, { limit: 1 });
    if (!results?.length) {
      console.error(`検索クエリから動画が見つかりませんでした: ${queryOrUrl}`);
      return null;
    }
    url = results[0].url;
    title = results[0].title || queryOrUrl;
  }

  // ★ 修正2: 最後にurl変数が有効かを確認
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    console.error(`キューに追加しようとしたURLが無効です。入力: ${queryOrUrl}, 最終URL: ${url}`);
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
