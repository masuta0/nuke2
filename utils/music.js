// index.js
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const { google } = require('googleapis');
const ytdl = require('ytdl-core');

const TOKEN = process.env.TOKEN;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const youtube = google.youtube({
  version: 'v3',
  auth: YOUTUBE_API_KEY,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// サーバーごとのキュー管理
const queues = new Map();

function extractVideoId(url) {
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function createQueue(guildId, voiceChannel) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });

  connection.subscribe(player);

  queues.set(guildId, {
    voiceChannel,
    connection,
    player,
    queue: [],
    playing: false,
  });
}

async function playUrl(guildId, queryOrUrl, textChannel) {
  const data = queues.get(guildId);
  if (!data) return null;

  let url = null;
  let title = null;

  try {
    const isUrl = ytdl.validateURL(queryOrUrl);
    let videoId = null;

    if (isUrl) {
      videoId = extractVideoId(queryOrUrl);
      if (videoId) {
        const apiResults = await youtube.videos.list({
          id: videoId,
          part: 'snippet',
        });
        if (apiResults?.data?.items?.length) {
          url = `https://www.youtube.com/watch?v=${videoId}`;
          title = apiResults.data.items[0].snippet.title;
        }
      }
    } else {
      // 🔑 API検索
      const apiResults = await youtube.search.list({
        q: queryOrUrl,
        part: 'snippet',
        type: 'video',
        maxResults: 1,
      });

      if (apiResults?.data?.items?.length) {
        videoId = apiResults.data.items[0].id.videoId;
        url = `https://www.youtube.com/watch?v=${videoId}`;
        title = apiResults.data.items[0].snippet.title;
      } else {
        // 🔄 フォールバック
        const info = await ytdl.getInfo(queryOrUrl).catch(() => null);
        if (info) {
          url = info.videoDetails.video_url;
          title = info.videoDetails.title;
        }
      }
    }
  } catch (e) {
    console.error('❌ YouTube情報取得エラー:', e);
  }

  if (!url || !title) {
    if (textChannel) {
      textChannel.send('❌ 曲が見つかりませんでした (APIキー or URLエラー)').catch(() => {});
    }
    return null;
  }

  data.queue.push({ title, url });
  if (data.player.state.status !== AudioPlayerStatus.Playing) {
    _playNext(guildId, textChannel);
  }
  return title;
}

function _playNext(guildId, textChannel) {
  const data = queues.get(guildId);
  if (!data || data.queue.length === 0) {
    data.playing = false;
    return;
  }

  const song = data.queue.shift();
  if (!song) return;

  const stream = ytdl(song.url, {
    filter: 'audioonly',
    quality: 'highestaudio',
    highWaterMark: 1 << 25,
  });

  const resource = createAudioResource(stream);
  data.player.play(resource);
  data.playing = true;

  textChannel.send(`🎶 再生中: **${song.title}**`).catch(() => {});

  data.player.once(AudioPlayerStatus.Idle, () => {
    _playNext(guildId, textChannel);
  });
}

// 🎵 メッセージコマンド
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === '!play') {
    const query = args.join(' ');
    if (!query) {
      return message.reply('❌ 再生したい曲名またはURLを入力してください。');
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ 先にボイスチャンネルに参加してください。');
    }

    if (!queues.has(message.guild.id)) {
      createQueue(message.guild.id, voiceChannel);
    }

    const title = await playUrl(message.guild.id, query, message.channel);
    if (title) {
      message.channel.send(`✅ キューに追加: **${title}**`).catch(() => {});
    }
  }

  if (command === '!skip') {
    const data = queues.get(message.guild.id);
    if (data) {
      data.player.stop();
      message.channel.send('⏭️ スキップしました').catch(() => {});
    }
  }

  if (command === '!stop') {
    const data = queues.get(message.guild.id);
    if (data) {
      data.queue = [];
      data.player.stop();
      data.connection.destroy();
      queues.delete(message.guild.id);
      message.channel.send('🛑 再生を停止しました').catch(() => {});
    }
  }
});

client.once('ready', () => {
  console.log(`✅ ログイン完了: ${client.user.tag}`);
});