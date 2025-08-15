// index.js (CommonJS)
require('dotenv').config();

const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

// fetch polyfill for Node < 18 or when library expects global fetch
// Install node-fetch: npm install node-fetch
try {
  if (!globalThis.fetch) {
    // node-fetch v3 is ESM — require('node-fetch') returns a function in CJS when installed appropriately.
    // If it fails at runtime in your environment, use a different polyfill that works there.
    globalThis.fetch = require('node-fetch');
  }
} catch (e) {
  // If node-fetch not available but Node has fetch (v18+), it's okay.
  if (!globalThis.fetch) {
    console.error('fetch is not available; install node-fetch or run on Node 18+');
  }
}

// google translate
const translateApi = require('@vitalets/google-translate-api');

// dropbox
const { Dropbox } = require('dropbox');

// discord & voice & play-dl
const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder, ActivityType, ChannelType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior } = require('@discordjs/voice');
const play = require('play-dl');

// Utilities
const delay = ms => new Promise(res => setTimeout(res, ms));
const BACKUP_DIR = process.env.BACKUP_PATH || './backups';
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const CLIENT_ID = process.env.CLIENT_ID;
const TOKEN = process.env.TOKEN;
const DROPBOX_TOKEN = process.env.DROPBOX_TOKEN || null;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

if (!TOKEN) console.warn('Warning: DISCORD token (TOKEN) is not set in env');

// Dropbox client (if token provided)
let dbx = null;
if (DROPBOX_TOKEN) {
  dbx = new Dropbox({ accessToken: DROPBOX_TOKEN, fetch: globalThis.fetch });
}

// discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates]
});

// in-memory maps
const msgCooldowns = new Map();
const userWeatherPrefs = new Map(); // userId -> pref string
const quizzes = []; // load from JSON if exists
const audioPlayers = new Map(); // guildId -> {connection, player}

// ===== Express Keep-Alive =====
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

if (process.env.SELF_URL) {
  setInterval(() => {
    https.get(process.env.SELF_URL, res => console.log(`Keep-Alive ping status: ${res.statusCode}`))
      .on('error', err => console.error('Keep-Alive ping error:', err.message));
  }, 4 * 60 * 1000);
}

// ===== Utility Helpers =====
function hasManageGuildPermission(member) {
  try {
    return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
  } catch (e) {
    return false;
  }
}

async function translateWithRetry(text, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await translateApi.translate(text, options); }
    catch (e) {
      if (e?.name === 'TooManyRequestsError') await delay(1500 * (i + 1));
      else throw e;
    }
  }
  throw new Error('翻訳APIが多すぎます');
}

// ===== Backup Functions (local only) =====
async function collectGuildBackup(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const roles = guild.roles.cache.filter(r => !r.managed)
    .sort((a, b) => a.position - b.position)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      position: r.position,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString()
    }));

  const channels = guild.channels.cache.sort((a, b) => a.rawPosition - b.rawPosition).map(ch => {
    const base = {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      parentId: ch.parentId || null,
      position: ch.rawPosition,
      rateLimitPerUser: ch.rateLimitPerUser || 0,
      nsfw: !!ch.nsfw,
      topic: ch.topic || null,
      bitrate: ch.bitrate || null,
      userLimit: ch.userLimit || null
    };
    const overwrites = [];
    if (ch.permissionOverwrites?.cache?.size) {
      ch.permissionOverwrites.cache.forEach(ow => {
        if (ow.type === 0) overwrites.push({
          id: ow.id,
          allow: ow.allow.bitfield.toString(),
          deny: ow.deny.bitfield.toString(),
          type: 0
        });
      });
    }
    return { ...base, overwrites };
  });

  const meta = { guildId: guild.id, name: guild.name, iconURL: guild.iconURL ? guild.iconURL({ size: 512 }) : null, savedAt: new Date().toISOString() };
  return { meta, roles, channels };
}

