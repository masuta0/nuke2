// utils/guild.js
const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionsBitField } = require('discord.js');
const { LOG_CHANNEL_ID } = require('./anti-raid');
const { uploadToDropbox, ensureFolder, downloadFromDropbox } = require('./storage');

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
  await guild.members.fetch();
  await guild.emojis.fetch();
  await guild.stickers.fetch();

  const roles = guild.roles.cache
    .filter(r => !r.managed && r.id !== guild.id)
    .sort((a, b) => a.position - b.position)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.hexColor,
      hoist: r.hoist,
      position: r.position,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      members: r.members.map(m => m.id)
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
    verificationLevel: guild.verificationLevel,
    explicitContentFilter: guild.explicitContentFilter,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    systemChannelId: guild.systemChannelId,
    afkChannelId: guild.afkChannelId,
    afkTimeout: guild.afkTimeout,
    bannerURL: guild.bannerURL({ size: 512 }) || null,
    splashURL: guild.splashURL({ size: 512 }) || null,
    emojis: guild.emojis.cache.map(e => ({
        name: e.name,
        id: e.id,
        animated: e.animated,
    })),
    stickers: guild.stickers.cache.map(s => ({
        name: s.name,
        id: s.id,
    })),
    savedAt: new Date().toISOString()
  };

  return { meta, roles, channels };
}

async function backupServer(guild) {
  try {
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
    // ローカルにも保存
    fs.writeFileSync(path.join(BACKUP_DIR, `${guild.id}.json`), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`❌ backupServer関数でエラーが発生しました:`, e);
  }
}

