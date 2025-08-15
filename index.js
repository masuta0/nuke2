// index.js (完全フルコード)
// ─────────────────────────────────────────────────────────────
// 必要な環境変数：
// DISCORD/TOKEN, DISCORD/CLIENT_ID, OPENWEATHER_KEY, DROPBOX_TOKEN
// 任意: PORT, SELF_URL, BACKUP_PATH
// ─────────────────────────────────────────────────────────────

require('dotenv').config();

const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Node 18+ は fetch 同梱。18未満用フォールバック（CJSでも動く形）
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = (...args) =>
    import('node-fetch').then(({ default: f }) => f(...args));
}

const translateApi = require('@vitalets/google-translate-api');

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ActivityType,
  ChannelType
} = require('discord.js');

// ── 環境変数 ────────────────────────────────────────────────
const CLIENT_ID = process.env.CLIENT_ID;
const TOKEN = process.env.TOKEN;
const DROPBOX_TOKEN = process.env.DROPBOX_TOKEN;           // Dropbox App のアクセストークン
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;       // OpenWeatherMap APIキー
const PORT = process.env.PORT || 3000;
const SELF_URL = process.env.SELF_URL || null;
const BACKUP_DIR = process.env.BACKUP_PATH || './backups';

// ── Discord クライアント ──────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent
  ],
});

// ── 事前準備 ───────────────────────────────────────────────
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(BACKUP_DIR);
ensureDir(path.join(BACKUP_DIR, 'weather')); // ローカルの天気設定保存先

const msgCooldowns = new Map();              // 翻訳の簡易クールダウン
const userWeatherPrefs = new Map();          // メモリ上の天気設定キャッシュ（userId -> {pref, city}）

// ── Express Keep-Alive（Railway/Replit用） ──────────────────
const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

if (SELF_URL) {
  setInterval(() => {
    https.get(SELF_URL, res => console.log(`Keep-Alive ping status: ${res.statusCode}`))
      .on('error', err => console.error('Keep-Alive ping error:', err.message));
  }, 4 * 60 * 1000);
}

// ── 共通ユーティリティ ────────────────────────────────────
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const hasManageGuildPermission = (member) =>
  member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild);

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

