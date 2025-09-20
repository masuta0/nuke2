// utils/music.js
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
} = require("@discordjs/voice");
const play = require("play-dl");

const guildPlayers = new Map();

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

// === URL or キーワードから再生 ===
async function playUrl(guildId, query, textChannel) {
  try {
    let video;

    // URLなら直接取得
    if (await play.validate(query) === "yt_video") {
      video = await play.video_info(query);
    } else {
      // 検索して先頭を取得
      const searchResult = await play.search(query, { limit: 1 });
      if (!searchResult.length) return null;
      video = await play.video_info(searchResult[0].url);
    }

    const title = video.video_details.title;

    // ストリーム作成
    const stream = await play.stream(video.video_details.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });

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

    const connection = getVoiceConnection(guildId);
    if (!connection) {
      textChannel.send("❌ ボイスチャンネルに接続していません");
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