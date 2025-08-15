// ==========================
// index.js  — 完全統合フルコード
// ==========================
require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

// --- Node18未満向け fetch ポリフィル & Dropboxへも渡す ---
let fetchImpl = global.fetch;
if (!fetchImpl) {
  fetchImpl = require('node-fetch'); // npm i node-fetch
  global.fetch = fetchImpl;
}

const translateApi = require('@vitalets/google-translate-api');
const simpleGit = require('simple-git');
const { Dropbox } = require('dropbox');
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ActivityType,
  ChannelType,
  Events,
} = require('discord.js');

// 音楽（最小）：URL直再生に対応（YouTube検索などは未実装）
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  getVoiceConnection,
} = require('@discordjs/voice'); // npm i @discordjs/voice

// ====== 環境変数 ======
const clientId = process.env.CLIENT_ID;
const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
const dropboxToken = process.env.DROPBOX_TOKEN; // Dropbox Appのアクセストークン（files.content.read/write スコープ必須）
const weatherApiKey = process.env.OPENWEATHER_KEY; // OpenWeatherMap API Key
const geminiKey = process.env.GEMINI_API_KEY; // Google AI StudioのAPIキー

if (!clientId || !token) {
  console.error('❌ CLIENT_ID / TOKEN が未設定です。');
  process.exit(1);
}

if (!dropboxToken) {
  console.warn('⚠️ DROPBOX_TOKEN 未設定のため、天気設定のクラウド永続化は失敗します。');
}

if (!weatherApiKey) {
  console.warn('⚠️ OPENWEATHER_KEY 未設定のため、天気取得は失敗します。');
}

if (!geminiKey) {
  console.warn('⚠️ GEMINI_API_KEY 未設定のため、AIチャットは動作しません。');
}

// ====== Dropbox SDK（fetchを明示指定）======
const dbx = new Dropbox({ accessToken: dropboxToken, fetch: fetchImpl });

// ====== Gitは今は自動push機能を無効（要求通り） ======
const git = simpleGit();

// ===== Discord Client =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ===== Express Keep-Alive =====
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

if (process.env.SELF_URL) {
  setInterval(() => {
    https
      .get(process.env.SELF_URL, (res) =>
        console.log(`Keep-Alive ping status: ${res.statusCode}`)
      )
      .on('error', (err) => console.error('Keep-Alive ping error:', err.message));
  }, 4 * 60 * 1000);
}

// ===== Utilities / Paths =====
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const BACKUP_DIR = process.env.BACKUP_PATH || './backups';
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const WEATHER_DIR = path.join(BACKUP_DIR, 'weather');
if (!fs.existsSync(WEATHER_DIR)) fs.mkdirSync(WEATHER_DIR, { recursive: true });

const QUIZ_DIR = path.join(process.cwd(), 'quizzes');
if (!fs.existsSync(QUIZ_DIR)) fs.mkdirSync(QUIZ_DIR, { recursive: true });

const msgCooldowns = new Map();
const userWeatherPrefs = new Map();

function hasManageGuildPermission(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
}

async function translateWithRetry(text, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await translateApi.translate(text, options);
    } catch (e) {
      if (e?.name === 'TooManyRequestsError') await delay(1500 * (i + 1));
      else throw e;
    }
  }
  throw new Error('翻訳APIが多すぎます');
}

// ===== 都道府県→主要都市マップ（OpenWeatherに投げる用・47都道府県） =====
const PREF_TO_CITY = {
  '北海道': '札幌',
  '青森県': '青森',
  '岩手県': '盛岡',
  '宮城県': '仙台',
  '秋田県': '秋田',
  '山形県': '山形',
  '福島県': '福島',
  '茨城県': '水戸',
  '栃木県': '宇都宮',
  '群馬県': '前橋',
  '埼玉県': 'さいたま',
  '千葉県': '千葉',
  '東京都': '東京',
  '神奈川県': '横浜',
  '新潟県': '新潟',
  '富山県': '富山',
  '石川県': '金沢',
  '福井県': '福井',
  '山梨県': '甲府',
  '長野県': '長野',
  '岐阜県': '岐阜',
  '静岡県': '静岡',
  '愛知県': '名古屋',
  '三重県': '津',
  '滋賀県': '大津',
  '京都府': '京都',
  '大阪府': '大阪',
  '兵庫県': '神戸',
  '奈良県': '奈良',
  '和歌山県': '和歌山',
  '鳥取県': '鳥取',
  '島根県': '松江',
  '岡山県': '岡山',
  '広島県': '広島',
  '山口県': '山口',
  '徳島県': '徳島',
  '香川県': '高松',
  '愛媛県': '松山',
  '高知県': '高知',
  '福岡県': '福岡',
  '佐賀県': '佐賀',
  '長崎県': '長崎',
  '熊本県': '熊本',
  '大分県': '大分',
  '宮崎県': '宮崎',
  '鹿児島県': '鹿児島',
  '沖縄県': '那覇',
  // 俗称対応
  '東京': '東京',
  '大阪': '大阪',
  '神奈川': '横浜',
  '京都': '京都',
  '沖縄': '那覇',
};

