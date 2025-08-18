// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const playdl = require('play-dl');

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
  if (!next) return;

  try {
    const src = await playdl.stream(next.url, { discordPlayerCompatibility: true }).catch(async (e) => {
      // YouTubeからストリーム取得失敗時のエラーをログに出力
      console.error('Failed to get YouTube stream:', e);

      // Spotifyなど→YouTube検索で代替
      const results = await playdl.search(next.url, { limit: 1 });
      if (!results?.length) throw new Error('検索失敗');

      // 検索結果のURLで再試行
      return await playdl.stream(results[0].url, { discordPlayerCompatibility: true });
    });

    const resource = createAudioResource(src.stream, { inputType: src.type });
    data.player.play(resource);
    textChannel?.send?.(`🎶 再生中: **${next.title}**`).catch(() => {});

    data.player.once(AudioPlayerStatus.Idle, () => {
      _playNext(guildId, textChannel);
    });
  } catch (e) {
    // 再生プロセス全体でエラーが発生した場合のログ
    console.error('Playback failed:', e);
    textChannel?.send?.('⚠️ 再生に失敗しました').catch(() => {});
    _playNext(guildId, textChannel);
  }
}

async function playUrl(guildId, queryOrUrl, textChannel) {
  const data = queues.get(guildId);
  if (!data) return null;

  // URLか検索クエリかを判定
  let url = queryOrUrl;
  let title = queryOrUrl;

  try {
    // URLか？
    const u = new URL(queryOrUrl);
    // YouTube/Spotifyの簡易対応：タイトルを取得
    if (playdl.yt_validate(queryOrUrl) !== 'search') {
      const info = await playdl.video_info(queryOrUrl).catch(() => null);
      if (info?.video_details?.title) title = info.video_details.title;
    } else {
      title = queryOrUrl;
    }
  } catch {
    // 検索 → 最初の結果
    const results = await playdl.search(queryOrUrl, { limit: 1 });
    if (!results?.length) return null;
    url = results[0].url;
    title = results[0].title || queryOrUrl;
  }

  data.queue.push({ title, url });
  if (data.player.state.status !== AudioPlayerStatus.Playing) {
    _playNext(guildId, textChannel);
  }
  return title;
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
  leaveVoice
};
