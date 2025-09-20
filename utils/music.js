// utils/music.js
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior } = require('@discordjs/voice');
const ytdlp = require('yt-dlp-exec');
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');

// ギルドごとの再生情報を保存
const connections = new Map();

/**
 * ボイスチャンネルに参加
 */
async function joinVoice(guild, channel) {
  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    connections.set(guild.id, { connection, player: null });
    return true;
  } catch (err) {
    console.error('❌ joinVoice error:', err);
    return false;
  }
}

/**
 * YouTube 音楽再生 (yt-dlp + ffmpeg)
 */
async function playYouTube(guildId, url, textChannel, voiceChannel) {
  try {
    if (!connections.has(guildId)) {
      const ok = await joinVoice(voiceChannel.guild, voiceChannel);
      if (!ok) return textChannel.send('❌ ボイスチャンネルに参加できませんでした');
    }

    const { connection } = connections.get(guildId);

    // yt-dlp で音声ストリーム取得
    const ytdlpProcess = spawn('yt-dlp', [
      '-f', 'bestaudio',
      '-o', '-',
      url
    ], { shell: true });

    // ffmpeg で Discord 再生用に変換
    const ffmpegProcess = spawn(ffmpeg, [
      '-i', 'pipe:0',
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'ignore'] });

    ytdlpProcess.stdout.pipe(ffmpegProcess.stdin);

    const resource = createAudioResource(ffmpegProcess.stdout);
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });

    player.play(resource);
    connection.subscribe(player);

    connections.set(guildId, { connection, player });
    textChannel.send(`🎶 再生開始: ${url}`);

    player.on(AudioPlayerStatus.Idle, () => {
      textChannel.send('⏹️ 再生終了');
    });

  } catch (err) {
    console.error('❌ playYouTube error:', err);
    textChannel.send(`⚠️ 再生エラー: ${err.message}`);
  }
}

/**
 * 添付ファイルや直接の音声URLを再生
 */
async function playAttachment(guildId, url, textChannel, voiceChannel) {
  try {
    if (!connections.has(guildId)) {
      const ok = await joinVoice(voiceChannel.guild, voiceChannel);
      if (!ok) return textChannel.send('❌ ボイスチャンネルに参加できませんでした');
    }

    const { connection } = connections.get(guildId);
    const resource = createAudioResource(url);
    const player = createAudioPlayer();

    player.play(resource);
    connection.subscribe(player);

    connections.set(guildId, { connection, player });
    textChannel.send(`📂 ファイル再生: ${url}`);

    player.on(AudioPlayerStatus.Idle, () => {
      textChannel.send('⏹️ 再生終了');
    });
  } catch (err) {
    console.error('❌ playAttachment error:', err);
    textChannel.send(`⚠️ 再生エラー: ${err.message}`);
  }
}

/**
 * 再生停止
 */
function stopMusic(guildId) {
  if (!connections.has(guildId)) return false;
  const { player } = connections.get(guildId);
  if (player) player.stop();
  return true;
}

/**
 * ボイスチャンネル退出
 */
async function leaveVoice(guildId) {
  if (connections.has(guildId)) {
    const { connection } = connections.get(guildId);
    connection.destroy();
    connections.delete(guildId);
  }
}

module.exports = {
  joinVoice,
  playYouTube,
  playAttachment,
  stopMusic,
  leaveVoice,
};