// ============ Dropbox ヘルパ =============
// pathはDropbox内パス（例: /weather/weather_123.json）
async function uploadFileToDropbox(dbxPath, dataBuffer) {
  if (!dropboxToken) throw new Error('DROPBOX_TOKEN 未設定');
  try {
    await dbx.filesUpload({
      path: dbxPath,
      contents: dataBuffer,
      mode: { '.tag': 'overwrite' },
      mute: true,
    });
    return true;
  } catch (e) {
    console.error('Dropboxアップロード失敗:', e?.error || e);
    return false;
  }
}

async function downloadFileFromDropbox(dbxPath) {
  if (!dropboxToken) throw new Error('DROPBOX_TOKEN 未設定');
  try {
    const res = await dbx.filesDownload({ path: dbxPath });
    // Node SDK v10: res.result.fileBinary / 旧: res.fileBinary
    const bin = res?.result?.fileBinary || res?.fileBinary;
    if (!bin) throw new Error('fileBinaryが空');
    return Buffer.isBuffer(bin) ? bin : Buffer.from(bin, 'binary');
  } catch (e) {
    console.error('Dropbox読み込み失敗:', e?.error || e);
    return null;
  }
}

// ============ サーバーバックアップ =============
async function collectGuildBackup(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const roles = guild.roles.cache
    .filter((r) => !r.managed)
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      position: r.position,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
    }));

  const channels = guild.channels.cache
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((ch) => {
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
        userLimit: ch.userLimit || null,
      };
      const overwrites = [];
      if (ch.permissionOverwrites?.cache?.size) {
        ch.permissionOverwrites.cache.forEach((ow) => {
          if (ow.type === 0)
            overwrites.push({
              id: ow.id,
              allow: ow.allow.bitfield.toString(),
              deny: ow.deny.bitfield.toString(),
              type: 0,
            });
        });
      }
      return { ...base, overwrites };
    });

  const meta = {
    guildId: guild.id,
    name: guild.name,
    iconURL: guild.iconURL({ size: 512 }) || null,
    savedAt: new Date().toISOString(),
  };
  return { meta, roles, channels };
}

