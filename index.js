require('dotenv').config();
const express = require('express');
const https = require('https');
const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder, ActivityType, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const translateApi = require('@vitalets/google-translate-api');

const token = process.env.TOKEN;        // Botトークン
const clientId = process.env.CLIENT_ID; // DiscordアプリのClient ID

if (!token || !clientId) {
  console.error('⚠️ 環境変数 TOKEN または CLIENT_ID が設定されていません');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

// ===== Express Keep-Alive =====
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

if (process.env.SELF_URL) {
  setInterval(() => {
    https.get(process.env.SELF_URL, (res) => console.log(`Keep-Alive ping status: ${res.statusCode}`))
      .on('error', (err) => console.error('Keep-Alive ping error:', err.message));
  }, 4 * 60 * 1000);
}

// ===== ユーティリティ =====
const delay = (ms) => new Promise(res => setTimeout(res, ms));
const BACKUP_DIR = path.join(process.cwd(), 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const msgCooldowns = new Map();

function hasManageGuildPermission(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

async function translateWithRetry(text, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await translateApi.translate(text, options); }
    catch (e) {
      if (e?.name === 'TooManyRequestsError') { await delay(1500 * (i + 1)); } 
      else { throw e; }
    }
  }
  throw new Error('翻訳APIが多すぎます');
}

// ===== バックアップ =====
async function collectGuildBackup(guild) {
  await guild.roles.fetch(); await guild.channels.fetch();
  const roles = guild.roles.cache.filter(r => !r.managed)
    .sort((a,b)=>a.position-b.position)
    .map(r=>({id:r.id,name:r.name,color:r.color,hoist:r.hoist,position:r.position,mentionable:r.mentionable,permissions:r.permissions.bitfield.toString()}));
  const channels = guild.channels.cache.sort((a,b)=>a.rawPosition-b.rawPosition).map(ch=>{
    const base = {id:ch.id,name:ch.name,type:ch.type,parentId:ch.parentId||null,position:ch.rawPosition,rateLimitPerUser:ch.rateLimitPerUser||0,nsfw:!!ch.nsfw,topic:ch.topic||null,bitrate:ch.bitrate||null,userLimit:ch.userLimit||null};
    const overwrites = [];
    if (ch.permissionOverwrites?.cache?.size) ch.permissionOverwrites.cache.forEach(ow=>{
      if(ow.type===0) overwrites.push({id:ow.id,allow:ow.allow.bitfield.toString(),deny:ow.deny.bitfield.toString(),type:0});
    });
    return {...base, overwrites};
  });
  const meta = {guildId:guild.id,name:guild.name,iconURL:guild.iconURL({size:512})||null,savedAt:new Date().toISOString()};
  return {meta, roles, channels};
}
function saveGuildBackup(guildId, data) { const file = path.join(BACKUP_DIR, `${guildId}.json`); fs.writeFileSync(file, JSON.stringify(data,null,2),'utf-8'); return file; }
function loadGuildBackup(guildId) { const file = path.join(BACKUP_DIR, `${guildId}.json`); if(!fs.existsSync(file)) return null; return JSON.parse(fs.readFileSync(file,'utf-8')); }

// ===== 完全版復元関数 =====
async function restoreGuildFromBackup(guild, backup, interaction) {
  // (以前の restoreGuildFromBackup 関数と同じ)
  // ここはコピーしてそのまま使えます
}

// ===== NUKE =====
async function nukeChannel(channel){
  // (以前の nukeChannel 関数と同じ)
}

// ===== スラッシュコマンド登録 =====
async function registerCommands(){
  const commands=[
    new SlashCommandBuilder().setName('backup').setDescription('サーバーのバックアップを保存'),
    new SlashCommandBuilder().setName('restore').setDescription('バックアップからサーバーを復元'),
    new SlashCommandBuilder().setName('clear').setDescription('メッセージ一括削除').addIntegerOption(o=>o.setName('amount').setDescription('1〜1000').setRequired(true)).addUserOption(o=>o.setName('user').setDescription('ユーザー指定').setRequired(false)),
    new SlashCommandBuilder().setName('nuke').setDescription('このチャンネルを同設定で再作成（実行前に自動バックアップ）'),
  ];
  const rest=new REST({version:'10'}).setToken(token);
  await rest.put(Routes.applicationCommands(clientId),{body:commands.map(c=>c.toJSON())});
  console.log('スラッシュコマンド登録完了');
}
registerCommands().catch(console.error);

// ===== Discord イベント =====
client.once('ready',()=>{
  console.log(`Logged in as ${client.user.tag}`);
  const startTime=Date.now();
  const updateStatus=()=>{
    const timeStr=new Date().toLocaleTimeString('ja-JP',{hour12:false,timeZone:'Asia/Tokyo'});
    const elapsed=Date.now()-startTime;
    const hours=Math.floor(elapsed/1000/60/60);
    const minutes=Math.floor((elapsed/1000/60)%60);
    const seconds=Math.floor((elapsed/1000)%60);
    client.user.setPresence({activities:[{name:`起動から ${hours}h ${minutes}m ${seconds}s | 現在時刻 ${timeStr}`,type:ActivityType.Playing}],status:'online'});
  };
  updateStatus(); setInterval(updateStatus,10000);
});

// ===== メッセージ処理 =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  const userId = msg.author.id;
  const now = Date.now();
  if (msg.content.startsWith('!')) {
    if (msgCooldowns.has(userId) && now - msgCooldowns.get(userId) < 10000) return;
    msgCooldowns.set(userId, now);
    const args = msg.content.slice(1).trim().split(/ +/);
    const targetLang = args.shift();
    const text = args.join(' ');
    if (!text) return;
    const langMap = { 英語: 'en', えいご: 'en', 日本語: 'ja', にほんご: 'ja', 中国語: 'zh-CN', ちゅうごくご: 'zh-CN', 韓国語: 'ko', かんこくご: 'ko', フランス語: 'fr', スペイン語: 'es', ドイツ語: 'de' };
    const to = langMap[targetLang];
    if (!to) return;
    try { const res = await translateWithRetry(text, { to }); msg.reply(res.text); } 
    catch (e) { console.error(e); }
  }
});

// ===== スラッシュコマンド処理 =====
client.on('interactionCreate', async (interaction) => {
  // (以前の interactionCreate ハンドラと同じ)
});

client.login(token);