// ── Dropbox 直叩きヘルパー（SDK不使用で fetch だけで完結） ─────────
// 参考: https://www.dropbox.com/developers/documentation/http/documentation
async function dropboxUploadBuffer(buffer, dropboxPath) {
  if (!DROPBOX_TOKEN) throw new Error('DROPBOX_TOKEN が設定されていません');
  const url = 'https://content.dropboxapi.com/2/files/upload';
  const headers = {
    'Authorization': `Bearer ${DROPBOX_TOKEN}`,
    'Dropbox-API-Arg': JSON.stringify({
      path: dropboxPath,
      mode: 'overwrite',
      mute: true,
      strict_conflict: false
    }),
    'Content-Type': 'application/octet-stream'
  };
  const res = await fetch(url, { method: 'POST', headers, body: buffer });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dropbox upload failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function dropboxDownloadToBuffer(dropboxPath) {
  if (!DROPBOX_TOKEN) throw new Error('DROPBOX_TOKEN が設定されていません');
  const url = 'https://content.dropboxapi.com/2/files/download';
  const headers = {
    'Authorization': `Bearer ${DROPBOX_TOKEN}`,
    'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath })
  };
  const res = await fetch(url, { method: 'POST', headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dropbox download failed: ${res.status} ${text}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// ── Discord バックアップ関連 ───────────────────────────────
async function collectGuildBackup(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const roles = guild.roles.cache
    .filter(r => !r.managed)
    .sort((a, b) => a.position - b.position)
    .map(r => ({
      id: r.id, name: r.name, color: r.color, hoist: r.hoist, position: r.position,
      mentionable: r.mentionable, permissions: r.permissions.bitfield.toString()
    }));

  const channels = guild.channels.cache
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(ch => {
      const base = {
        id: ch.id, name: ch.name, type: ch.type, parentId: ch.parentId || null,
        position: ch.rawPosition, rateLimitPerUser: ch.rateLimitPerUser || 0,
        nsfw: !!ch.nsfw, topic: ch.topic || null, bitrate: ch.bitrate || null,
        userLimit: ch.userLimit || null
      };
      const overwrites = [];
      if (ch.permissionOverwrites?.cache?.size) {
        ch.permissionOverwrites.cache.forEach(ow => {
          // 0: role, 1: member（ここでは role のみ保存）
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

  const meta = {
    guildId: guild.id,
    name: guild.name,
    iconURL: guild.iconURL({ size: 512 }) || null,
    savedAt: new Date().toISOString()
  };

  return { meta, roles, channels };
}

function saveGuildBackup(guildId, data) {
  ensureDir(BACKUP_DIR);
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
  // 既存チャンネル削除
  for (const ch of guild.channels.cache.values()) {
    try { await ch.delete('Restore: clear channels'); await delay(50); } catch {}
  }
  // 既存ロール削除（@everyone除く・managed除く）
  const deletableRoles = guild.roles.cache
    .filter(r => !r.managed && r.id !== guild.id)
    .sort((a,b)=>a.position-b.position);
  for (const r of deletableRoles.values()) {
    try { await r.delete('Restore: clear roles'); await delay(50); } catch {}
  }

  // ロール復元
  const roleIdMap = new Map();
  for (const r of backup.roles) {
    if (r.id === guild.id) continue;
    try {
      const created = await guild.roles.create({
        name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
        permissions: BigInt(r.permissions), reason: 'Restore: create role'
      });
      roleIdMap.set(r.id, created.id);
      await delay(60);
    } catch (e) { console.error('Role create failed:', r.name, e.message); }
  }

  // カテゴリ → その他チャンネルの順で作成
  const channelIdMap = new Map();

  const categories = backup.channels
    .filter(c=>c.type===ChannelType.GuildCategory)
    .sort((a,b)=>a.position-b.position);

  for (const cat of categories) {
    try {
      const created = await guild.channels.create({
        name: cat.name, type: ChannelType.GuildCategory, position: cat.position,
        reason: 'Restore: create category'
      });
      channelIdMap.set(cat.id, created.id);
      if (cat.overwrites?.length) {
        await created.permissionOverwrites.set(cat.overwrites.map(ow=>({
          id: roleIdMap.get(ow.id)||guild.id,
          allow: BigInt(ow.allow), deny: BigInt(ow.deny), type: ow.type
        })), 'Restore: set category overwrites');
      }
      await delay(60);
    } catch (e) { console.error('Category create failed:', cat.name, e.message); }
  }

  const others = backup.channels
    .filter(c=>c.type!==ChannelType.GuildCategory)
    .sort((a,b)=>a.position-b.position);

  for (const ch of others) {
    try {
      const payload = {
        name: ch.name, type: ch.type,
        parent: ch.parentId ? (channelIdMap.get(ch.parentId)||null) : null,
        position: ch.position, reason: 'Restore: create channel'
      };
      if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(ch.type)) {
        payload.topic = ch.topic||null;
        payload.nsfw = !!ch.nsfw;
        payload.rateLimitPerUser = ch.rateLimitPerUser||0;
      }
      if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(ch.type)) {
        payload.bitrate = ch.bitrate||null;
        payload.userLimit = ch.userLimit||null;
      }
      const created = await guild.channels.create(payload);
      channelIdMap.set(ch.id, created.id);
      if (ch.overwrites?.length) {
        await created.permissionOverwrites.set(ch.overwrites.map(ow=>({
          id: roleIdMap.get(ow.id)||guild.id, allow: BigInt(ow.allow), deny: BigInt(ow.deny), type: ow.type
        })), 'Restore: set overwrites');
      }
      await delay(60);
    } catch (e) { console.error('Channel create failed:', ch.name, e.message); }
  }

  try {
    if (backup.meta?.name && guild.name !== backup.meta.name)
      await guild.setName(backup.meta.name, 'Restore: guild name');
    if (backup.meta?.iconURL)
      await guild.setIcon(backup.meta.iconURL, 'Restore: guild icon');
  } catch (e) { console.warn('Guild meta restore failed:', e.message); }

  try {
    const textChannels = guild.channels.cache.filter(c=>c.isTextBased());
    if (textChannels.size>0) await textChannels.random().send('✅ バックアップを復元完了しました');
  } catch {}

  if (interaction) await interaction.followUp({ content:'✅ 完全復元が完了しました', flags:64 }).catch(()=>{});
}

// Nuke
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
    reason:'Nuke: recreate channel'
  };

  const newCh = await channel.guild.channels.create(payload);
  if (overwrites.length) {
    await newCh.permissionOverwrites.set(overwrites.map(ow=>({
      id: ow.id, allow: BigInt(ow.allow), deny: BigInt(ow.deny), type: ow.type
    })), 'Nuke: set overwrites');
  }

  try { await channel.delete('Nuke: delete old channel'); } catch {}
  if (interaction) await interaction.followUp({ content:'💥 チャンネルをNukeしました', flags:64 }).catch(()=>{});
  try { await newCh.send('✅ チャンネルをNukeしました'); } catch {}
  return newCh;
}

// Clear
async function clearMessages(channel, amount, user, interaction) {
  const msgs = await channel.messages.fetch({ limit: Math.min(100, amount) });
  const filtered = user ? msgs.filter(m => m.author.id === user.id) : msgs;
  await channel.bulkDelete(filtered, true);
  if (interaction) await interaction.followUp({ content:`🧹 ${filtered.size}件のメッセージを削除しました`, flags:64 }).catch(()=>{});
}

// ── 47都道府県 → 代表都市（OpenWeather用）マッピング ───────────
const PREF_TO_CITY = {
  '北海道':'Sapporo','青森':'Aomori','岩手':'Morioka','宮城':'Sendai','秋田':'Akita','山形':'Yamagata','福島':'Fukushima',
  '茨城':'Mito','栃木':'Utsunomiya','群馬':'Maebashi','埼玉':'Saitama','千葉':'Chiba','東京':'Tokyo','神奈川':'Yokohama',
  '新潟':'Niigata','富山':'Toyama','石川':'Kanazawa','福井':'Fukui','山梨':'Kofu','長野':'Nagano','岐阜':'Gifu',
  '静岡':'Shizuoka','愛知':'Nagoya','三重':'Tsu','滋賀':'Otsu','京都':'Kyoto','大阪':'Osaka','兵庫':'Kobe','奈良':'Nara','和歌山':'Wakayama',
  '鳥取':'Tottori','島根':'Matsue','岡山':'Okayama','広島':'Hiroshima','山口':'Yamaguchi',
  '徳島':'Tokushima','香川':'Takamatsu','愛媛':'Matsuyama','高知':'Kochi',
  '福岡':'Fukuoka','佐賀':'Saga','長崎':'Nagasaki','熊本':'Kumamoto','大分':'Oita','宮崎':'Miyazaki','鹿児島':'Kagoshima','沖縄':'Naha'
};

// 正規化（ひらがな・カタカナも対応）
const PREF_ALIASES = {
  'ほっかいどう':'北海道','あおもり':'青森','いわて':'岩手','みやぎ':'宮城','あきた':'秋田','やまがた':'山形','ふくしま':'福島',
  'いばらき':'茨城','とちぎ':'栃木','ぐんま':'群馬','さいたま':'埼玉','ちば':'千葉','とうきょう':'東京','かながわ':'神奈川',
  'にいがた':'新潟','とやま':'富山','いしかわ':'石川','ふくい':'福井','やまなし':'山梨','ながの':'長野','ぎふ':'岐阜',
  'しずおか':'静岡','あいち':'愛知','みえ':'三重','しが':'滋賀','きょうと':'京都','おおさか':'大阪','ひょうご':'兵庫','なら':'奈良','わかやま':'和歌山',
  'とっとり':'鳥取','しまね':'島根','おかやま':'岡山','ひろしま':'広島','やまぐち':'山口',
  'とくしま':'徳島','かがわ':'香川','えひめ':'愛媛','こうち':'高知',
  'ふくおか':'福岡','さが':'佐賀','ながさき':'長崎','くまもと':'熊本','おおいた':'大分','みやざき':'宮崎','かごしま':'鹿児島','おきなわ':'沖縄',
  // カタカナ
  'ホッカイドウ':'北海道','アオモリ':'青森','イワテ':'岩手','ミヤギ':'宮城','アキタ':'秋田','ヤマガタ':'山形','フクシマ':'福島',
  'イバラキ':'茨城','トチギ':'栃木','グンマ':'群馬','サイタマ':'埼玉','チバ':'千葉','トウキョウ':'東京','カナガワ':'神奈川',
  'ニイガタ':'新潟','トヤマ':'富山','イシカワ':'石川','フクイ':'福井','ヤマナシ':'山梨','ナガノ':'長野','ギフ':'岐阜',
  'シズオカ':'静岡','アイチ':'愛知','ミエ':'三重','シガ':'滋賀','キョウト':'京都','オオサカ':'大阪','ヒョウゴ':'兵庫','ナラ':'奈良','ワカヤマ':'和歌山',
  'トットリ':'鳥取','シマネ':'島根','オカヤマ':'岡山','ヒロシマ':'広島','ヤマグチ':'山口',
  'トクシマ':'徳島','カガワ':'香川','エヒメ':'愛媛','コウチ':'高知',
  'フクオカ':'福岡','サガ':'佐賀','ナガサキ':'長崎','クマモト':'熊本','オオイタ':'大分','ミヤザキ':'宮崎','カゴシマ':'鹿児島','オキナワ':'沖縄'
};

function normalizePref(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (PREF_TO_CITY[s]) return s;                       // そのまま都道府県漢字
  if (PREF_ALIASES[s]) return PREF_ALIASES[s];         // ひらがな/カタカナエイリアス
  // 「東京都/大阪府/〜県」→ 末尾の都道府県/府/道を落とすパターン
  const stripped = s.replace(/[都道府県府]$/u, '');
  // stripped が「東京」「大阪」などになればマッチ可能
  for (const key of Object.keys(PREF_TO_CITY)) {
    if (key.startsWith(stripped)) return key;
  }
  return null;
}

// ── 天気保存（ユーザー毎） ─────────────────────────────────
async function saveUserWeatherPrefs(userId, prefRaw) {
  const pref = normalizePref(prefRaw);
  if (!pref) throw new Error(`不明な都道府県です: ${prefRaw}`);
  const city = PREF_TO_CITY[pref]; // 代表都市
  const payload = { pref, city };

  // メモリ & ローカル保存
  userWeatherPrefs.set(userId, payload);
  const localFile = path.join(BACKUP_DIR, 'weather', `weather_${userId}.json`);
  fs.writeFileSync(localFile, JSON.stringify(payload, null, 2), 'utf-8');

  // Dropbox へも保存（失敗しても致命的ではない）
  try {
    const buf = Buffer.from(JSON.stringify(payload));
    await dropboxUploadBuffer(buf, `/weather/weather_${userId}.json`);
  } catch (e) {
    console.error('Dropboxアップロード失敗:', e.message || e);
  }
}

// 1ユーザー設定読み込み（ローカル→Dropboxフォールバック）
async function loadUserWeatherPrefs(userId) {
  // 既にメモリにあれば即返却
  if (userWeatherPrefs.has(userId)) return userWeatherPrefs.get(userId);

  const localFile = path.join(BACKUP_DIR, 'weather', `weather_${userId}.json`);
  if (fs.existsSync(localFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(localFile, 'utf-8'));
      userWeatherPrefs.set(userId, data);
      return data;
    } catch (e) {
      console.warn('ローカル天気設定の読み込み失敗:', e.message || e);
    }
  }

  // Dropbox から取得
  try {
    const buf = await dropboxDownloadToBuffer(`/weather/weather_${userId}.json`);
    ensureDir(path.join(BACKUP_DIR, 'weather'));
    fs.writeFileSync(localFile, buf);
    const data = JSON.parse(fs.readFileSync(localFile, 'utf-8'));
    userWeatherPrefs.set(userId, data);
    return data;
  } catch (e) {
    // 404やスコープ不足含め、見つからない/権限ないならnull
    console.warn('Dropboxから天気設定を取得できませんでした:', e.message || e);
    return null;
  }
}

// ── 天気取得（OpenWeatherMap Current weather） ──────────────
async function fetchWeatherByCity(city) {
  if (!OPENWEATHER_KEY) throw new Error('OPENWEATHER_KEY が設定されていません');
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)},JP&appid=${OPENWEATHER_KEY}&units=metric&lang=ja`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(`OpenWeather API error: ${res.status} ${text}`);
  }
  const data = await res.json();
  // レスポンス確認文字列も作成（デバッグ用）
  const debug = `id=${data.id}, name=${data.name}, coord=[${data.coord?.lat},${data.coord?.lon}]`;
  const desc = data.weather?.[0]?.description ?? '不明';
  const temp = data.main?.temp ?? 'N/A';
  const humid = data.main?.humidity ?? 'N/A';
  const wind = data.wind?.speed ?? 'N/A';
  return {
    text: `🌤 **${data.name}** の天気: ${desc}\n🌡 気温: ${temp}°C / 💧 湿度: ${humid}% / 🍃 風速: ${wind}m/s`,
    debug
  };
}

// ── スラッシュコマンド登録 ───────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('backup').setDescription('サーバーのバックアップを保存'),
    new SlashCommandBuilder().setName('restore').setDescription('バックアップからサーバーを復元'),
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('メッセージ一括削除')
      .addIntegerOption(o=>o.setName('amount').setDescription('1〜100').setRequired(true))
      .addUserOption(o=>o.setName('user').setDescription('ユーザー指定').setRequired(false)),
    new SlashCommandBuilder().setName('nuke').setDescription('このチャンネルを同設定で再作成（自動バックアップ付き）'),
    new SlashCommandBuilder()
      .setName('weather')
      .setDescription('天気設定または取得')
      .addStringOption(o=>o.setName('pref').setDescription('都道府県（例: 東京, 大阪, 北海道...）').setRequired(false)),
    new SlashCommandBuilder().setName('weather_check').setDescription('保存された天気設定を確認')
  ];
  const rest = new REST({ version:'10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c=>c.toJSON()) });
  console.log('スラッシュコマンド登録完了');
}
registerCommands().catch(console.error);

// ── インタラクション（スラッシュ） ───────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;
  const guild = interaction.guild;

  // weather / weather_check は一般ユーザーOK。他はギルド管理権限必須。
  if (['weather','weather_check'].includes(cmd) === false) {
    if (!guild) return interaction.reply({ content:'サーバー内で実行してください', flags:64 }).catch(()=>{});
    if (!hasManageGuildPermission(interaction.member))
      return interaction.reply({ content:'管理者権限が必要です', flags:64 }).catch(()=>{});
  }

  if (!interaction.deferred && !interaction.replied) {
    try { await interaction.deferReply({ flags:64 }); } catch {}
  }

  try {
    if (cmd === 'backup') {
      const backup = await collectGuildBackup(guild);
      const filePath = saveGuildBackup(guild.id, backup);
      // Dropbox にもサーバーごとのバックアップをアップロード（失敗しても続行）
      try {
        const buf = fs.readFileSync(filePath);
        await dropboxUploadBuffer(buf, `/backups/${guild.id}.json`);
      } catch (e) {
        console.warn('Dropboxへのサーバーバックアップアップロード失敗:', e.message || e);
      }
      await interaction.followUp({ content:'✅ バックアップを保存しました', flags:64 }).catch(()=>{});
    }

    else if (cmd === 'restore') {
      const backup = loadGuildBackup(guild.id);
      if (!backup) return await interaction.followUp({ content:'⚠️ バックアップが見つかりません', flags:64 }).catch(()=>{});
      await restoreGuildFromBackup(guild, backup, interaction);
    }

    else if (cmd === 'nuke') {
      await nukeChannel(interaction.channel, interaction);
    }

    else if (cmd === 'clear') {
      const amount = interaction.options.getInteger('amount');
      const user = interaction.options.getUser('user');
      const num = Math.max(1, Math.min(100, amount||1));
      await clearMessages(interaction.channel, num, user, interaction);
    }

    else if (cmd === 'weather') {
      const prefInput = interaction.options.getString('pref'); // 省略なら取得
      const userId = interaction.user.id;

      if (prefInput) {
        try {
          await saveUserWeatherPrefs(userId, prefInput);
          const saved = userWeatherPrefs.get(userId);
          await interaction.followUp({ content:`✅ 天気設定を保存しました: ${saved.pref}（代表都市: ${saved.city}）`, flags:64 });
        } catch (e) {
          await interaction.followUp({ content:`⚠️ 都道府県の保存に失敗: ${e.message}`, flags:64 });
        }
      } else {
        // 設定済みなら取得、未設定なら注意
        const saved = await loadUserWeatherPrefs(userId);
        if (!saved?.city) return await interaction.followUp({ content:'⚠️ まず `/weather pref:<都道府県>` で都道府県を保存してください', flags:64 });
        try {
          const { text } = await fetchWeatherByCity(saved.city);
          await interaction.followUp({ content: text, flags:64 });
        } catch (e) {
          await interaction.followUp({ content:`⚠️ 天気情報が取得できませんでした: ${e.message}`, flags:64 });
        }
      }
    }

    else if (cmd === 'weather_check') {
      const userId = interaction.user.id;
      const saved = await loadUserWeatherPrefs(userId);
      const hasKey = OPENWEATHER_KEY ? '✅' : '❌';
      await interaction.followUp({
        content:
          `🔎 天気設定確認\n` +
          `・APIキー: ${hasKey}（OPENWEATHER_KEY）\n` +
          `・保存先: ローカル(${BACKUP_DIR}/weather) + Dropbox(/weather)\n` +
          `・あなたの設定: ${saved ? `${saved.pref}（都市: ${saved.city}）` : '未設定'}`,
        flags:64
      });
    }

  } catch (e) {
    console.error('Interaction error:', e);
    if (!interaction.replied) {
      try { await interaction.followUp({ content:'❌ エラーが発生しました', flags:64 }); } catch {}
    }
  }
});

// ── メッセージコマンド（!天気 / 翻訳） ─────────────────────────
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;
    const content = (msg.content || '').trim();
    if (!content.startsWith('!')) return;

    // !天気 / !天気確認 は常時使える
    if (/^!天気確認$/.test(content)) {
      const saved = await loadUserWeatherPrefs(msg.author.id);
      await msg.reply(`🔎 あなたの天気設定: ${saved ? `${saved.pref}（都市: ${saved.city}）` : '未設定'}`);
      return;
    }

    if (/^!天気(\s+.+)?$/.test(content)) {
      const m = content.match(/^!天気(?:\s+(.+))?$/);
      const arg = m && m[1] ? m[1].trim() : '';

      if (arg) {
        // 設定モード
        try {
          await saveUserWeatherPrefs(msg.author.id, arg);
          const saved = userWeatherPrefs.get(msg.author.id);
          await msg.reply(`✅ 天気設定を保存しました: ${saved.pref}（代表都市: ${saved.city}）`);
        } catch (e) {
          await msg.reply(`⚠️ 都道府県の保存に失敗: ${e.message}`);
        }
      } else {
        // 取得モード
        const saved = await loadUserWeatherPrefs(msg.author.id);
        if (!saved?.city) return await msg.reply('⚠️ まず `!天気 東京` のように都道府県を保存してください');
        try {
          const { text } = await fetchWeatherByCity(saved.city);
          await msg.reply(text);
        } catch (e) {
          await msg.reply(`⚠️ 天気情報が取得できませんでした: ${e.message}`);
        }
      }
      return;
    }

    // それ以外の !コマンドは翻訳として解釈（簡易クールダウン10秒）
    const userId = msg.author.id;
    const now = Date.now();
    if (msg.content.startsWith('!')) {
      if (msgCooldowns.has(userId) && (now - msgCooldowns.get(userId) < 10_000)) return;
      msgCooldowns.set(userId, now);

      const args = content.slice(1).trim().split(/\s+/);
      const targetLang = args.shift();               // 例: 英語/日本語/…
      const text = args.join(' ');
      if (!text) return;

      const langMap = {
        '英語':'en','えいご':'en','日本語':'ja','にほんご':'ja',
        '中国語':'zh-CN','ちゅうごくご':'zh-CN','韓国語':'ko','かんこくご':'ko',
        'フランス語':'fr','スペイン語':'es','ドイツ語':'de'
      };
      const to = langMap[targetLang];
      if (!to) return; // 未対応の言語指定なら無視
      try {
        const res = await translateWithRetry(text, { to });
        await msg.reply(res.text);
      } catch (e) {
        console.error('翻訳失敗:', e);
      }
    }
  } catch (e) {
    console.error('messageCreate handler error:', e);
  }
});

// ── ステータス（稼働時間を5秒おきに更新） ─────────────────────
let botStartTime = Date.now();
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${hh}h${mm}m${ss}s`;
}
function updateUptimeStatus() {
  if (!client?.user) return;
  const elapsed = Date.now() - botStartTime;
  const text = `稼働中 | ${formatUptime(elapsed)}`;
  // setActivity は同期的に ClientUser を返すので .catch は付けない
  client.user.setActivity(text, { type: ActivityType.Watching });
}
setInterval(updateUptimeStatus, 5000);

// ── 起動時処理 ─────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  botStartTime = Date.now();
  // 初回も反映
  updateUptimeStatus();

  // 起動時に全ユーザーの天気設定をDropboxから総読み込み…はせず、
  // 必要時に on-demand で読み込む（スケール時のレート制限回避）
});

// ── ログイン ───────────────────────────────────────────────
client.login(TOKEN);