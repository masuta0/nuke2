require('dotenv').config();
const express = require('express');
const https = require('https');
const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder, ActivityType, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const translateApi = require('@vitalets/google-translate-api');

const clientId = process.env.CLIENT_ID;
const token = process.env.TOKEN;

// ===== Discord Client =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

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

// ===== Utilities =====
const delay = ms => new Promise(res => setTimeout(res, ms));

// Railway対応: バックアップパス
const BACKUP_DIR = process.env.BACKUP_PATH || '/mnt/backups';
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const msgCooldowns = new Map();

function hasManageGuildPermission(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
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

// ===== Backup Functions =====
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

  const meta = { guildId: guild.id, name: guild.name, iconURL: guild.iconURL({ size: 512 }) || null, savedAt: new Date().toISOString() };
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

// ===== Restore Function =====
async function restoreGuildFromBackup(guild, backup, interaction) {
  // チャンネル削除
  for (const ch of guild.channels.cache.values()) { try { await ch.delete('Restore: clear channels'); await delay(50); } catch {} }
  // ロール削除
  const deletableRoles = guild.roles.cache.filter(r => !r.managed && r.id !== guild.id).sort((a, b) => a.position - b.position);
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
  const categories = backup.channels.filter(c => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  for (const cat of categories) {
    try {
      const created = await guild.channels.create({
        name: cat.name,
        type: ChannelType.GuildCategory,
        position: cat.position,
        reason: 'Restore: create category'
      });
      channelIdMap.set(cat.id, created.id);
      if (cat.overwrites?.length) {
        await created.permissionOverwrites.set(cat.overwrites.map(ow => ({
          id: roleIdMap.get(ow.id) || guild.id,
          allow: BigInt(ow.allow),
          deny: BigInt(ow.deny),
          type: ow.type
        })), 'Restore: set category overwrites');
      }
      await delay(60);
    } catch (e) { console.error('Category create failed:', cat.name, e.message); }
  }

  const others = backup.channels.filter(c => c.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  for (const ch of others) {
    try {
      const payload = {
        name: ch.name,
        type: ch.type,
        parent: ch.parentId ? channelIdMap.get(ch.parentId) || null : null,
        position: ch.position,
        reason: 'Restore: create channel'
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
        await created.permissionOverwrites.set(ch.overwrites.map(ow => ({
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

  const textChannels = guild.channels.cache.filter(c => c.isTextBased());
  if (textChannels.size > 0) {
    const randomCh = textChannels.random();
    try { await randomCh.send('✅ バックアップを復元完了しました'); } catch {}
  }

  if (interaction) {
    try { await interaction.followUp({ content: '✅ 完全復元が完了しました', flags: 64 }); } catch {}
  }
}

// ===== NUKE =====
async function nukeChannel(channel) {
  const overwrites = channel.permissionOverwrites?.cache?.map(ow => ({
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
    try {
      await newCh.permissionOverwrites.set(overwrites.map(ow => ({
        id: ow.id,
        allow: BigInt(ow.allow),
        deny: BigInt(ow.deny),
        type: ow.type
      })), 'Nuke: set overwrites');
    } catch {}
  }

  try { await channel.delete('Nuke: delete old channel'); } catch {}
  try { await newCh.send('✅ チャンネルをNukeしました'); } catch {}
  return newCh;
}

// ===== Slash Commands =====
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('backup').setDescription('サーバーのバックアップを保存'),
    new SlashCommandBuilder().setName('restore').setDescription('バックアップからサーバーを復元'),
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('メッセージ一括削除')
      .addIntegerOption(o => o.setName('amount').setDescription('1〜1000').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('ユーザー指定').setRequired(false)),
    new SlashCommandBuilder().setName('nuke').setDescription('このチャンネルを同設定で再作成（実行前に自動バックアップ）'),
  ];
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands.map(c => c.toJSON()) });
  console.log('スラッシュコマンド登録完了');
}
registerCommands().catch(console.error);

// ===== Client Events =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  const startTime = Date.now();
  const updateStatus = () => {
    const timeStr = new Date().toLocaleTimeString('ja-JP', { hour12: false, timeZone: 'Asia/Tokyo' });
    const elapsed = Date.now() - startTime;
    const hours = Math.floor(elapsed / 1000 / 60 / 60);
    const minutes = Math.floor((elapsed / 1000 / 60) % 60);
    const seconds = Math.floor((elapsed / 1000) % 60);
    client.user.setPresence({
      activities: [{ name: `起動から ${hours}h ${minutes}m ${seconds}s | 現在時刻 ${timeStr}`, type: ActivityType.Playing }],
      status: 'online'
    });
  };
  updateStatus();
  setInterval(updateStatus, 10000);
});

// ===== Message Handling =====
client.on('messageCreate', async msg => {
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
    try { const res = await translateWithRetry(text, { to }); await msg.reply(res.text); } catch (e) { console.error(e); }
  }
});

// ===== Interaction Handling =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  const guild = interaction.guild;
  if (!guild) return interaction.reply({ content: 'サーバー内で実行してください', flags: 64 });
  if (!hasManageGuildPermission(interaction.member)) return interaction.reply({ content: '管理者権限が必要です', flags: 64 });

  try {
    await interaction.deferReply({ flags: 64 });

    if (commandName === 'backup') {
      const backup = await collectGuildBackup(guild);
      saveGuildBackup(guild.id, backup);
      await interaction.followUp({ content: '✅ バックアップを保存しました', flags: 64 });
    }

    if (commandName === 'restore') {
      const backup = loadGuildBackup(guild.id);
      if (!backup) return await interaction.followUp({ content: '⚠️ バックアップが見つかりません', flags: 64 });
      await restoreGuildFromBackup(guild, backup, interaction);
    }

    if (commandName === 'nuke') {
      const backup = await collectGuildBackup(guild);
      saveGuildBackup(guild.id, backup);
      await nukeChannel(interaction.channel);
      await interaction.followUp({ content: '💥 チャンネルをNukeしました', flags: 64 });
    }

    if (commandName === 'clear') {
      const amount = interaction.options.getInteger('amount');
      const user = interaction.options.getUser('user');
      const msgs = await interaction.channel.messages.fetch({ limit: amount });
      const filtered = user ? msgs.filter(m => m.author.id === user.id) : msgs;
      await interaction.channel.bulkDelete(filtered, true);
      await interaction.followUp({ content: `🧹 ${filtered.size}件のメッセージを削除しました`, flags: 64 });
    }
  } catch (e) {
    console.error('Interaction error:', e);
  }
});

// ===== Error Handling =====
client.on('error', console.error);

client.login(token);