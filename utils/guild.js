// utils/guild.js

const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionsBitField } = require('discord.js');

// ★ 荒らし対策モジュールからログチャンネルIDをインポート
const { LOG_CHANNEL_ID } = require('./anti-raid');

const BACKUP_DIR = process.env.BACKUP_PATH || './backups';
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function hasManageGuildPermission(member) {
  return member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function collectBackup(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const roles = guild.roles.cache
    .filter(r => !r.managed)
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

  const channels = guild.channels.cache
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(ch => {
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
      ch.permissionOverwrites?.cache?.forEach(ow => {
        if (ow.type === 0) overwrites.push({
          id: ow.id,
          allow: ow.allow.bitfield.toString(),
          deny: ow.deny.bitfield.toString(),
          type: 0
        });
      });
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

function saveBackup(guildId, data) {
  const file = path.join(BACKUP_DIR, `${guildId}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

function loadBackup(guildId) {
  const file = path.join(BACKUP_DIR, `${guildId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

async function backupServer(guild) {
  const data = await collectBackup(guild);
  saveBackup(guild.id, data);
}

// ★ ログチャンネル自動作成/取得機能を追加
async function getOrCreateLogChannel(guild) {
  let logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) {
      try {
          logChannel = await guild.channels.create({
              name: 'bot-logs', // チャンネル名を自由に設定
              type: ChannelType.GuildText,
              reason: '荒らし対策ログチャンネルが削除されたため再作成',
          });
          console.log(`✅ ログチャンネルを再作成しました: #${logChannel.name}`);
      } catch (e) {
          console.error('❌ ログチャンネルの作成に失敗しました:', e);
          return null;
      }
  }
  return logChannel;
}

async function restoreServer(guild, feedbackChannel) {
  const backup = loadBackup(guild.id);
  if (!backup) return false;

  // 既存チャンネルを削除（ログチャンネル以外）
  for (const ch of guild.channels.cache.values()) {
    if (ch.id === LOG_CHANNEL_ID) continue; // ★ ログチャンネルをスキップ
    try { await ch.delete('Restore: clear channels'); await delay(50); } catch {}
  }

  // 既存ロールを削除（@everyoneと統合ロール以外）
  const deletable = guild.roles.cache
    .filter(r => !r.managed && r.id !== guild.id)
    .sort((a, b) => a.position - b.position);
  for (const r of deletable.values()) {
    try { await r.delete('Restore: clear roles'); await delay(50); } catch {}
  }

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
    } catch {}
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
        await created.permissionOverwrites.set(
          cat.overwrites.map(ow => ({
            id: roleIdMap.get(ow.id) || guild.id,
            allow: BigInt(ow.allow),
            deny: BigInt(ow.deny),
            type: ow.type
          })),
          'Restore: set category overwrites'
        );
      }
      await delay(60);
    } catch {}
  }

  const others = backup.channels.filter(c => c.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  for (const ch of others) {
    if (ch.id === LOG_CHANNEL_ID) continue; // ★ ログチャンネルの再作成をスキップ
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
        await created.permissionOverwrites.set(
          ch.overwrites.map(ow => ({
            id: roleIdMap.get(ow.id) || guild.id,
            allow: BigInt(ow.allow),
            deny: BigInt(ow.deny),
            type: ow.type
          })),
          'Restore: set overwrites'
        );
      }
      await delay(60);
    } catch {}
  }

  try {
    if (backup.meta?.name && guild.name !== backup.meta.name) await guild.setName(backup.meta.name, 'Restore: guild name');
    if (backup.meta?.iconURL) await guild.setIcon(backup.meta.iconURL, 'Restore: guild icon');
  } catch {}

  try {
    const textChannels = guild.channels.cache.filter(c => c.isTextBased());
    if (textChannels.size > 0) await textChannels.random().send('✅ バックアップを復元完了しました');
  } catch {}

  return true;
}

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
    await newCh.permissionOverwrites.set(
      overwrites.map(ow => ({
        id: ow.id,
        allow: BigInt(ow.allow),
        deny: BigInt(ow.deny),
        type: ow.type
      })),
      'Nuke: set overwrites'
    );
  }
  try { await channel.delete('Nuke: delete old'); } catch {}
  try { await newCh.send('✅ チャンネルをNukeしました'); } catch {}
  return newCh;
}

async function clearMessages(channel, amount) {
  const msgs = await channel.messages.fetch({ limit: Math.min(amount, 100) });
  await channel.bulkDelete(msgs, true).catch(() => {});
}

module.exports = {
  hasManageGuildPermission,
  backupServer,
  restoreServer,
  nukeChannel,
  clearMessages
};