function saveGuildBackup(guildId, data) {
  const file = path.join(BACKUP_DIR, `${guildId}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

function loadGuildBackup(guildId) {
  const file = path.join(BACKUP_DIR, `${guildId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

async function restoreGuildFromBackup(guild, backup, interaction) {
  // 1) 既存チャンネル削除
  for (const ch of guild.channels.cache.values()) {
    try {
      await ch.delete('Restore: clear channels');
      await delay(50);
    } catch {}
  }

  // 2) 既存ロール削除
  const deletableRoles = guild.roles.cache
    .filter((r) => !r.managed && r.id !== guild.id)
    .sort((a, b) => a.position - b.position);
  for (const r of deletableRoles.values()) {
    try {
      await r.delete('Restore: clear roles');
      await delay(50);
    } catch {}
  }

  // 3) ロール再作成
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
        reason: 'Restore: create role',
      });
      roleIdMap.set(r.id, created.id);
      await delay(60);
    } catch (e) {
      console.error('Role create failed:', r.name, e.message);
    }
  }

  // 4) カテゴリ作成
  const channelIdMap = new Map();
  const categories = backup.channels
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);

  for (const cat of categories) {
    try {
      const created = await guild.channels.create({
        name: cat.name,
        type: ChannelType.GuildCategory,
        position: cat.position,
        reason: 'Restore: create category',
      });
      channelIdMap.set(cat.id, created.id);
      if (cat.overwrites?.length) {
        await created.permissionOverwrites.set(
          cat.overwrites.map((ow) => ({
            id: roleIdMap.get(ow.id) || guild.id,
            allow: BigInt(ow.allow),
            deny: BigInt(ow.deny),
            type: ow.type,
          })),
          'Restore: set category overwrites'
        );
      }
      await delay(60);
    } catch (e) {
      console.error('Category create failed:', cat.name, e.message);
    }
  }

  // 5) その他チャンネル
  const others = backup.channels
    .filter((c) => c.type !== ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);

  for (const ch of others) {
    try {
      const payload = {
        name: ch.name,
        type: ch.type,
        parent: ch.parentId ? channelIdMap.get(ch.parentId) || null : null,
        position: ch.position,
        reason: 'Restore: create channel',
      };
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
        await created.permissionOverwrites.set(
          ch.overwrites.map((ow) => ({
            id: roleIdMap.get(ow.id) || guild.id,
            allow: BigInt(ow.allow),
            deny: BigInt(ow.deny),
            type: ow.type,
          })),
          'Restore: set overwrites'
        );
      }
      await delay(60);
    } catch (e) {
      console.error('Channel create failed:', ch.name, e.message);
    }
  }

  try {
    if (backup.meta?.name && guild.name !== backup.meta.name)
      await guild.setName(backup.meta.name, 'Restore: guild name');
    if (backup.meta?.iconURL) await guild.setIcon(backup.meta.iconURL, 'Restore: guild icon');
  } catch (e) {
    console.warn('Guild meta restore failed:', e.message);
  }

  try {
    const textChannels = guild.channels.cache.filter((c) => c.isTextBased?.());
    if (textChannels.size > 0) await textChannels.random().send('✅ バックアップを復元完了しました');
  } catch {}

  if (interaction)
    await interaction.followUp({ content: '✅ 完全復元が完了しました', flags: 64 }).catch(() => {});
}

