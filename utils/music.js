// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const ytDlp = require('yt-dlp'); // yt-dlp は npm 経由でインストール済み
const prism = require('prism-media');

const players = new Map();

// ボイスチャンネルに接続
async function joinVoice(guild, channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });
  if (!connection) return false;

  if (!players.has(guild.id)) {
    const player = createAudioPlayer();
    connection.subscribe(player);
    players.set(guild.id, player);
  }
  return true;
}

// 添付ファイルを再生
async function playAttachment(guildId, url, textChannel) {
  try {
    const player = players.get(guildId);
    if (!player) throw new Error('VC に接続されていません');

    const resource = createAudioResource(url); // 直接 URL を渡すと FFmpeg が処理
    player.play(resource);

    player.once(AudioPlayerStatus.Idle, () => {
      textChannel.send('▶️ 再生終了');
    });

    return true;
  } catch (e) {
    console.error('❌ playAttachment エラー:', e);
    return false;
  }
}

// YouTube を再生
async function playYouTube(guildId, youtubeUrl, textChannel) {
  try {
    const player = players.get(guildId);
    if (!player) throw new Error('VC に接続されていません');

    // yt-dlp で音声 URL を取得
    const info = await ytDlp.exec(youtubeUrl, { dumpSingleJson: true, extractAudio: true, audioFormat: 'mp3' });
    const audioUrl = info.url;

    const resource = createAudioResource(audioUrl);
    player.play(resource);

    player.once(AudioPlayerStatus.Idle, () => {
      textChannel.send('▶️ YouTube 再生終了');
    });

    return true;
  } catch (e) {
    console.error('❌ playYouTube エラー:', e);
    return false;
  }
}

// 再生停止
function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  player.stop(true);
  return true;
}

// VC 退出
async function leaveVoice(guildId) {
  const connection = getVoiceConnection(guildId);
  if (connection) connection.destroy();
  players.delete(guildId);
}

module.exports = {
  joinVoice,
  playAttachment,
  playYouTube,
  stopMusic,
  leaveVoice,
};