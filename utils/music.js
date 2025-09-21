const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');

// サーバーごとの接続・キュー管理
const connections = new Map();
const queues = new Map();
const players = new Map();

async function joinVoice(guild, channel) {
  if (connections.has(guild.id)) return connections.get(guild.id);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator
  });
  connections.set(guild.id, connection);
  return connection;
}

async function leaveVoice(guildId) {
  const conn = connections.get(guildId);
  if (conn) conn.destroy();
  connections.delete(guildId);
  queues.delete(guildId);
  players.delete(guildId);
}

async function playUrl(guildId, url, textChannel, voiceChannel) {
  await joinVoice(voiceChannel.guild, voiceChannel);

  if (!queues.has(guildId)) queues.set(guildId, []);
  const queue = queues.get(guildId);

  // 情報取得
  const info = await ytdl.getInfo(url);
  const title = info.videoDetails.title;

  queue.push({ url, title, textChannel, voiceChannel });

  if (!players.has(guildId)) playNext(guildId);

  return title;
}

function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) {
    players.delete(guildId);
    return;
  }

  const { url, textChannel, voiceChannel, title } = queue.shift();
  const connection = connections.get(guildId);
  const player = createAudioPlayer();

  const stream = ytdl(url, { filter: 'audioonly', highWaterMark: 1 << 25 });
  const resource = createAudioResource(stream);
  player.play(resource);
  connection.subscribe(player);
  players.set(guildId, player);

  textChannel.send(`▶️ 再生開始: **${title}**`);

  player.on(AudioPlayerStatus.Idle, () => {
    playNext(guildId);
  });

  player.on('error', (err) => {
    console.error('❌ 再生エラー:', err);
    playNext(guildId);
  });
}

function stopMusic(guildId) {
  const player = players.get(guildId);
  if (!player) return false;

  const queue = queues.get(guildId);
  if (queue) queue.length = 0;

  player.stop();
  return true;
}

module.exports = { joinVoice, leaveVoice, playUrl, stopMusic };