function saveGuildBackup(guildId, data) {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `${guildId}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

function loadGuildBackup(guildId) {
  const file = path.join(BACKUP_DIR, `${guildId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// ===== Dropbox helpers for user weather prefs and quizzes/backups if desired =====
async function uploadToDropbox(localPath, dropboxPath) {
  if (!dbx) throw new Error('Dropbox not configured');
  const contents = fs.readFileSync(localPath);
  // ensure parent path exists? Dropbox handles overwrite with mode
  return dbx.filesUpload({ path: dropboxPath, contents, mode: { '.tag': 'overwrite' } });
}

async function downloadFromDropbox(dropboxPath, localPath) {
  if (!dbx) throw new Error('Dropbox not configured');
  const res = await dbx.filesDownload({ path: dropboxPath });
  // res.result.fileBinary may exist or res.result may contain ArrayBuffer in different SDK versions
  const fileBinary = res.result?.fileBinary ?? res.result?.fileBlob ?? null;
  if (fileBinary) {
    fs.writeFileSync(localPath, fileBinary, 'binary');
    return true;
  } else if (res.result && res.result._response && res.result._response.body) {
    // fallbacks
    const body = await res.result._response.blob();
    const buf = Buffer.from(await body.arrayBuffer());
    fs.writeFileSync(localPath, buf);
    return true;
  } else {
    throw new Error('No file content from Dropbox response');
  }
}

// weather prefs save/load (local + optional Dropbox)
async function saveUserWeatherPrefs(userId, pref) {
  userWeatherPrefs.set(userId, pref);
  const localDir = path.join(BACKUP_DIR, 'weather');
  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
  const localFile = path.join(localDir, `weather_${userId}.json`);
  fs.writeFileSync(localFile, JSON.stringify({ pref }, null, 2), 'utf-8');
  if (dbx) {
    try {
      await uploadToDropbox(localFile, `/weather/weather_${userId}.json`);
    } catch (e) {
      console.warn('Dropbox保存失敗：', e.message || e);
    }
  }
}

async function loadUserWeatherPrefs(userId) {
  // first local
  const localDir = path.join(BACKUP_DIR, 'weather');
  const localFile = path.join(localDir, `weather_${userId}.json`);
  if (fs.existsSync(localFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(localFile, 'utf-8'));
      userWeatherPrefs.set(userId, parsed.pref);
      return parsed.pref;
    } catch (e) { /* ignore */ }
  }

  // try Dropbox
  if (dbx) {
    try {
      const tempDir = localDir;
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      await downloadFromDropbox(`/weather/weather_${userId}.json`, localFile);
      const parsed = JSON.parse(fs.readFileSync(localFile, 'utf-8'));
      userWeatherPrefs.set(userId, parsed.pref);
      return parsed.pref;
    } catch (e) {
      console.warn('Dropbox読み込み失敗：', e.message || e);
    }
  }

  return null;
}

// ===== Weather fetch (OpenWeatherMap) =====
async function fetchWeather(pref) {
  if (!OPENWEATHER_KEY) throw new Error('OPENWEATHER_KEY is not set');
  // Accept pref as either 'Tokyo' or '東京都' or prefecture-like; use q param with ,JP
  const q = encodeURIComponent(pref + ',JP');
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${q}&appid=${OPENWEATHER_KEY}&units=metric&lang=ja`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(()=>null);
    throw new Error(`OpenWeather error: ${res.status} ${res.statusText} ${txt}`);
  }
  const data = await res.json();
  const desc = data.weather?.[0]?.description ?? '不明';
  const temp = data.main?.temp ?? '?';
  const hum = data.main?.humidity ?? '?';
  return `🌤 ${data.name} の天気: ${desc}、気温 ${temp}°C、湿度 ${hum}%`;
}

// ===== Gemini (Google Generative) simple wrapper =====
async function askGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const model = GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateText`;
  // v1beta generateText expects JSON like { prompt: { text: "..." } } or the new API variant
  // We'll attempt a simple call per API docs
  const body = {
    // Simplified, if this exact shape doesn't work for your key/model you'll need to follow Google's SDK
    prompt: { text: prompt },
    maxOutputTokens: 512,
    temperature: 0.7
  };
  const res = await fetch(url + `?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(()=>null);
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }
  const j = await res.json();
  // try multiple possible paths
  const candidate = j?.candidates?.[0]?.content ?? j?.output?.[0]?.content ?? j?.text ?? JSON.stringify(j);
  // candidate may be a structured object, attempt to extract text
  if (typeof candidate === 'string') return candidate;
  if (candidate?.text) return candidate.text;
  return String(candidate);
}

// ===== Music playback helpers (play-dl + discord voice) =====
async function ensureStream(urlOrQuery) {
  // play-dl supports youtube and spotify links
  if (play.yt_validate(urlOrQuery) === 'video') {
    return await play.stream(urlOrQuery);
  }
  // If playlist or search: search first
  const search = await play.search(urlOrQuery, { limit: 1 });
  if (search && search.length > 0) {
    return await play.stream(search[0].url);
  }
  throw new Error('No playable result');
}

async function playMusic(interaction, urlOrQuery) {
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.followUp({ content: '先にボイスチャンネルに参加してください', flags: 64 }).catch(()=>{});
    return;
  }

  try {
    // get stream
    const stream = await ensureStream(urlOrQuery);
    // create or reuse player for guild
    const guildId = interaction.guildId;
    let record = audioPlayers.get(guildId);
    if (!record) {
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator
      });
      connection.subscribe(player);
      record = { connection, player };
      audioPlayers.set(guildId, record);
      player.on('error', err => console.error('Audio player error:', err));
      player.on(AudioPlayerStatus.Idle, () => {
        // disconnect after idle
        try { record.connection.destroy(); audioPlayers.delete(guildId); } catch(e){}
      });
    }

    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    record.player.play(resource);
    await interaction.followUp({ content: `🎶 再生開始: ${urlOrQuery}`, flags: 64 }).catch(()=>{});
  } catch (e) {
    console.error('playMusic error:', e);
    await interaction.followUp({ content: `再生に失敗しました: ${e.message}`, flags: 64 }).catch(()=>{});
  }
}

async function stopMusic(interaction) {
  const guildId = interaction.guildId;
  const record = audioPlayers.get(guildId);
  if (!record) return interaction.followUp({ content: '再生中ではありません', flags: 64 }).catch(()=>{});
  try {
    record.player.stop(true);
    record.connection.destroy();
    audioPlayers.delete(guildId);
    await interaction.followUp({ content: '⏹️ 再生を停止しました', flags: 64 }).catch(()=>{});
  } catch (e) {
    console.error('stopMusic err', e);
    await interaction.followUp({ content: '停止に失敗しました', flags: 64 }).catch(()=>{});
  }
}

// ===== Quiz externalization (save/load local JSON, optional Dropbox) =====
const QUIZ_FILE = path.join(BACKUP_DIR, 'quizzes.json');
function loadQuizzes() {
  if (fs.existsSync(QUIZ_FILE)) {
    try { const j = JSON.parse(fs.readFileSync(QUIZ_FILE, 'utf-8')); return j; } catch(e){ return []; }
  }
  return [];
}
function saveQuizzesToLocal(data) {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(QUIZ_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
let loadedQuizzes = loadQuizzes();

// ===== Slash command registration (guild commands recommended during development) =====
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('backup').setDescription('サーバーのバックアップを保存'),
    new SlashCommandBuilder().setName('restore').setDescription('バックアップからサーバーを復元'),
    new SlashCommandBuilder().setName('nuke').setDescription('このチャンネルを同設定で再作成（自動バックアップ付き）'),
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('メッセージ一括削除')
      .addIntegerOption(o=>o.setName('amount').setDescription('1〜1000').setRequired(true))
      .addUserOption(o=>o.setName('user').setDescription('ユーザー指定').setRequired(false)),
    new SlashCommandBuilder()
      .setName('weather')
      .setDescription('天気設定または取得（都道府県）')
      .addStringOption(o=>o.setName('pref').setDescription('都道府県を指定（保存する）').setRequired(false)),
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('ボイスで曲を再生する（YouTube/Spotify等）')
      .addStringOption(o=>o.setName('query').setDescription('URL or 検索語句').setRequired(true)),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('ボイス再生を停止'),
    new SlashCommandBuilder()
      .setName('gemini')
      .setDescription('Gemini に質問する（AIチャット）')
      .addStringOption(o=>o.setName('prompt').setDescription('質問').setRequired(true)),
    new SlashCommandBuilder()
      .setName('quiz')
      .setDescription('クイズ機能（start/add/list）')
      .addStringOption(o=>o.setName('action').setDescription('start/add/list').setRequired(true))
      .addStringOption(o=>o.setName('question').setDescription('追加する問題（add時）').setRequired(false))
      .addStringOption(o=>o.setName('answer').setDescription('追加する答え（add時）').setRequired(false))
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    if (!CLIENT_ID) {
      console.warn('CLIENT_ID not provided; cannot register commands automatically');
      return;
    }
    // register as guild commands if GUILD_ID provided, otherwise global (can take an hour)
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, process.env.GUILD_ID), { body: commands.map(c => c.toJSON()) });
      console.log('スラッシュコマンド登録完了 (guild)');
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });
      console.log('スラッシュコマンド登録完了 (global)');
    }
  } catch (e) {
    console.error('コマンド登録失敗:', e);
  }
}
registerCommands().catch(console.error);

// ===== Interaction handling =====
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand && interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;
      // require reply defers for long tasks
      if (!interaction.deferred && !interaction.replied) {
        try { await interaction.deferReply({ ephemeral: false }); } catch (e) {}
      }

      if (cmd === 'backup') {
        if (!hasManageGuildPermission(interaction.member)) return interaction.followUp({ content: '管理者権限が必要です', flags: 64 });
        const backup = await collectGuildBackup(interaction.guild);
        saveGuildBackup(interaction.guild.id, backup);
        await interaction.followUp({ content: '✅ バックアップを保存しました（ローカル）', flags: 64 });
      }

      else if (cmd === 'restore') {
        if (!hasManageGuildPermission(interaction.member)) return interaction.followUp({ content: '管理者権限が必要です', flags: 64 });
        const backup = loadGuildBackup(interaction.guild.id);
        if (!backup) return interaction.followUp({ content: '⚠️ バックアップが見つかりません', flags: 64 });
        await restoreGuildFromBackup(interaction.guild, backup, interaction);
      }

      else if (cmd === 'nuke') {
        if (!hasManageGuildPermission(interaction.member)) return interaction.followUp({ content: '管理者権限が必要です', flags: 64 });
        await nukeChannel(interaction.channel, interaction);
      }

      else if (cmd === 'clear') {
        if (!hasManageGuildPermission(interaction.member)) return interaction.followUp({ content: '管理者権限が必要です', flags: 64 });
        const amount = interaction.options.getInteger('amount');
        const user = interaction.options.getUser('user');
        await clearMessages(interaction.channel, amount, user, interaction);
      }

      else if (cmd === 'weather') {
        const pref = interaction.options.getString('pref');
        const uid = interaction.user.id;
        if (pref) {
          await saveUserWeatherPrefs(uid, pref);
          return interaction.followUp({ content: `✅ 天気設定を保存しました: ${pref}`, flags: 64 });
        } else {
          const saved = await loadUserWeatherPrefs(uid);
          if (!saved) return interaction.followUp({ content: '⚠️ 都道府県を指定してください（例: /weather pref:東京都）', flags: 64 });
          try {
            const w = await fetchWeather(saved);
            return interaction.followUp({ content: w, flags: 64 });
          } catch (e) {
            console.error('天気取得失敗：', e);
            return interaction.followUp({ content: '⚠️ 天気情報が取得できませんでした', flags: 64 });
          }
        }
      }

      else if (cmd === 'play') {
        const q = interaction.options.getString('query');
        return await playMusic(interaction, q);
      }

      else if (cmd === 'stop') {
        return await stopMusic(interaction);
      }

      else if (cmd === 'gemini') {
        const prompt = interaction.options.getString('prompt');
        try {
          const answer = await askGemini(prompt);
          return interaction.followUp({ content: answer, flags: 64 });
        } catch (e) {
          console.error('Gemini APIエラー:', e);
          return interaction.followUp({ content: '⚠️ Gemini APIエラー: ' + (e.message || e), flags: 64 });
        }
      }

      else if (cmd === 'quiz') {
        const action = (interaction.options.getString('action') || '').toLowerCase();
        if (action === 'list') {
          const qlist = loadedQuizzes.length ? loadedQuizzes.map((q,i)=>`${i+1}. ${q.question}`).join('\n') : '問題が登録されていません';
          return interaction.followUp({ content: qlist, flags: 64 });
        }
        if (action === 'add') {
          const question = interaction.options.getString('question');
          const answer = interaction.options.getString('answer');
          if (!question || !answer) return interaction.followUp({ content: 'add の場合は question と answer を指定してください', flags: 64 });
          loadedQuizzes.push({ question, answer, category: 'general' });
          saveQuizzesToLocal(loadedQuizzes);
          if (dbx) {
            try { await uploadToDropbox(QUIZ_FILE, '/quizzes/quizzes.json'); } catch(e){ console.warn('Dropbox quiz upload failed:', e.message); }
          }
          return interaction.followUp({ content: '✅ 問題を追加しました', flags: 64 });
        }
        if (action === 'start') {
          if (!loadedQuizzes.length) return interaction.followUp({ content: '問題がありません', flags: 64 });
          const idx = Math.floor(Math.random() * loadedQuizzes.length);
          const q = loadedQuizzes[idx];
          // send question and wait for answer in same channel for 30s
          await interaction.followUp({ content: `❓ クイズ: ${q.question}\n回答はこのチャンネルにテキストで送ってください（30秒）`, flags: 64 });
          const filter = m => !m.author.bot;
          const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 30000 }).catch(()=>null);
          if (!collected || collected.size === 0) return interaction.followUp({ content: '時間切れです。', flags: 64 });
          const reply = collected.first().content.trim();
          if (reply.toLowerCase() === q.answer.toLowerCase()) return interaction.followUp({ content: '✅ 正解！', flags: 64 });
          return interaction.followUp({ content: `❌ 不正解。正解は: ${q.answer}`, flags: 64 });
        }

        return interaction.followUp({ content: 'action must be one of start/add/list', flags: 64 });
      }

    }
  } catch (e) {
    console.error('Interaction error:', e);
    try { if (interaction && !interaction.replied) await interaction.followUp({ content: '❌ エラーが発生しました', flags: 64 }); } catch {}
  }
});

// ===== Classic message handling (prefix-based): translation and old !天気 support =====
client.on('messageCreate', async msg => {
  try {
    if (msg.author.bot) return;
    const content = msg.content.trim();
    const userId = msg.author.id;

    // translation prefix: "!日本語 <text>" → translate to ja, "!英語 ..." etc
    if (content.startsWith('!')) {
      const parts = content.slice(1).trim().split(/ +/);
      const cmd = parts.shift();
      // old weather command
      if (cmd === '天気') {
        const pref = parts.join(' ').trim();
        if (pref) {
          await saveUserWeatherPrefs(userId, pref);
          return msg.reply(`✅ 天気設定を保存しました: ${pref}`);
        } else {
          const saved = await loadUserWeatherPrefs(userId);
          if (!saved) return msg.reply('⚠️ 都道府県を指定してください: `!天気 東京` のように');
          try {
            const w = await fetchWeather(saved);
            return msg.reply(w);
          } catch (e) {
            console.error('天気取得失敗：', e);
            return msg.reply('⚠️ 天気情報が取得できませんでした');
          }
        }
      }

      // translation commands using Japanese language names
      const langMap = { 英語:'en', えいご:'en', 日本語:'ja', にほんご:'ja', 中国語:'zh-CN', ちゅうごくご:'zh-CN', 韓国語:'ko', かんこくご:'ko', フランス語:'fr', スペイン語:'es', ドイツ語:'de' };
      const to = langMap[cmd];
      if (to) {
        const text = parts.join(' ');
        if (!text) return;
        try {
          const res = await translateWithRetry(text, { to });
          return msg.reply(res.text);
        } catch (e) {
          console.error('translate error', e);
          return msg.reply('翻訳に失敗しました');
        }
      }
    }

  } catch (e) {
    console.error('messageCreate handler error', e);
  }
});

// ===== Restore/Nuke/Clear/Nuke helper functions used above (re-used code) =====
async function restoreGuildFromBackup(guild, backup, interaction) {
  // used earlier in code; keep similar implementation
  try {
    // delete channels
    for (const ch of guild.channels.cache.values()) {
      try { await ch.delete('Restore: clear channels'); await delay(50); } catch {}
    }

    // delete roles
    const deletableRoles = guild.roles.cache.filter(r => !r.managed && r.id !== guild.id).sort((a,b)=>a.position-b.position);
    for (const r of deletableRoles.values()) { try { await r.delete('Restore: clear roles'); await delay(50); } catch {} }

    const roleIdMap = new Map();
    for (const r of backup.roles) {
      if (r.id === guild.id) continue;
      try {
        const created = await guild.roles.create({
          name: r.name,
          color: r.color,
          hoist: r.hoist,
          mentionable: r.mentionable,
          permissions: BigInt(r.permissions),
          reason: 'Restore: create role'
        });
        roleIdMap.set(r.id, created.id);
        await delay(60);
      } catch (e) { console.error('Role create failed:', r.name, e.message); }
    }

    const channelIdMap = new Map();
    const categories = backup.channels.filter(c=>c.type===ChannelType.GuildCategory).sort((a,b)=>a.position-b.position);
    for (const cat of categories) {
      try {
        const created = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, position: cat.position, reason: 'Restore: create category' });
        channelIdMap.set(cat.id, created.id);
        if (cat.overwrites?.length) {
          await created.permissionOverwrites.set(cat.overwrites.map(ow=>({
            id: roleIdMap.get(ow.id) || guild.id,
            allow: BigInt(ow.allow),
            deny: BigInt(ow.deny),
            type: ow.type
          })), 'Restore: set category overwrites');
        }
        await delay(60);
      } catch (e) { console.error('Category create failed:', cat.name, e.message); }
    }

    const others = backup.channels.filter(c=>c.type!==ChannelType.GuildCategory).sort((a,b)=>a.position-b.position);
    for (const ch of others) {
      try {
        const payload = { name: ch.name, type: ch.type, parent: ch.parentId ? channelIdMap.get(ch.parentId) || null : null, position: ch.position, reason: 'Restore: create channel' };
        if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(ch.type)) {
          payload.topic = ch.topic || null;
          payload.nsfw = !!ch.nsfw;
          payload.rateLimitPerUser = ch.rateLimitPerUser || 0;
        }
        if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(ch.type)) {
          payload.bitrate = ch.bitrate || null;
          payload.userLimit = ch.userLimit || null;
        }
        const created = await guild.channels.create(payload);
        channelIdMap.set(ch.id, created.id);
        if (ch.overwrites?.length) {
          await created.permissionOverwrites.set(ch.overwrites.map(ow=>({
            id: roleIdMap.get(ow.id) || guild.id,
            allow: BigInt(ow.allow),
            deny: BigInt(ow.deny),
            type: ow.type
          })), 'Restore: set overwrites');
        }
        await delay(60);
      } catch (e) { console.error('Channel create failed:', ch.name, e.message); }
    }

    try {
      if (backup.meta?.name && guild.name !== backup.meta.name) await guild.setName(backup.meta.name, 'Restore: guild name');
      if (backup.meta?.iconURL) await guild.setIcon(backup.meta.iconURL, 'Restore: guild icon');
    } catch (e) { console.warn('Guild meta restore failed:', e.message); }

    try {
      const textChannels = guild.channels.cache.filter(c=>c.isTextBased());
      if (textChannels.size > 0) await textChannels.random().send('✅ バックアップを復元完了しました');
    } catch {}

    if (interaction) {
      await interaction.followUp({ content: '✅ 完全復元が完了しました', flags: 64 }).catch(()=>{});
    }
  } catch (e) {
    console.error('restoreGuildFromBackup error', e);
  }
}

async function nukeChannel(channel, interaction) {
  const backup = await collectGuildBackup(channel.guild);
  saveGuildBackup(channel.guild.id, backup);

  const overwrites = channel.permissionOverwrites?.cache?.map(ow=>({
    id: ow.id,
    allow: ow.allow.bitfield.toString(),
    deny: ow.deny.bitfield.toString(),
    type: ow.type
  })) || [];

  const payload = {
    name: channel.name,
    type: channel.type,
    parent: channel.parentId ?? null,
    position: channel.rawPosition,
    rateLimitPerUser: channel.rateLimitPerUser ?? 0,
    nsfw: !!channel.nsfw,
    topic: channel.topic || null,
    bitrate: channel.bitrate || null,
    userLimit: channel.userLimit || null,
    reason: 'Nuke: recreate channel'
  };

  const newCh = await channel.guild.channels.create(payload);
  if (overwrites.length) {
    await newCh.permissionOverwrites.set(overwrites.map(ow=>({
      id: ow.id,
      allow: BigInt(ow.allow),
      deny: BigInt(ow.deny),
      type: ow.type
    })), 'Nuke: set overwrites');
  }

  try { await channel.delete('Nuke: delete old channel'); } catch {}
  if (interaction) await interaction.followUp({ content: '💥 チャンネルをNukeしました', flags: 64 }).catch(()=>{});
  try { await newCh.send('✅ チャンネルをNukeしました'); } catch {}
  return newCh;
}

async function clearMessages(channel, amount, user, interaction) {
  try {
    const msgs = await channel.messages.fetch({ limit: Math.min(amount, 100) }); // API limit
    const filtered = user ? msgs.filter(m => m.author.id === user.id) : msgs;
    await channel.bulkDelete(filtered, true);
    if (interaction) await interaction.followUp({ content: `🧹 ${filtered.size}件のメッセージを削除しました`, flags: 64 }).catch(()=>{});
  } catch (e) {
    console.error('clearMessages error', e);
    if (interaction) await interaction.followUp({ content: '削除に失敗しました', flags: 64 }).catch(()=>{});
  }
}

// ===== Presence uptime update every 5 seconds (safe) =====
let startTime = Date.now();
async function updateUptimeStatus() {
  try {
    const elapsed = Date.now() - startTime;
    const hours = Math.floor(elapsed / 1000 / 60 / 60);
    const minutes = Math.floor((elapsed / 1000 / 60) % 60);
    const seconds = Math.floor((elapsed / 1000) % 60);
    const text = `稼働 ${hours}h${minutes}m${seconds}s`;
    await client.user.setPresence({
      activities: [{ name: text, type: ActivityType.Watching }],
      status: 'online'
    });
  } catch (e) {
    console.warn('updateUptimeStatus err', e.message || e);
  }
}

// ===== On ready =====
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  startTime = Date.now();
  setInterval(updateUptimeStatus, 5000); // 5秒間隔
  // load quizzes from local or dropbox if exists
  try {
    loadedQuizzes = loadQuizzes();
    console.log(`Loaded ${loadedQuizzes.length} quizzes`);
    // if Dropbox and remote exists, try to download quizzes
    if (dbx) {
      try {
        const localQuizDir = BACKUP_DIR;
        if (!fs.existsSync(localQuizDir)) fs.mkdirSync(localQuizDir, { recursive: true });
        await downloadFromDropbox('/quizzes/quizzes.json', QUIZ_FILE);
        loadedQuizzes = loadQuizzes();
        console.log('quizzes downloaded from Dropbox');
      } catch (e) {
        console.warn('Dropbox quizzes download failed:', e.message || e);
      }
    }
  } catch (e) {
    console.warn('ready load data error', e.message || e);
  }
});

// ===== start bot =====
client.login(TOKEN).catch(e => console.error('Discord login error:', e));