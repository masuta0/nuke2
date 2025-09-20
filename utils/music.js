// utils/music.js
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
} = require("@discordjs/voice");
const ytdl = require("ytdl-core");

const guildPlayers = new Map(); // ギルドごとに音楽プレイヤーを保持

// === ボイスチャンネルに参加 ===
async function joinVoice(guild, channel) {
  try {
    joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    return true;
  } catch (err) {
    console.error("joinVoice エラー:", err);
    return false;
  }
}

// === YouTube URLを再生 ===
async function playUrl(guildId, url, textChannel) {
  if (!ytdl.validateURL(url)) return null;

  try {
    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title;

    const stream = ytdl(url, { filter: "audioonly", highWaterMark: 1 << 25 });
    const resource = createAudioResource(stream);

    let player = guildPlayers.get(guildId);
    if (!player) {
      player = createAudioPlayer();
      guildPlayers.set(guildId, player);

      player.on(AudioPlayerStatus.Idle, () => {
        textChannel.send("再生が終了しました");
      });

      player.on("error", (err) => {
        console.error("AudioPlayer エラー:", err);
        textChannel.send("⚠ 再生中にエラーが発生しました");
      });
    }

    const connection = getVoiceConnection(guildId);
    if (!connection) {
      textChannel.send("ボイスチャンネルに接続していません");
      return null;
    }

    player.play(resource);
    connection.subscribe(player);

    return title;
  } catch (err) {
    console.error("❌ playUrl エラー:", err);
    return null;
  }
}

// === 再生停止 ===
function stopMusic(guildId) {
  const player = guildPlayers.get(guildId);
  if (!player) return false;
  player.stop();
  guildPlayers.delete(guildId);
  return true;
}

// === ボイスチャンネル退出 ===
async function leaveVoice(guildId) {
  const connection = getVoiceConnection(guildId);
  if (connection) connection.destroy();
  guildPlayers.delete(guildId);
}

module.exports = {
  joinVoice,
  playUrl,
  stopMusic,
  leaveVoice,
};