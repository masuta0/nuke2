// utils/guild.js
const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionsBitField } = require('discord.js');
const { LOG_CHANNEL_ID } = require('./anti-raid');
const { uploadToDropbox, ensureFolder, downloadFromDropbox } = require('./storage'); // storage.jsから必要な関数をインポート

const BACKUP_DIR = process.env.BACKUP_PATH || './backups';
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function hasManageGuildPermission(member) {
  if (!member || !member.permissions) {
    return false;
  }
  return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
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

// Dropboxにバックアップを保存する関数
async function backupServer(guild) {
  const data = await collectBackup(guild);
  const BACKUP_DIR_DROPBOX = '/bot_backups';

  await ensureFolder(BACKUP_DIR_DROPBOX);

  const success = await uploadToDropbox(
    `${BACKUP_DIR_DROPBOX}/${guild.id}.json`,
    JSON.stringify(data, null, 2)
  );

  if (success) {
    console.log(`✅ バックアップをDropboxにアップロードしました: ${guild.id}.json`);
  } else {
    console.error(`❌ バックアップのDropboxアップロードに失敗しました。`);
  }
}

async function getOrCreateLogChannel(guild) {
  let logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) {
      try {
          logChannel = await guild.channels.create({
              name: 'bot-logs',
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

// 復元機能もDropboxから読み込むように修正
async function restoreServer(guild, feedbackChannel) {
  const backup = await downloadFromDropbox(`/bot_backups/${guild.id}.json`);
  if (!backup) return false;

  const backupData = JSON.parse(backup);
  const existingRoles = guild.roles.cache;
  const existingChannels = guild.channels.cache;

  const roleIdMap = new Map();
  roleIdMap.set(guild.id, guild.id);

  for (const r of backupData.roles) {
    if (r.id === guild.id) continue;
    const existingRole = existingRoles.find(er => er.name === r.name);
    if (!existingRole) {
      try {
        const created = await guild.roles.create({
          name: r.name,
          color: r.color,
          hoist: r.hoist,
          mentionable: r.mentionable,
          permissions: BigInt(r.permissions),
          reason: 'Restore: create missing role'
        });
        roleIdMap.set(r.id, created.id);
        await delay(60);
      } catch (e) {
        console.error(`ロール ${r.name} の作成に失敗しました:`, e);
      }
    } else {
      roleIdMap.set(r.id, existingRole.id);
    }
  }

  const channelIdMap = new Map();
  const categories = backupData.channels.filter(c => c.type === ChannelType.GuildCategory);
  for (const cat of categories) {
    const existingCat = existingChannels.find(ec => ec.name === cat.name && ec.type === ChannelType.GuildCategory);
    if (!existingCat) {
      try {
        const created = await guild.channels.create({
          name: cat.name,
          type: ChannelType.GuildCategory,
          position: cat.position,
          reason: 'Restore: create missing category'
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
      } catch (e) {
        console.error(`カテゴリ ${cat.name} の作成に失敗しました:`, e);
      }
    } else {
      channelIdMap.set(cat.id, existingCat.id);
    }
  }

  const others = backupData.channels.filter(c => c.type !== ChannelType.GuildCategory);
  for (const ch of others) {
    if (ch.id === LOG_CHANNEL_ID) continue;
    const existingCh = existingChannels.find(ec => ec.name === ch.name && ec.type === ch.type);
    if (!existingCh) {
      try {
        const payload = {
          name: ch.name,
          type: ch.type,
          parent: ch.parentId ? channelIdMap.get(ch.parentId) || null : null,
          position: ch.position,
          reason: 'Restore: create missing channel'
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
      } catch (e) {
        console.error(`チャンネル ${ch.name} の作成に失敗しました:`, e);
      }
    }
  }

  try {
    if (backupData.meta?.name && guild.name !== backupData.meta.name) await guild.setName(backupData.meta.name, 'Restore: guild name');
    if (backupData.meta?.iconURL) await guild.setIcon(backupData.meta.iconURL, 'Restore: guild icon');
  } catch (e) {
    console.error('サーバーメタデータの復元に失敗しました:', e);
  }

  try {
    const textChannels = guild.channels.cache.filter(c => c.isTextBased());
    if (textChannels.size > 0) await textChannels.random().send('✅ バックアップを復元完了しました');
  } catch (e) {
    console.error('復元完了メッセージの送信に失敗しました:', e);
  }

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

async function clearMessages(channel, amount, feedbackChannel) {
  let messagesToDelete = amount;
  let lastMessageId = null;
  let deletedCount = 0;

  const now = Date.now();
  const twoWeeksAgo = now - (14 * 24 * 60 * 60 * 1000);

  while (messagesToDelete > 0) {
    const fetchLimit = Math.min(messagesToDelete, 100);
    const fetched = await channel.messages.fetch({ limit: fetchLimit, before: lastMessageId });
    if (fetched.size === 0) break;

    const recentMessages = fetched.filter(msg => msg.createdTimestamp > twoWeeksAgo);

    if (recentMessages.size > 0) {
      await channel.bulkDelete(recentMessages, true).catch(e => {
        console.error(`Bulk delete failed: ${e}`);
        if(feedbackChannel) feedbackChannel.send(`⚠️ メッセージの一括削除に失敗しました。`).catch(()=>{});
      });
      deletedCount += recentMessages.size;
    }

    messagesToDelete -= fetched.size;
    lastMessageId = fetched.last().id;

    if (recentMessages.size < fetched.size) {
      break;
    }
  }

  if (messagesToDelete > 0) {
    const slowDeleteMsg = await feedbackChannel.send('⚠️ 14日以上前のメッセージは個別削除します。時間がかかります...').catch(()=>{});
    while (messagesToDelete > 0) {
      const fetched = await channel.messages.fetch({ limit: 100, before: lastMessageId });
      if (fetched.size === 0) break;

      for (const [id, msg] of fetched) {
        if (messagesToDelete <= 0) break;
        await msg.delete().catch(e => console.error(`Failed to delete message: ${e}`));
        deletedCount++;
        messagesToDelete--;
        await delay(1000);
      }
      lastMessageId = fetched.last().id;
      if(slowDeleteMsg) slowDeleteMsg.edit(`🧹 ${deletedCount}件のメッセージを削除しました。`).catch(()=>{});
    }
  }

  return deletedCount;
}

async function addRoleToAll(guild, roleName) {
  const role = guild.roles.cache.find(r => r.name === roleName || r.id === roleName);
  if (!role) {
    return { success: false, error: '指定されたロールが見つかりません。' };
  }
  let count = 0;
  try {
    const members = await guild.members.fetch();
    for (const member of members.values()) {
      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role);
        count++;
        await delay(500); 
      }
    }
    return { success: true, count: count };
  } catch (e) {
    console.error(`Error adding role to all members: ${e}`);
    return { success: false, error: e.message };
  }
}

async function lockChannels(guild, roleId) {
    const everyoneRole = guild.roles.everyone;
    const targetRole = guild.roles.cache.get(roleId);

    if (!targetRole) {
        console.error('指定されたロールが見つかりません:', roleId);
        return false;
    }

    let lockedCount = 0;
    let unlockedCount = 0;

    for (const [channelId, channel] of guild.channels.cache) {
        if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildVoice) {
            continue;
        }

        if (!channel.name.includes('認証')) {
            try {
                await channel.permissionOverwrites.edit(everyoneRole, {
                    ViewChannel: false,
                });
                await channel.permissionOverwrites.edit(targetRole, {
                    ViewChannel: true,
                });
                lockedCount++;
            } catch (e) {
                console.error(`チャンネル ${channel.name} のロックに失敗しました:`, e);
            }
        } else {
            try {
                await channel.permissionOverwrites.edit(everyoneRole, {
                    ViewChannel: true,
                });
                await channel.permissionOverwrites.edit(targetRole, {
                    ViewChannel: true,
                });
                unlockedCount++;
            } catch (e) {
                console.error(`チャンネル ${channel.name} のアンロックに失敗しました:`, e);
            }
        }
    }
    return { locked: lockedCount, unlocked: unlockedCount };
}

module.exports = {
  hasManageGuildPermission,
  backupServer,
  restoreServer,
  nukeChannel,
  clearMessages,
  addRoleToAll,
  lockChannels,
};