// ============ Nuke & Clear ============
async function nukeChannel(channel, interaction) {
  const backup = await collectGuildBackup(channel.guild);
  saveGuildBackup(channel.guild.id, backup);

  const overwrites =
    channel.permissionOverwrites?.cache
      ?.map((ow) => ({
        id: ow.id,
        allow: ow.allow.bitfield.toString(),
        deny: ow.deny.bitfield.toString(),
        type: ow.type,
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
    reason: 'Nuke: recreate channel',
  };

  const newCh = await channel.guild.channels.create(payload);
  if (overwrites.length) {
    await newCh.permissionOverwrites.set(
      overwrites.map((ow) => ({
        id: ow.id,
        allow: BigInt(ow.allow),
        deny: BigInt(ow.deny),
        type: ow.type,
      })),
      'Nuke: set overwrites'
    );
  }

  try {
    await channel.delete('Nuke: delete old channel');
  } catch {}
  if (interaction) await interaction.followUp({ content: '💥 チャンネルをNukeしました', flags: 64 }).catch(() => {});
  try {
    await newCh.send('✅ チャンネルをNukeしました');
  } catch {}
  return newCh;
}

async function clearMessages(channel, amount, user, interaction) {
  const msgs = await channel.messages.fetch({ limit: amount });
  const filtered = user ? msgs.filter((m) => m.author.id === user.id) : msgs;
  await channel.bulkDelete(filtered, true);
  if (interaction)
    await interaction.followUp({ content: `🧹 ${filtered.size}件のメッセージを削除しました`, flags: 64 }).catch(() => {});
}

// ============ 天気：保存/読み込み/取得 ============
function normalizePrefInput(input) {
  if (!input) return null;
  const key = input.replace(/\s/g, '');
  if (PREF_TO_CITY[key]) return key;
  // 末尾の「県/府/都/道」を足して再チェック
  for (const suffix of ['県', '府', '都', '道']) {
    if (PREF_TO_CITY[key + suffix]) return key + suffix;
  }
  // 俗称（東京/大阪/神奈川/京都/沖縄）は事前定義済み
  return PREF_TO_CITY[key] ? key : null;
}

async function saveUserWeatherPrefs(userId, prefRaw) {
  const prefKey = normalizePrefInput(prefRaw);
  const pref = prefKey || prefRaw; // 未知入力もそのまま保持しておく
  userWeatherPrefs.set(userId, pref);

  const fileLocal = path.join(WEATHER_DIR, `weather_${userId}.json`);
  fs.writeFileSync(fileLocal, JSON.stringify({ pref }, null, 2), 'utf-8');

  const dbxPath = `/weather/weather_${userId}.json`;

  try {
    const ok = await uploadFileToDropbox(dbxPath, Buffer.from(JSON.stringify({ pref })));
    if (!ok) console.error(`Dropboxアップロードに失敗しました：${dbxPath}`);
  } catch (e) {
    console.error('Dropbox保存失敗：', e?.message || e);
  }
}

async function loadUserWeatherPrefs(userId) {
  const fileLocal = path.join(WEATHER_DIR, `weather_${userId}.json`);
  if (fs.existsSync(fileLocal)) {
    const data = JSON.parse(fs.readFileSync(fileLocal, 'utf-8'));
    userWeatherPrefs.set(userId, data.pref);
    return data.pref;
  }
  const dbxPath = `/weather/weather_${userId}.json`;
  const bin = await downloadFileFromDropbox(dbxPath);
  if (bin) {
    try {
      fs.writeFileSync(fileLocal, bin);
      const data = JSON.parse(fs.readFileSync(fileLocal, 'utf-8'));
      userWeatherPrefs.set(userId, data.pref);
      return data.pref;
    } catch (e) {
      console.error('Dropbox→ローカル保存/パース失敗:', e?.message || e);
    }
  }
  return null;
}

async function fetchWeather(prefOrPrefKey, needDebug = false) {
  if (!weatherApiKey) return { ok: false, message: 'OPENWEATHER_KEYが未設定です。' };
  // 入力が都道府県なら都市名に変換
  const prefKey = normalizePrefInput(prefOrPrefKey);
  const city = prefKey ? PREF_TO_CITY[prefKey] : prefOrPrefKey;

  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)},JP&appid=${weatherApiKey}&units=metric&lang=ja`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const msg = `天気API失敗: HTTP ${res.status}${txt ? ` / ${txt.slice(0, 300)}` : ''}`;
      return { ok: false, message: `⚠️ 天気情報が取得できませんでした。\n${needDebug ? `URL: ${url}\n${msg}` : ''}` };
    }
    const data = await res.json();
    const out = `🌤 **${data.name}の天気**: ${data.weather?.[0]?.description ?? '不明'} / 気温: ${data.main?.temp ?? '?'}°C / 湿度: ${data.main?.humidity ?? '?'}% / 風: ${data.wind?.speed ?? '?'}m/s`;
    return { ok: true, message: out, debug: needDebug ? `URL: ${url}` : undefined };
  } catch (e) {
    return { ok: false, message: `⚠️ 天気情報が取得できませんでした。\n${needDebug ? `URL: ${url}\nError: ${e?.message || e}` : ''}` };
  }
}

// ============ AI（Gemini） ============
const userHistory = new Map(); // userId -> contents[]

async function askGemini(userId, question) {
  if (!geminiKey) return '⚠️ GEMINI_API_KEYが未設定です。';

  const contents = userHistory.get(userId) || [];
  contents.push({ role: 'user', parts: [{ text: question }] });

  const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': geminiKey,
    },
    body: JSON.stringify({ contents }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return `⚠️ Gemini APIエラー: HTTP ${resp.status}${t ? `\n${t.slice(0, 400)}` : ''}`;
  }
  const data = await resp.json();
  const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || '⚠️ 応答なし';
  contents.push({ role: 'model', parts: [{ text: answer }] });
  // 過去ログが肥大化しないように適当に切る（例：直近40）
  if (contents.length > 40) contents.splice(0, contents.length - 40);
  userHistory.set(userId, contents);
  return answer;
}

// ============ クイズ（外部JSON + 内蔵サンプル） ============
// 形式: { category: "rail|general|trivia", question: "Q", choices: ["A","B","C","D"], answerIndex: 1, explain: "..." }
function loadQuizPool() {
  const pool = [];
  // 外部ファイル読み込み
  try {
    const files = fs.readdirSync(QUIZ_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const full = path.join(QUIZ_DIR, f);
      const arr = JSON.parse(fs.readFileSync(full, 'utf-8'));
      if (Array.isArray(arr)) pool.push(...arr);
    }
  } catch (e) {
    console.warn('クイズ外部JSON読み込みスキップ:', e?.message || e);
  }

  // 何も無ければ内蔵サンプル
  if (pool.length === 0) {
    pool.push(
      {
        category: 'general',
        question: '地球は何番目の惑星？',
        choices: ['1', '2', '3', '4'],
        answerIndex: 2,
        explain: '太陽系で3番目。',
      },
      {
        category: 'trivia',
        question: 'コーヒーの原産地として有名な国は？',
        choices: ['ベトナム', 'エチオピア', 'ブラジル', 'コロンビア'],
        answerIndex: 1,
        explain: '諸説あるが伝承ではエチオピア。',
      },
      {
        category: 'rail',
        question: '東海道新幹線の最高速度は？（2025時点）',
        choices: ['230km/h', '270km/h', '285km/h', '300km/h'],
        answerIndex: 2,
        explain: 'のぞみ等の営業最高速度は285km/h（ダイヤにより変動あり）。',
      }
    );
  }
  return pool;
}

const quizPool = loadQuizPool();
// 進行状態: guildId: { channelId, current, answered, category, timeout }
const quizState = new Map();

function pickQuiz(category) {
  // railは指定時のみ。general/triviaは混在OK。
  const cats = ['general', 'trivia', 'rail'];
  const target = category && cats.includes(category) ? category : null;
  let list = quizPool;
  if (target) {
    list = quizPool.filter((q) => q.category === target);
  } else {
    list = quizPool.filter((q) => q.category !== 'rail'); // 指定無ならrailは除外
  }
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// ============ 音楽（最小: URL直再生） ============
const players = new Map(); // guildId -> audioPlayer

function ensurePlayer(guildId) {
  let player = players.get(guildId);
  if (!player) {
    player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    player.on(AudioPlayerStatus.Idle, () => {});
    players.set(guildId, player);
  }
  return player;
}

function joinVC(channel) {
  return joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });
}

async function playUrlInVC(voiceChannel, url) {
  const connection = joinVC(voiceChannel);
  const player = ensurePlayer(voiceChannel.guild.id);
  connection.subscribe(player);
  const resource = createAudioResource(url); // シンプルにURL音源のみ（mp3/stream）
  player.play(resource);
  return player;
}

// ============ スラッシュコマンド登録 ============
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('backup').setDescription('サーバーのバックアップを保存'),
    new SlashCommandBuilder().setName('restore').setDescription('バックアップからサーバーを復元'),
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('メッセージ一括削除')
      .addIntegerOption((o) => o.setName('amount').setDescription('1〜1000').setRequired(true))
      .addUserOption((o) => o.setName('user').setDescription('ユーザー指定').setRequired(false)),
    new SlashCommandBuilder().setName('nuke').setDescription('このチャンネルを同設定で再作成（自動バックアップ付き）'),
    new SlashCommandBuilder()
      .setName('weather')
      .setDescription('天気設定または取得')
      .addStringOption((o) => o.setName('pref').setDescription('都道府県 or 都市名').setRequired(false))
      .addBooleanOption((o) => o.setName('debug').setDescription('診断情報を付ける').setRequired(false)),
    new SlashCommandBuilder()
      .setName('ai')
      .setDescription('Geminiに質問')
      .addStringOption((o) => o.setName('q').setDescription('質問内容').setRequired(true)),
    new SlashCommandBuilder()
      .setName('quiz')
      .setDescription('クイズ機能')
      .addSubcommand((sc) =>
        sc
          .setName('start')
          .setDescription('クイズを開始')
          .addStringOption((o) =>
            o
              .setName('category')
              .setDescription('カテゴリ: general / trivia / rail（railは指定時のみ出題）')
              .setRequired(false)
          )
      )
      .addSubcommand((sc) =>
        sc
          .setName('answer')
          .setDescription('回答する（番号）')
          .addIntegerOption((o) => o.setName('n').setDescription('選択肢の番号(1-4)').setRequired(true))
      )
      .addSubcommand((sc) => sc.setName('stop').setDescription('クイズを終了')),
    new SlashCommandBuilder()
      .setName('music')
      .setDescription('音楽（最小機能）')
      .addSubcommand((sc) => sc.setName('join').setDescription('ボイスチャンネルに参加'))
      .addSubcommand((sc) =>
        sc
          .setName('play')
          .setDescription('URLを再生（mp3直リンク等）')
          .addStringOption((o) => o.setName('url').setDescription('音源URL').setRequired(true))
      )
      .addSubcommand((sc) => sc.setName('stop').setDescription('停止'))
      .addSubcommand((sc) => sc.setName('leave').setDescription('退出')),
  ];
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands.map((c) => c.toJSON()) });
  console.log('スラッシュコマンド登録完了');
}
registerCommands().catch(console.error);

// ============ メッセージコマンド（!天気 / 翻訳 / !ai） ============
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  const content = msg.content.trim();
  const userId = msg.author.id;
  if (!content.startsWith('!')) return;

  const args = content.slice(1).split(/ +/);
  const command = args.shift();

  if (command === '天気') {
    // 例: !天気 東京  / 既に保存済みなら !天気 だけでOK
    let pref = args.join(' ');
    if (pref) {
      await saveUserWeatherPrefs(userId, pref);
      await msg.reply(`✅ 天気設定を保存しました: ${pref}`);
      const r = await fetchWeather(pref);
      return msg.reply(r.message);
    } else {
      const saved = (await loadUserWeatherPrefs(userId)) || userWeatherPrefs.get(userId);
      if (!saved) return msg.reply('⚠️ 都道府県または都市を指定してください: `!天気 東京` のように');
      const r = await fetchWeather(saved);
      return msg.reply(r.message);
    }
  }

  if (command === 'ai') {
    const q = args.join(' ').trim();
    if (!q) return msg.reply('質問を入れてください: `!ai こんにちは` のように');
    const ans = await askGemini(userId, q);
    return msg.reply(ans);
  }

  // 翻訳（!英語 こんにちは）
  const targetLang = command;
  const text = args.join(' ');
  const langMap = {
    英語: 'en',
    えいご: 'en',
    日本語: 'ja',
    にほんご: 'ja',
    中国語: 'zh-CN',
    ちゅうごくご: 'zh-CN',
    韓国語: 'ko',
    かんこくご: 'ko',
    フランス語: 'fr',
    スペイン語: 'es',
    ドイツ語: 'de',
  };
  const to = langMap[targetLang];
  if (!to) return; // 未対応コマンドは無視
  if (!text) return;
  try {
    const res = await translateWithRetry(text, { to });
    await msg.reply(res.text);
  } catch (e) {
    console.error(e);
  }
});

// ============ スラッシュコマンド実装 ============
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName: cmd } = interaction;
  const guild = interaction.guild;
  if (cmd !== 'ai' && cmd !== 'weather' && (!guild || !hasManageGuildPermission(interaction.member))) {
    if (cmd !== 'ai' && cmd !== 'weather') {
      return interaction.reply({ content: '管理者権限が必要です', flags: 64 }).catch(() => {});
    }
  }

  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ flags: 64 });
    } catch {}
  }

  try {
    if (cmd === 'backup') {
      const backup = await collectGuildBackup(guild);
      saveGuildBackup(guild.id, backup);
      await interaction.followUp({ content: '✅ バックアップを保存しました', flags: 64 }).catch(() => {});
    } else if (cmd === 'restore') {
      const backup = loadGuildBackup(guild.id);
      if (!backup) return await interaction.followUp({ content: '⚠️ バックアップが見つかりません', flags: 64 });
      await restoreGuildFromBackup(guild, backup, interaction);
    } else if (cmd === 'nuke') {
      await nukeChannel(interaction.channel, interaction);
    } else if (cmd === 'clear') {
      const amount = interaction.options.getInteger('amount');
      const user = interaction.options.getUser('user');
      await clearMessages(interaction.channel, amount, user, interaction);
    } else if (cmd === 'weather') {
      const pref = interaction.options.getString('pref');
      const needDebug = interaction.options.getBoolean('debug') || false;
      const userId = interaction.user.id;
      if (pref) {
        await saveUserWeatherPrefs(userId, pref);
        const r = await fetchWeather(pref, needDebug);
        const post = r.debug ? `${r.message}\n\`\`\`\n${r.debug}\n\`\`\`` : r.message;
        await interaction.followUp({ content: `✅ 設定: ${pref}\n${post}`, flags: 64 });
      } else {
        const savedPref = (await loadUserWeatherPrefs(userId)) || userWeatherPrefs.get(userId);
        if (!savedPref) return await interaction.followUp({ content: '⚠️ 都道府県/都市を指定してください', flags: 64 });
        const r = await fetchWeather(savedPref, needDebug);
        const post = r.debug ? `${r.message}\n\`\`\`\n${r.debug}\n\`\`\`` : r.message;
        await interaction.followUp({ content: post, flags: 64 });
      }
    } else if (cmd === 'ai') {
      const q = interaction.options.getString('q');
      const ans = await askGemini(interaction.user.id, q);
      await interaction.followUp({ content: ans.slice(0, 2000), flags: 64 });
    } else if (cmd === 'quiz') {
      const sub = interaction.options.getSubcommand();
      const gId = interaction.guildId;
      if (sub === 'start') {
        const category = interaction.options.getString('category');
        const q = pickQuiz(category);
        if (!q) return interaction.followUp({ content: '⚠️ クイズが見つかりません。', flags: 64 });
        quizState.set(gId, {
          channelId: interaction.channelId,
          current: q,
          answered: false,
          category: category || 'mixed',
        });
        const body =
          `🧠 クイズ開始！カテゴリ: **${category || 'mixed（rail除外）'}**\n` +
          `**Q:** ${q.question}\n` +
          q.choices.map((c, i) => `${i + 1}. ${c}`).join('\n') +
          `\n\n/quiz answer で番号(1-4)を送ってね。`;
        await interaction.followUp({ content: body, flags: 64 });
      } else if (sub === 'answer') {
        const n = interaction.options.getInteger('n');
        const st = quizState.get(gId);
        if (!st?.current) return interaction.followUp({ content: '⚠️ 先に /quiz start してね。', flags: 64 });
        if (st.answered) return interaction.followUp({ content: '⚠️ すでに回答済み。/quiz start で次へ。', flags: 64 });
        st.answered = true;
        const ok = n - 1 === st.current.answerIndex;
        const explain = st.current.explain ? `\n解説: ${st.current.explain}` : '';
        await interaction.followUp({
          content: `${ok ? '⭕ 正解！' : '❌ 不正解…'} 正解は **${st.current.answerIndex + 1}. ${st.current.choices[st.current.answerIndex]}** ${explain}`,
          flags: 64,
        });
      } else if (sub === 'stop') {
        quizState.delete(gId);
        await interaction.followUp({ content: '🛑 クイズを終了しました。', flags: 64 });
      }
    } else if (cmd === 'music') {
      const sub = interaction.options.getSubcommand();
      const memberVC = interaction.member?.voice?.channel;
      if (sub === 'join') {
        if (!memberVC) return interaction.followUp({ content: '⚠️ 先にボイスチャンネルに参加してください', flags: 64 });
        joinVC(memberVC);
        await interaction.followUp({ content: `✅ 参加: ${memberVC.name}`, flags: 64 });
      } else if (sub === 'play') {
        const url = interaction.options.getString('url');
        if (!memberVC) return interaction.followUp({ content: '⚠️ 先にボイスチャンネルに参加してください', flags: 64 });
        try {
          await playUrlInVC(memberVC, url);
          await interaction.followUp({ content: `▶️ 再生開始: ${url}`, flags: 64 });
        } catch (e) {
          await interaction.followUp({ content: `⚠️ 再生失敗: ${e?.message || e}`, flags: 64 });
        }
      } else if (sub === 'stop') {
        const conn = getVoiceConnection(interaction.guildId);
        const player = players.get(interaction.guildId);
        try {
          player?.stop(true);
          await interaction.followUp({ content: '⏹ 停止しました', flags: 64 });
        } catch {
          await interaction.followUp({ content: '⚠️ 停止できませんでした', flags: 64 });
        }
      } else if (sub === 'leave') {
        const conn = getVoiceConnection(interaction.guildId);
        conn?.destroy();
        await interaction.followUp({ content: '👋 退出しました', flags: 64 });
      }
    }
  } catch (e) {
    console.error('Interaction error:', e);
    if (!interaction.replied) await interaction.followUp({ content: '❌ エラーが発生しました', flags: 64 }).catch(() => {});
  }
});

// ============ 稼働時間ステータス（5秒更新） ============
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
  const start = Date.now();

  const updateUptimeStatus = () => {
    const elapsed = Date.now() - start;
    const hours = Math.floor(elapsed / 1000 / 60 / 60);
    const minutes = Math.floor((elapsed / 1000 / 60) % 60);
    const secs = Math.floor((elapsed / 1000) % 60);
    const text = `稼働中 | ${hours}h${minutes}m${secs}s`;
    try {
      client.user.setActivity(text, { type: ActivityType.Watching });
    } catch {}
  };

  updateUptimeStatus();
  setInterval(updateUptimeStatus, 5000);
});

// ============ ログイン ============
client.login(token);