// utils/music.js
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
} = require("@discordjs/voice");
const play = require("play-dl");

const guildPlayers = new Map(); // ギルドごとにプレイヤー管理

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
    console.error("❌ joinVoice エラー:", err);
    return false;
  }
}

// === URL再生 (YouTube, Spotify, SoundCloud対応) ===
async function playUrl(guildId, url, textChannel) {
  try {
    // URLの確認
    if (!await play.validate(url)) {
      return null;
    }

    // 動画情報
    const info = await play.video_basic_info(url);
    const title = info.video_details.title;

    // ストリーム作成
    const stream = await play.stream(url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });

    // プレイヤー取得または新規作成
    let player = guildPlayers.get(guildId);
    if (!player) {
      player = createAudioPlayer();
      guildPlayers.set(guildId, player);

      player.on(AudioPlayerStatus.Idle, () => {
        textChannel.send("⏹️ 再生が終了しました");
      });

      player.on("error", (err) => {
        console.error("❌ AudioPlayer エラー:", err);
        textChannel.send("⚠ 再生中にエラーが発生しました");
      });
    }

    // VC接続チェック
    const connection = getVoiceConnection(guildId);
    if (!connection) {
      textChannel.send("❌ ボイスチャンネルに接続していません");
      return null;
    }

    // 再生開始
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