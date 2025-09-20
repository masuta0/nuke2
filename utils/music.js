const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
} = require("@discordjs/voice");
const https = require("https");
const fs = require("fs");
const path = require("path");

const guildPlayers = new Map();
// Node.jsでSodium読み込み
const sodium = require('libsodium-wrappers');

(async () => {
  await sodium.ready;
})();
// VCに参加
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

// 添付ファイル再生
async function playAttachment(guildId, attachmentUrl, textChannel) {
  try {
    const filePath = path.join("/tmp", path.basename(attachmentUrl));
    await downloadFile(attachmentUrl, filePath);

    const resource = createAudioResource(filePath);
    let player = guildPlayers.get(guildId);

    if (!player) {
      player = createAudioPlayer();
      guildPlayers.set(guildId, player);

      player.on(AudioPlayerStatus.Idle, () => {
        textChannel.send("⏹️ 再生終了");
        fs.unlink(filePath, () => {});
      });

      player.on("error", (err) => {
        console.error("❌ AudioPlayer エラー:", err);
        textChannel.send("⚠ 再生中にエラーが発生しました");
        fs.unlink(filePath, () => {});
      });
    }

    const connection = getVoiceConnection(guildId);
    if (!connection) {
      textChannel.send("❌ ボイスチャンネルに接続していません");
      fs.unlink(filePath, () => {});
      return false;
    }

    player.play(resource);
    connection.subscribe(player);
    return true;
  } catch (err) {
    console.error("❌ playAttachment エラー:", err);
    return false;
  }
}

// ファイルをダウンロード
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// 再生停止
function stopMusic(guildId) {
  const player = guildPlayers.get(guildId);
  if (!player) return false;
  player.stop();
  guildPlayers.delete(guildId);
  return true;
}

// VC退出
async function leaveVoice(guildId) {
  const connection = getVoiceConnection(guildId);
  if (connection) connection.destroy();
  guildPlayers.delete(guildId);
}

module.exports = {
  joinVoice,
  playAttachment,
  stopMusic,
  leaveVoice,
};