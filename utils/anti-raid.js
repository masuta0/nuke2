// utils/anti-raid.js

const { AuditLogEvent, PermissionsBitField } = require('discord.js');

// === 設定 ===
// 荒らしログを送信するチャンネルID
const LOG_CHANNEL_ID = '1405660583025709106';

// メンバー参加検知
const RAID_MEMBER_THRESHOLD = 3; // 3人
const RAID_TIME_WINDOW = 60 * 1000; // 1分

// 類似メッセージ検知
const SIMILAR_MESSAGE_THRESHOLD = 2; // 2回
const SIMILAR_MESSAGE_LENGTH = 5; // 5文字以上

// 連投検知
const MASS_SPAM_THRESHOLD = 2; // 2メッセージ
const MASS_SPAM_TIME_WINDOW = 3 * 1000; // 3秒

// 荒らしと判断される特定のキーワード
const RAID_KEYWORDS = [
  ' this server is raided',
  ' this server has been raided',
  ' reidされました',
  ' on top',
  ' discord.gg',
  ' invite.gg',
];

// 不審度スコアの設定
const RAID_SCORE_THRESHOLD = 20; // 総合スコアが20を超えたらタイムアウト
const RAID_SCORE_ACCOUNT_AGE = 15; // アカウント作成1日未満
const RAID_SCORE_MASS_JOIN = 10;    // メンバー大量参加時
const RAID_SCORE_KEYWORD = 15;      // NGキーワードを含む
const RAID_SCORE_SIMILAR = 10;      // 類似メッセージの連投
const RAID_SCORE_COMMAND_ABUSE = 5;  // コマンド乱用
const RAID_SCORE_REACTION_SPAM = 5;  // リアクション連打
const RAID_SCORE_EXCESSIVE_NEWLINES = 8; // 過度な改行
const RAID_SCORE_ZALGO = 10;         // Zalgo文字
const RAID_SCORE_MASS_SPAM = 10;     // メッセージ連投
const RAID_SCORE_WEBHOOK_ABUSE = 25; // ウェブフック乱用スコア
const RAID_SCORE_AUDIT_LOG_ABUSE = 30; // 監査ログ不審行動

// 処罰
const TIMEOUT_DURATION = 5 * 60 * 1000; // 5分間
const MARK_DURATION = 48 * 60 * 60 * 1000; // 48時間

// 危険な権限
const DANGEROUS_PERMISSIONS = [
  PermissionsBitField.Flags.Administrator,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.ManageGuild,
];

// === 内部変数 ===
const memberJoinLog = new Map();
const messageHistory = new Map();
const markedUsers = new Map();
const userScores = new Map();
const userCommandCounts = new Map();
const userReactionCounts = new Map();
const userMessageTimestamps = new Map();
const adminAbuseLog = new Map();

// === メンバー参加を監視 ===
function handleMemberJoin(member) {
  if (member.permissions.has('Administrator')) return;

  const now = Date.now();
  const guildId = member.guild.id;

  if (!memberJoinLog.has(guildId)) {
    memberJoinLog.set(guildId, []);
  }

  const joinArray = memberJoinLog.get(guildId);
  joinArray.push({ id: member.id, timestamp: now });

  const recentJoins = joinArray.filter(
    (join) => now - join.timestamp < RAID_TIME_WINDOW
  );

  if (recentJoins.length >= RAID_MEMBER_THRESHOLD) {
    const logChannel = member.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
      logChannel.send(
        `🚨 **Raid警告**: 過去1分間に${RAID_MEMBER_THRESHOLD}人以上のメンバーが参加しました。`
      ).catch(console.error);
    }
    recentJoins.forEach(join => {
      incrementScore(join.id, RAID_SCORE_MASS_JOIN, null, `大量参加 (${recentJoins.length}人)`);
    });
    memberJoinLog.set(guildId, recentJoins);
  }

  const accountAge = now - member.user.createdAt.getTime();
  if (accountAge < 24 * 60 * 60 * 1000) {
    incrementScore(member.id, RAID_SCORE_ACCOUNT_AGE, null, 'アカウント作成から24時間未満');
  }
}

// === 管理者の行動を監視 ===
async function handleAdminAbuse(guild, executor, actionType) {
    if (!executor || executor.bot) return;

    const now = Date.now();
    const abuseKey = `${guild.id}-${executor.id}`;

    if (!adminAbuseLog.has(abuseKey)) {
        adminAbuseLog.set(abuseKey, []);
    }

    const actionLog = adminAbuseLog.get(abuseKey);
    actionLog.push({ timestamp: now, type: actionType });

    const recentActions = actionLog.filter(action => now - action.timestamp < 5000); // 5秒間のアクション
    adminAbuseLog.set(abuseKey, recentActions);

    if (recentActions.length >= ADMIN_ABUSE_THRESHOLD) {
        const member = guild.members.cache.get(executor.id);
        if (member) {
            try {
                await member.roles.set([], '管理者の権限乱用');
                await member.ban({ reason: `管理者権限を乱用しました（${ADMIN_ABUSE_THRESHOLD}回以上の管理操作）` });

                await logRaidAction(
                    guild,
                    `🚨 **管理者権限乱用検知**: ${executor.tag} が悪意のある行動を繰り返し実行したため、権限を剥奪しBANしました。`,
                    'サーバーログ'
                );
            } catch (e) {
                console.error('管理者処罰に失敗しました:', e);
                await logRaidAction(
                    guild,
                    `⚠️ **緊急警告**: ${executor.tag} の管理者権限の乱用を検知しましたが、処罰に失敗しました。`
                );
            }
        }
    }
}


