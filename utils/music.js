// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const prism = require('prism-media');
const ytdlp = require('yt-dlp-exec');

const connections = new Map(); // guildId -> VoiceConnection
const players = new Map();     // guildId -> AudioPlayer

// VCに参加
async function joinVoice(guild, channel) {
  try {
    const connection = joinVoiceChannel({
      guildId: guild.id,
      channelId: channel.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    connections.set(guild.id, connection);

    // 接続が準備完了するまで待機
    await entersState(connection, VoiceConnectionStatus.Ready, 10000);
    return true;
  } catch (err) {
    console.error('❌ joinVoice エラー:', err);
    return false;
  }
}

// VCから退出
async function leaveVoice(guildId) {
  const connection = connections.get(guildId);
  if (connection) {
    connection.destroy();
    connections.delete(guildId);
  }
  const player = players.get(guildId);
  if (player) {
    player.stop();
    players.delete(guildId);
  }
}

// 再生停止
function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  player.stop();
  return true;
}

// 添付ファイル再生
async function playAttachment(guildId, url, textChannel) {
  const connection = connections.get(guildId);
  if (!connection) return false;

  try {
    const ffmpeg = new prism.FFmpeg({ args: ['-i', url, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'] });
    const resource = createAudioResource(ffmpeg);

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    players.set(guildId, player);
    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      textChannel.send('▶️ 再生終了');
    });

    return true;
  } catch (err) {
    console.error('❌ playAttachment エラー:', err);
    return false;
  }
}

// YouTube再生
async function playYouTube(guildId, url, textChannel) {
  const connection = connections.get(guildId);
  if (!connection) return false;

  try {
    // yt-dlp で音声を取得して FFmpeg にパイプ
    const stream = ytdlp(url, {
      extractAudio: true,
      audioFormat: 'best',
      output: '-',
      quiet: true,
    });

    const ffmpeg = new prism.FFmpeg({ args: ['-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'] });
    const resource = createAudioResource(stream.stdout.pipe(ffmpeg));

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    players.set(guildId, player);
    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      textChannel.send('▶️ 再生終了');
    });

    return true;
  } catch (err) {
    console.error('❌ playYouTube エラー:', err);
    return false;
  }
}

module.exports = {
  joinVoice,
  leaveVoice,
  stopMusic,
  playAttachment,
  playYouTube,
};