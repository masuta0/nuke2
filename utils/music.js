// utils/music.js
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// 接続情報
const connections = new Map();
const players = new Map();
const queues = new Map(); // ギルドごとの再生キュー

// === VC参加 ===
async function joinVoice(guild, channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator
  });
  connections.set(guild.id, connection);
  return true;
}

// === VC退出 ===
async function leaveVoice(guildId) {
  const conn = connections.get(guildId);
  if (conn) {
    conn.destroy();
    connections.delete(guildId);
    players.delete(guildId);
    queues.delete(guildId);
  }
}

// === YouTube / URL 再生 ===
async function playUrl(guildId, query, textChannel, voiceChannel) {
  if (!connections.has(guildId)) await joinVoice(voiceChannel.guild, voiceChannel);

  // 保存ファイル名
  const tmpFile = path.join(__dirname, `../tmp_${Date.now()}.mp3`);

  // yt-dlp コマンド
  // cookie.txt を置いたら bot 判定回避できる
  const cookieOption = fs.existsSync(path.join(__dirname, '../cookie.txt'))
    ? `--cookies "${path.join(__dirname, '../cookie.txt')}"`
    : '';

  const cmd = `yt-dlp -x --audio-format mp3 -o "${tmpFile}" ${cookieOption} "${query}" --print "%(title)s"`;

  let title = null;
  try {
    title = await new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(stdout.trim().split('\n').pop()); // 最後の行にタイトルが出る
      });
    });
  } catch (err) {
    console.error('yt-dlp エラー:', err);
    textChannel.send(`❌ 曲の取得に失敗しました: ${query}`);
    return null;
  }

  // キューに追加
  if (!queues.has(guildId)) queues.set(guildId, []);
  queues.get(guildId).push({ file: tmpFile, title, textChannel });
  if (!players.has(guildId)) startNext(guildId, voiceChannel);

  return title;
}

// === 次の曲を再生 ===
function startNext(guildId, voiceChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) {
    players.delete(guildId);
    return;
  }

  const { file, title, textChannel } = queue.shift();
  const player = createAudioPlayer();
  const resource = createAudioResource(file);

  player.play(resource);
  const conn = connections.get(guildId);
  conn.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`▶️ 再生中: **${title}**`);

  player.on(AudioPlayerStatus.Idle, () => {
    fs.unlink(file, () => {}); // 再生後に削除
    startNext(guildId, voiceChannel); // 次へ
  });
}

// === 再生停止 ===
function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;
  player.stop();
  queues.set(guildId, []); // キュークリア
  return true;
}

module.exports = {
  joinVoice,
  leaveVoice,
  playUrl,
  stopMusic
};