// === ロールの権限変更を監視する関数
async function handleRoleUpdate(oldRole, newRole) {
  if (oldRole.id !== oldRole.guild.id) return;

  const oldPermissions = oldRole.permissions;
  const newPermissions = newRole.permissions;

  const addedDangerousPermissions = DANGEROUS_PERMISSIONS.filter(
    perm => newPermissions.has(perm) && !oldPermissions.has(perm)
  );

  if (addedDangerousPermissions.length > 0) {
    try {
      const logs = await oldRole.guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 1 });
      const entry = logs.entries.first();
      const executor = entry?.executor;

      if (executor && !executor.bot && executor.id !== newRole.client.user.id) {
        const dangerousPerms = addedDangerousPermissions.map(p => PermissionsBitField.Flags[p]);
        const reason = `@everyoneロールに危険な権限(${dangerousPerms.join(', ')})を追加`;

        await oldRole.guild.members.ban(executor.id, { reason: reason });

        await newRole.setPermissions(oldPermissions, '危険な権限の自動削除');

        logRaidAction(
          oldRole.guild,
          `🚨 **緊急警告**: ${executor.tag} が @everyone ロールに危険な権限を追加しました。\n**${executor.tag}** をBANし、権限を元に戻しました。\n追加された権限: ${dangerousPerms.join(', ')}`,
          'サーバーログ'
        );
      }
    } catch (e) {
      console.error('ロール更新監視中にエラーが発生しました:', e);
    }
  }
}

// === スコア加算と処罰の実行 ===
async function incrementScore(userId, score, message = null, reason = '不審な行動') {
    const member = message?.member || await message.guild.members.fetch(userId).catch(() => null);
    if (!member || member.permissions.has('Administrator')) return;

    const currentScore = userScores.get(userId) || 0;
    const newScore = currentScore + score;
    userScores.set(userId, newScore);

    if (message && message.deletable) {
      const messageContent = message.content.length > 200 ? message.content.substring(0, 197) + '...' : message.content;
      try {
        await message.delete();
        logRaidAction(
          member.guild,
          `🚨 **不審メッセージ検知**: ${member.user.tag} が不審なメッセージを投稿しました。\n理由: ${reason} (+${score}点)\n現在のスコア: ${newScore}\n\n**メッセージ内容:**\n\`\`\`\n${messageContent}\n\`\`\``,
          message?.channel.name || '不明なチャンネル'
        );
      } catch (e) {
        console.error('メッセージの削除に失敗しました:', e);
      }
    } else {
      logRaidAction(
        member.guild,
        `🚨 **不審行動検知**: ${member.user.tag} が不審な行動を行いました。\n理由: ${reason} (+${score}点)\n現在のスコア: ${newScore}`,
        message?.channel.name || '不明なチャンネル'
      );
    }

    if (newScore >= RAID_SCORE_THRESHOLD) {
        if (markedUsers.has(userId)) {
            logRaidAction(
              member.guild,
              `⚠️ **再処罰**: ${member.user.tag} の不審度スコアが再度閾値を超えました。\n最終スコア: ${newScore}\n\n⚠️ スコアをリセットし、タイムアウトを再適用します。`,
              message?.channel.name || '不明なチャンネル'
            );
            userScores.set(userId, 10);
            try {
                await member.timeout(TIMEOUT_DURATION, reason);
            } catch (e) {
                console.error('タイムアウト再適用に失敗しました:', e);
            }
            return;
        }

        try {
            await member.timeout(TIMEOUT_DURATION, reason);
            if (message) {
              message.channel.send(`🚨 **${member.user.tag}** は不審な行動を複数回行ったため、5分間タイムアウトされました。`).catch(console.error);
            }
            logRaidAction(
              member.guild,
              `⚠️ **最終処罰**: ${member.user.tag} の不審度スコアが閾値(${RAID_SCORE_THRESHOLD})を超過しました。\n理由: ${reason}\n最終スコア: ${newScore}\n\n⚠️ スコアをリセットします。`,
              message?.channel.name || '不明なチャンネル'
            );

            userScores.set(userId, 10);
            markUser(userId);
        } catch (e) {
            console.error('タイムアウト処理に失敗しました:', e);
        }
    }
}