// Dropboxから指定ファイル名で復元できるよう改修
async function restoreServer(guild, feedbackChannel, filename) {
  let backup;
  if (filename) {
    backup = await downloadFromDropbox(`/bot_backups/${filename}`);
    if (!backup) {
      if (feedbackChannel) feedbackChannel.send(`❌ Dropbox上にバックアップファイルが見つかりません: ${filename}`);
      return false;
    }
  } else {
    backup = await downloadFromDropbox(`/bot_backups/${guild.id}.json`);
    if (!backup) {
      if (feedbackChannel) feedbackChannel.send(`❌ Dropbox上にバックアップが見つかりません`);
      return false;
    }
  }

  const backupData = JSON.parse(backup);
  const existingRoles = guild.roles.cache;
  const existingChannels = guild.channels.cache;
  const existingMembers = await guild.members.fetch();

  const roleIdMap = new Map();
  roleIdMap.set(guild.id, guild.id);

  const backupRolesSorted = backupData.roles.sort((a, b) => a.position - b.position);
  for (const r of backupRolesSorted) {
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
      try {
        await existingRole.setPermissions(BigInt(r.permissions), 'Restore: update role permissions');
        await existingRole.edit({ color: r.color, hoist: r.hoist, mentionable: r.mentionable, position: r.position }, 'Restore: update role metadata');
      } catch (e) {
        console.error(`ロール ${r.name} の更新に失敗しました:`, e);
      }
    }
  }

  for (const r of backupData.roles) {
    const newRoleId = roleIdMap.get(r.id);
    if (newRoleId && r.members) {
      for (const memberId of r.members) {
        const member = existingMembers.get(memberId);
        if (member) {
          try {
            await member.roles.add(newRoleId, 'Restore: add role to member');
          } catch (e) {
            console.error(`メンバー ${member.user.tag} にロール ${r.name} を付与失敗:`, e);
          }
        }
      }
    }
  }

  const channelIdMap = new Map();
  const categories = backupData.channels.filter(c => c.type === ChannelType.GuildCategory);
  const otherChannels = backupData.channels.filter(c => c.type !== ChannelType.GuildCategory);

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

  for (const ch of otherChannels) {
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

  const channelPositions = backupData.channels.map(ch => ({ id: channelIdMap.get(ch.id), position: ch.position })).filter(c => c.id);
  await guild.channels.setPositions(channelPositions);

  try {
    if (backupData.meta?.name && guild.name !== backupData.meta.name) await guild.setName(backupData.meta.name, 'Restore: guild name');
    if (backupData.meta?.iconURL) await guild.setIcon(backupData.meta.iconURL, 'Restore: guild icon');
    await guild.setVerificationLevel(backupData.meta.verificationLevel, 'Restore: verification level');
    await guild.setExplicitContentFilter(backupData.meta.explicitContentFilter, 'Restore: explicit content filter');
    await guild.setDefaultMessageNotifications(backupData.meta.defaultMessageNotifications, 'Restore: default notifications');
    if (backupData.meta.systemChannelId) {
      await guild.setSystemChannel(guild.channels.cache.get(backupData.meta.systemChannelId), 'Restore: system channel');
    }
    if (backupData.meta.afkChannelId) {
      await guild.setAFKChannel(guild.channels.cache.get(backupData.meta.afkChannelId), 'Restore: AFK channel');
      await guild.setAFKTimeout(backupData.meta.afkTimeout, 'Restore: AFK timeout');
    }
    if (backupData.meta.bannerURL) {
      await guild.setBanner(backupData.meta.bannerURL, 'Restore: banner');
    }
    if (backupData.meta.splashURL) {
      await guild.setSplash(backupData.meta.splashURL, 'Restore: splash');
    }
  } catch (e) {
    console.error('サーバーメタデータの復元に失敗しました:', e);
  }

  const emojiIdMap = new Map();
  const stickersIdMap = new Map();
  for (const emoji of backupData.meta.emojis) {
    if (!guild.emojis.cache.has(emoji.id)) {
      try {
        const fetchedEmoji = await guild.emojis.create({
          attachment: `https://cdn.discordapp.com/emojis/${emoji.id}.png`,
          name: emoji.name,
        });
        emojiIdMap.set(emoji.id, fetchedEmoji.id);
        console.log(`✅ 絵文字 ${fetchedEmoji.name} を復元しました。`);
      } catch (e) {
        console.error(`❌ 絵文字 ${emoji.name} の復元に失敗しました:`, e);
      }
    } else {
      emojiIdMap.set(emoji.id, emoji.id);
    }
  }

  const stickers = backupData.meta.stickers;
  for (const sticker of stickers) {
    if (!guild.stickers.cache.has(sticker.id)) {
      // スタンプの復元は複雑で、直接URLから作成できない場合があるため、注意が必要です。
      console.warn(`⚠️ スタンプ ${sticker.name} は自動復元に対応していません。手動で復元してください。`);
    } else {
      stickersIdMap.set(sticker.id, sticker.id);
    }
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

/**
 * メッセージ削除
 * @param {TextChannel} channel 
 * @param {number} amount 削除件数
 * @param {TextChannel|null} feedbackChannel 
 * @param {GuildMember|null} targetUser 指定ユーザーのみ削除
 */
async function clearMessages(channel, amount, feedbackChannel = null, targetUser = null) {
  let messagesToDelete = amount;
  let lastMessageId = null;
  let deletedCount = 0;

  const now = Date.now();
  const twoWeeksAgo = now - (14 * 24 * 60 * 60 * 1000);

  while (messagesToDelete > 0) {
    const fetchLimit = Math.min(messagesToDelete, 100);
    const fetched = await channel.messages.fetch({ limit: fetchLimit, before: lastMessageId });
    if (fetched.size === 0) break;

    // ユーザー指定がある場合はフィルター
    let recentMessages = fetched.filter(msg => msg.createdTimestamp > twoWeeksAgo);
    if (targetUser) recentMessages = recentMessages.filter(msg => msg.author.id === targetUser.id);

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

  // 14日以上前のメッセージは個別削除
  if (messagesToDelete > 0) {
    const slowDeleteMsg = await (feedbackChannel?.send('⚠️ 14日以上前のメッセージは個別削除します...') || Promise.resolve(null));
    while (messagesToDelete > 0) {
      const fetched = await channel.messages.fetch({ limit: 100, before: lastMessageId });
      if (fetched.size === 0) break;

      let filtered = targetUser ? fetched.filter(m => m.author.id === targetUser.id) : fetched;

      for (const [id, msg] of filtered) {
        if (messagesToDelete <= 0) break;
        await msg.delete().catch(e => console.error(`Failed to delete message: ${e}`));
        deletedCount++;
        messagesToDelete--;
        await new Promise(r => setTimeout(r, 1000));
      }
      lastMessageId = fetched.last().id;
      if (slowDeleteMsg) slowDeleteMsg.edit(`🧹 ${deletedCount}件のメッセージを削除しました。`).catch(()=>{});
    }
  }

  return deletedCount;
}

/**
 * 指定したギルドの全メンバーにロールを付与する
 * - roleOrName は Role オブジェクト / ロールID / ロール名 のいずれかを受け取ります
 * - ボットアカウントはスキップされます
 * @param {Guild} guild 
 * @param {Role|string|object} roleOrName
 * @returns {Promise<{success: boolean, count?: number, error?: string}>}
 */
async function addRoleToAll(guild, roleOrName) {
  if (!guild) return { success: false, error: 'Guild が指定されていません。' };

  // roleOrName が Role オブジェクトならそのまま、それ以外は検索
  let role = null;
  if (roleOrName && typeof roleOrName === 'object' && roleOrName.id) {
    role = roleOrName;
  } else if (roleOrName != null) {
    const q = String(roleOrName).trim();
    role = guild.roles.cache.find(r => r.id === q || r.name === q || r.name.toLowerCase() === q.toLowerCase());
  }

  if (!role) {
    return { success: false, error: '指定されたロールが見つかりません。' };
  }

  let count = 0;
  try {
    const members = await guild.members.fetch();
    for (const member of members.values()) {
      try {
        // ボットは対象外
        if (member.user?.bot) continue;

        // 既にロールを持っている場合はスキップ
        if (member.roles.cache.has(role.id)) continue;

        // member にロールを付与（失敗しても処理は継続）
        await member.roles.add(role).catch(e => {
          console.error(`Failed to add role to ${member.user?.tag || member.id}:`, e);
        });

        count++;
        // 連続操作を抑制
        await delay(500);
      } catch (e) {
        // 個別メンバーで予期しないエラーが出ても続行
        console.error(`Error processing member ${member.user?.tag || member.id}:`, e);
      }
    }
    return { success: true, count: count };
  } catch (e) {
    console.error(`Error adding role to all members: ${e}`);
    return { success: false, error: e.message || String(e) };
  }
}

// サーバーのチャンネルを全削除してgeneralチャンネルのみ再作成
async function resetServerChannels(guild, feedbackChannel = null) {
  try {
    for (const channel of guild.channels.cache.values()) {
      await channel.delete("サーバーチャンネルリセット");
      await new Promise(r => setTimeout(r, 500)); // 負荷対策
    }
    await guild.channels.create({
      name: "general",
      type: ChannelType.GuildText,
      reason: "サーバーチャンネルリセット"
    });
    if (feedbackChannel) await feedbackChannel.send("✅ サーバーのチャンネルをリセットし、generalチャンネルを作成しました。");
  } catch (e) {
    console.error("resetServerChannels error:", e);
    if (feedbackChannel) feedbackChannel.send("❌ チャンネルリセット中にエラーが発生しました。").catch(()=>{});
  }
}

module.exports = {
  hasManageGuildPermission,
  backupServer,
  restoreServer,
  nukeChannel,
  clearMessages,
  addRoleToAll,
  resetServerChannels,
};