// === メッセージを監視 ===
async function handleMessage(message) {
  if (message.author.bot && !message.webhookId) {
    return;
  }
  if (!message.webhookId && message.member && message.member.permissions.has('Administrator')) {
      return;
  }

  const now = Date.now();
  const authorId = message.author.id;

  const messageTimestamps = userMessageTimestamps.get(authorId) || [];
  messageTimestamps.push(now);
  const recentMessages = messageTimestamps.filter(
    (timestamp) => now - timestamp < MASS_SPAM_TIME_WINDOW
  );
  userMessageTimestamps.set(authorId, recentMessages);

  if (recentMessages.length >= MASS_SPAM_THRESHOLD) {
    incrementScore(authorId, RAID_SCORE_MASS_SPAM, message, 'メッセージ連投');
    return;
  }

  const content = message.content.toLowerCase();

  const isRaidMessage = RAID_KEYWORDS.some(keyword => content.includes(keyword));
  if (isRaidMessage) {
    if (message.webhookId) {
        const logs = await message.guild.fetchAuditLogs({ type: AuditLogEvent.WEBHOOK_CREATE, limit: 10 });
        const entry = logs.entries.find(e => e.target.id === message.webhookId);
        if (entry && !entry.executor.bot) {
            incrementScore(entry.executor.id, RAID_SCORE_WEBHOOK_ABUSE, null, 'ウェブフックを使った荒らし');
            await message.webhook.delete('ウェブフックを使った荒らしを検知');
            return;
        }
    }
    incrementScore(authorId, RAID_SCORE_KEYWORD, message, 'NGキーワードを含むメッセージ');
    return;
  }

  const newlineCount = (message.content.match(/\n/g) || []).length;
  if (newlineCount > 10) {
    incrementScore(authorId, RAID_SCORE_EXCESSIVE_NEWLINES, message, '過度な改行');
    return;
  }

  const zalgoCount = (message.content.match(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g) || []).length;
  if (zalgoCount > 5) {
      incrementScore(authorId, RAID_SCORE_ZALGO, message, 'Zalgo文字の乱用');
      return;
  }

  const guildId = message.guild.id;
  const normalizedContent = content.replace(/\s/g, '');

  if (normalizedContent.length < SIMILAR_MESSAGE_LENGTH) return;

  if (!messageHistory.has(guildId)) {
    messageHistory.set(guildId, new Map());
  }

  const guildHistory = messageHistory.get(guildId);
  if (!guildHistory.has(normalizedContent)) {
    guildHistory.set(normalizedContent, new Map());
  }

  const msgSenders = guildHistory.get(normalizedContent);
  if (!msgSenders.has(authorId)) {
    msgSenders.set(authorId, 0);
  }
  msgSenders.set(authorId, msgSenders.get(authorId) + 1);

  const sendCount = msgSenders.get(authorId);
  if (sendCount >= SIMILAR_MESSAGE_THRESHOLD) {
    incrementScore(authorId, RAID_SCORE_SIMILAR, message, '類似メッセージの連投');
    return;
  }

  if (message.content.startsWith('!')) {
    const lastCmdTime = userCommandCounts.get(authorId) || 0;
    if (now - lastCmdTime < 2000) {
      incrementScore(authorId, RAID_SCORE_COMMAND_ABUSE, message, 'ボットコマンドの連打');
      return;
    }
    userCommandCounts.set(authorId, now);
  }
}

// === リアクションを監視 ===
async function handleReactionAdd(reaction, user) {
    if (user.bot) return;

    const member = reaction.message.guild.members.cache.get(user.id);
    if (!member || member.permissions.has('Administrator')) return;

    const now = Date.now();
    const lastReactionTime = userReactionCounts.get(user.id) || 0;
    if (now - lastReactionTime < 1000) {
        incrementScore(user.id, RAID_SCORE_REACTION_SPAM, { member: member, channel: reaction.message.channel, guild: reaction.message.guild }, '過度なリアクション連打');
        return;
    }
    userReactionCounts.set(user.id, now);
}

// === ユーザーをマーク ===
function markUser(userId) {
  const now = Date.now();
  markedUsers.set(userId, now);
  setTimeout(() => {
    markedUsers.delete(userId);
    userScores.delete(userId);
    userCommandCounts.delete(userId);
    userReactionCounts.delete(userId);
    userMessageTimestamps.delete(userId);
    console.log(`✅ ユーザー ${userId} のマークを解除しました。`);
  }, MARK_DURATION);
}

// === ログを送信 ===
async function logRaidAction(guild, message, channelName) {
  const logChannel = await getOrCreateLogChannel(guild);
  if (logChannel) {
    await logChannel.send(`${message}\n\n**チャンネル:** #${channelName}`).catch(console.error);
  }
}

// === ログチャンネルの取得と作成 ===
async function getOrCreateLogChannel(guild) {
    let logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) {
        try {
            logChannel = await guild.channels.create({
                name: 'bot-logs',
                type: 0,
                reason: '荒らし対策ログチャンネルが削除されたため再作成',
            });
        } catch (e) {
            console.error('❌ ログチャンネルの作成に失敗しました:', e);
            return null;
        }
    }
    return logChannel;
}

module.exports = {
  handleMemberJoin,
  handleMessage,
  handleReactionAdd,
  handleRoleUpdate,
};
