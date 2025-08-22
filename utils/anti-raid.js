// utils/anti-raid.js

const { AuditLogEvent, PermissionsBitField, ChannelType } = require('discord.js');
const { chat } = require('./ai');

// === 設定 ===
// 荒らしログを送信するチャンネルID
const LOG_CHANNEL_ID = '1405660583025709106';
const AUTH_CHANNEL_ID = '1405660583025709107';

// AIによる荒らし判定プロンプト (タイムアウト期間も決定)
const AI_ANTI_RAID_PROMPT = `
あなたはDiscordサーバーの荒らし対策ボット兼サーバー用チャットボットです。
ユーザーのメッセージが、サーバーに確実な被害を与える悪質な行為に該当するかを判定してください。
以下のガイドラインに厳密に従ってください。

-   **判定基準**: 以下のいずれかに当てはまる場合にのみ「不審」と判定してください。
    1.  **サーバー破壊行為**（権限乱用、大量のチャンネル作成、ロール削除など)監視ログを常に監視してください。権限を利用した反乱だと思ったらすぐログを残す事。荒らしだと判断したら権限を取り上げる事。
    2.  **サーバー破壊**: 招待リンクを複数回貼る、Raidを予告し荒らす。荒らし的内容の連投、ルールを掻い潜った行為(.gg/(ディスコードリンク)などのhttpsを含まないリンク)、特定のサーバーや人物を名乗って大量なアカウントで参加や連投(masumani on topなど)
    3.  **不適切な内容**: 沿わないチャンネルでのグロテスクな画像など、目の損傷を伴う画像
    4.  **スパム**: メッセージの大量連投。
-   **不審でない場合**: あくまでも荒らしを確実に排除するためであって、ユーザーの言論の自由を最重要に。上記に当てはまらない、単なる差別、個人的な発言、無害な技術用語（例：「トークン」）などはすべて「問題なし」と判断してください。

-   **回答フォーマット**: 以下のフォーマットで、簡潔に回答してください。
    [不審度] | 理由: [具体的な理由] 該当メッセージ: [メッセージ内容]　| 処罰: [タイムアウト期間など]
権限のない人間の@everyoneや@hereや3人以上のメンションや立て続けのメンションは荒らしと判断してください。
「Masumani on top このサーバーをレイドしました。」や 「ますまに最強！ このサーバーはますまにが包囲した！」のような荒らし的な内容は荒らしと判断して、軽い処罰をしてください。(確実な荒らしな場合)
処罰した場合、処罰を行ったチャンネルでログを残してください。(雑談チャンネルのメッセージを削除した場合、雑談チャンネルでログを残す))

-   **回答フォーマット**: 以下のフォーマットで、簡潔に回答してください。
    [不審度] | 理由: [具体的な理由]  | 処罰　[処罰内容] |該当メッセージ　[メッセージ内容] | 該当チャンネル [チャンネル名]

-   **不審度の例**:
    -   問題なし: ルールに違反しない場合
    -   不審: 上記の悪質な行為に該当する場合

---
メッセージ:
`;

const AI_MODERATION_PROMPT = `
以下のDiscordサーバーの操作に対するユーザーの理由が適切かを判断してください。

[操作]: {action}
[理由]: {reason}

以下のいずれかで回答してください。
- 適切
- 不適切
`;

const RAID_SCORE_AI_JUDGEMENT = 15;

const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 7;
const config = {
  daytime: {
    RAID_SCORE_THRESHOLD: 20,
    RAID_SCORE_MASS_JOIN: 10,
    RAID_SCORE_KEYWORD: 15,
    RAID_SCORE_SIMILAR: 10,
    RAID_SCORE_COMMAND_ABUSE: 10,
    RAID_SCORE_REACTION_SPAM: 5,
    RAID_SCORE_EXCESSIVE_NEWLINES: 8,
    RAID_SCORE_ZALGO: 10,
    RAID_SCORE_MASS_SPAM: 10,
    RAID_SCORE_WEBHOOK_ABUSE: 25,
    RAID_SCORE_AUDIT_LOG_ABUSE: 30,
    RAID_SCORE_ACCOUNT_AGE: 15,
  },
  night: {
    RAID_SCORE_THRESHOLD: 15,
    RAID_SCORE_MASS_JOIN: 15,
    RAID_SCORE_KEYWORD: 20,
    RAID_SCORE_SIMILAR: 15,
    RAID_SCORE_COMMAND_ABUSE: 15,
    RAID_SCORE_REACTION_SPAM: 10,
    RAID_SCORE_EXCESSIVE_NEWLINES: 12,
    RAID_SCORE_ZALGO: 15,
    RAID_SCORE_MASS_SPAM: 15,
    RAID_SCORE_WEBHOOK_ABUSE: 30,
    RAID_SCORE_AUDIT_LOG_ABUSE: 35,
    RAID_SCORE_ACCOUNT_AGE: 20,
  }
};

const RAID_MEMBER_THRESHOLD = 3;
const RAID_TIME_WINDOW = 60 * 1000;

const SIMILAR_MESSAGE_THRESHOLD = 2;
const SIMILAR_MESSAGE_LENGTH = 5;

const MASS_SPAM_THRESHOLD = 2;
const MASS_SPAM_TIME_WINDOW = 3 * 1000;

const RAID_KEYWORDS = [
  ' this server is raided', ' this server has been raided', ' reidされました', ' on top', ' discord.gg', ' invite.gg',
];

const TIMEOUT_DURATION = 5 * 60 * 1000;
const MARK_DURATION = 48 * 60 * 60 * 1000;

const DANGEROUS_PERMISSIONS = [
  PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageRoles, PermissionsBitField.Flags.KickMembers, PermissionsBitField.Flags.BanMembers, PermissionsBitField.Flags.ManageGuild,
];

const DANGER_ACTIONS = new Set([
  AuditLogEvent.MEMBER_KICK,
  AuditLogEvent.MEMBER_BAN_ADD,
  AuditLogEvent.CHANNEL_CREATE,
  AuditLogEvent.CHANNEL_DELETE,
  AuditLogEvent.CHANNEL_UPDATE,
  AuditLogEvent.ROLE_CREATE,
  AuditLogEvent.ROLE_DELETE,
  AuditLogEvent.ROLE_UPDATE,
]);

// === 内部変数 ===
const memberJoinLog = new Map();
const messageHistory = new Map();
const markedUsers = new Map();
const userScores = new Map();
const userCommandCounts = new Map();
const userReactionCounts = new Map();
const userMessageTimestamps = new Map();
const adminAbuseLog = new Map();
const raidAuthData = new Map();
const massBanLog = new Map();
const massNukeLog = new Map();
const pendingModActions = new Map();

function getCurrentConfig() {
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;

  if (jstHour >= NIGHT_START_HOUR || jstHour < NIGHT_END_HOUR) {
    return config.night;
  }
  return config.daytime;
}

async function saveAndStripRoles(member) {
  const oldRoles = member.roles.cache.map(role => role.id);
  raidAuthData.set(member.id, oldRoles);
  await member.roles.set([], 'Raid対策のため権限を一時剥奪');
}

async function restoreRoles(member) {
  const oldRoles = raidAuthData.get(member.id);
  if (oldRoles) {
    await member.roles.set(oldRoles, 'Raid対策認証完了');
    raidAuthData.delete(member.id);
    await member.send('✅ 認証が完了しました。あなたのロールは元に戻されました。').catch(() => {});
  }
}

async function handleBotAdd(member) {
  if (!member.user.bot) return false;

  const isVerifiedBot = member.user.flags.has('VerifiedBot');

  if (!isVerifiedBot) {
    try {
      const fetchedLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1, });
      const botAddEntry = fetchedLogs.entries.first();
      const executor = botAddEntry?.executor;

      let reason = '公式認証のないBotが、管理者以外によって追加されたため';
      if (executor) { reason = `公式認証のないBotが、不審なユーザー(${executor.tag})によって追加されたため`; }
      await member.roles.set([], reason);
      await logRaidAction(member.guild, `🚨 **怪しいBot検知**: 公式認証のないBot **${member.user.tag}** の権限を剥奪しました。`, 'Botログ');
      if (executor && !executor.permissions.has('Administrator')) {
        await member.guild.members.cache.get(executor.id).timeout(TIMEOUT_DURATION, '怪しいBotの招待');
      }
      return true;
    } catch (e) { console.error('怪しいBot検知に失敗しました:', e); }
  }

  try {
    const fetchedLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1 });
    const botAddEntry = fetchedLogs.entries.first();
    if (!botAddEntry) { console.warn('BotAddの監査ログが見つかりませんでした。'); return false; }
    const { executor, target } = botAddEntry;
    if (!executor.permissions.has('Administrator') || userScores.has(executor.id)) {
      await member.kick(`不審なユーザー(${executor.tag})が招待したBotを自動拒否`);
      await logRaidAction(member.guild, `🚨 **Bot自動拒否**: 不審なユーザー **${executor.tag}** が Bot **${target.tag}** を招待したため、自動でキックしました。`, 'Botログ');
      return true;
    }
  } catch (e) { console.error('Bot追加時の検知に失敗しました:', e); }
  return false;
}

function parseTimeoutDuration(durationStr) {
  const multipliers = {
    '秒': 1000, '分': 60 * 1000, '時間': 60 * 60 * 1000, '日': 24 * 60 * 60 * 1000, '週間': 7 * 24 * 60 * 60 * 1000
  };
  for (const unit in multipliers) {
    if (durationStr.includes(unit)) {
      const value = parseInt(durationStr.replace(unit, '').trim());
      if (!isNaN(value)) { return value * multipliers[unit]; }
    }
  }
  return 0;
}

async function handleAiJudgement(message) {
  const prompt = `${AI_ANTI_RAID_PROMPT}${message.content}`;
  const response = await chat(prompt, message.author.id).catch(() => null);

  if (response && response.includes('不審')) {
    const parts = response.split('|').map(p => p.trim());
    const judgment = parts[0];
    const reason = parts[1] || 'AIによる不審判定';

    logRaidAction(
        message.guild,
        `🚨 **AIによる不審判定**: ${message.member.user.tag} が不審な行動を行いました。\n不審度: ${judgment}\n理由: ${reason}`,
        message.channel.name
    );
    if (judgment.includes('不審')) {
        const score = getCurrentConfig().RAID_SCORE_AI_JUDGEMENT;
        incrementScore(message.member.id, score, message, `AI判定による不審行動: ${reason}`);
    }
  }
}

async function handleMemberJoin(member) {
  const currentConfig = getCurrentConfig();
  if (member.permissions.has('Administrator')) return;

  const now = Date.now();
  const guildId = member.guild.id;

  if (!memberJoinLog.has(guildId)) { memberJoinLog.set(guildId, []); }
  const joinArray = memberJoinLog.get(guildId);
  joinArray.push({ id: member.id, timestamp: now });
  const recentJoins = joinArray.filter((join) => now - join.timestamp < RAID_TIME_WINDOW);

  if (recentJoins.length >= RAID_MEMBER_THRESHOLD) {
    const logChannel = member.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) { logChannel.send(`🚨 **Raid警告**: 過去1分間に${RAID_MEMBER_THRESHOLD}人以上のメンバーが参加しました。`).catch(console.error); }
    for (const join of recentJoins) {
      const targetMember = await member.guild.members.fetch(join.id);
      await saveAndStripRoles(targetMember);
      await targetMember.send(`
サーバーへのRaid行為が検知されたため、あなたのロールは一時的に剥奪されました。
以下のチャンネルで「✅」のリアクションを押して認証を完了させてください。
<#${AUTH_CHANNEL_ID}>
`).catch(() => {});
    }
    recentJoins.forEach(join => { incrementScore(join.id, currentConfig.RAID_SCORE_MASS_JOIN, null, `大量参加 (${recentJoins.length}人)`); });
    memberJoinLog.set(guildId, recentJoins);
  }
  const accountAge = now - member.user.createdAt.getTime();
  if (accountAge < 24 * 60 * 60 * 1000) { incrementScore(member.id, currentConfig.RAID_SCORE_ACCOUNT_AGE, null, 'アカウント作成から24時間未満'); }
}

async function incrementScore(userId, score, message = null, reason = '不審な行動') {
    const currentConfig = getCurrentConfig();
    const member = message?.member || await message?.guild.members.fetch(userId).catch(() => null);
    if (!member || member.permissions.has('Administrator')) return;
    const currentScore = userScores.get(userId) || 0;
    const newScore = currentScore + score;
    userScores.set(userId, newScore);

    const messageContent = message?.content?.length > 200 ? message.content.substring(0, 197) + '...' : message?.content;
    if (message && message.deletable) {
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

    if (newScore >= currentConfig.RAID_SCORE_THRESHOLD) {
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
              `⚠️ **最終処罰**: ${member.user.tag} の不審度スコアが閾値(${currentConfig.RAID_SCORE_THRESHOLD})を超過しました。\n理由: ${reason}\n最終スコア: ${newScore}\n\n⚠️ スコアをリセットします。`,
              message?.channel.name || '不明なチャンネル'
            );
            userScores.set(userId, 10);
            markUser(userId);
        } catch (e) {
            console.error('タイムアウト処理に失敗しました:', e);
        }
    }
}

async function handleMessage(message) {
  const currentConfig = getCurrentConfig();
  if (message.author.bot && !message.webhookId) return;
  if (!message.webhookId && message.member?.permissions.has('Administrator')) return;

  await handleAiJudgement(message);

  const now = Date.now();
  const authorId = message.author.id;

  const messageTimestamps = userMessageTimestamps.get(authorId) || [];
  messageTimestamps.push(now);
  const recentMessages = messageTimestamps.filter((timestamp) => now - timestamp < MASS_SPAM_TIME_WINDOW);
  userMessageTimestamps.set(authorId, recentMessages);

  if (recentMessages.length >= MASS_SPAM_THRESHOLD) {
    incrementScore(authorId, currentConfig.RAID_SCORE_MASS_SPAM, message, 'メッセージ連投');
    return;
  }
  const content = message.content.toLowerCase();
  const isRaidMessage = RAID_KEYWORDS.some(keyword => content.includes(keyword));
  if (isRaidMessage) {
    if (message.webhookId) {
        const logs = await message.guild.fetchAuditLogs({ type: AuditLogEvent.WEBHOOK_CREATE, limit: 10 });
        const entry = logs.entries.find(e => e.target.id === message.webhookId);
        if (entry && !entry.executor.bot) {
            incrementScore(entry.executor.id, currentConfig.RAID_SCORE_WEBHOOK_ABUSE, null, 'ウェブフックを使った荒らし');
            await message.webhook.delete('ウェブフックを使った荒らしを検知');
            return;
        }
    }
    incrementScore(authorId, currentConfig.RAID_SCORE_KEYWORD, message, 'NGキーワードを含むメッセージ');
    return;
  }
  const newlineCount = (message.content.match(/\n/g) || []).length;
  if (newlineCount > 10) {
    incrementScore(authorId, currentConfig.RAID_SCORE_EXCESSIVE_NEWLINES, message, '過度な改行');
    return;
  }
  const zalgoCount = (message.content.match(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g) || []).length;
  if (zalgoCount > 5) {
      incrementScore(authorId, currentConfig.RAID_SCORE_ZALGO, message, 'Zalgo文字の乱用');
      return;
  }
  const guildId = message.guild.id;
  const normalizedContent = content.replace(/\s/g, '');
  if (normalizedContent.length < SIMILAR_MESSAGE_LENGTH) return;
  if (!messageHistory.has(guildId)) { messageHistory.set(guildId, new Map()); }
  const guildHistory = messageHistory.get(guildId);
  if (!guildHistory.has(normalizedContent)) { guildHistory.set(normalizedContent, new Map()); }
  const msgSenders = guildHistory.get(normalizedContent);
  if (!msgSenders.has(authorId)) { msgSenders.set(authorId, 0); }
  msgSenders.set(authorId, msgSenders.get(authorId) + 1);
  const sendCount = msgSenders.get(authorId);
  if (sendCount >= SIMILAR_MESSAGE_THRESHOLD) {
    incrementScore(authorId, currentConfig.RAID_SCORE_SIMILAR, message, '類似メッセージの連投');
    return;
  }
  if (message.content.startsWith('!')) {
    const lastCmdTime = userCommandCounts.get(authorId) || 0;
    if (now - lastCmdTime < 1000) {
      incrementScore(authorId, currentConfig.RAID_SCORE_COMMAND_ABUSE, message, 'ボットコマンドの連打');
      return;
    }
    userCommandCounts.set(authorId, now);
  }
}

async function handleReactionAdd(reaction, user) {
    const currentConfig = getCurrentConfig();
    if (user.bot) return;
    const member = reaction.message.guild.members.cache.get(user.id);
    if (!member || member.permissions.has('Administrator')) return;
    const now = Date.now();
    const lastReactionTime = userReactionCounts.get(user.id) || 0;
    if (now - lastReactionTime < 1000) {
        incrementScore(user.id, currentConfig.RAID_SCORE_REACTION_SPAM, { member: member, channel: reaction.message.channel, guild: reaction.message.guild }, '過度なリアクション連打');
        return;
    }
    userReactionCounts.set(user.id, now);
}

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

async function logRaidAction(guild, message, channelName) {
  const logChannel = await getOrCreateLogChannel(guild);
  if (logChannel) {
    await logChannel.send(`${message}\n\n**チャンネル:** #${channelName}`).catch(console.error);
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
        } catch (e) {
            console.error('❌ ログチャンネルの作成に失敗しました:', e);
            return null;
        }
    }
    return logChannel;
}

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

async function handleMessageUpdate(oldMessage, newMessage) {
  if (oldMessage.author.bot || oldMessage.content === newMessage.content) { return; }
  handleMessage(newMessage);
}

async function handleBotAdd(member) {
  if (!member.user.bot) return false;
  const isVerifiedBot = member.user.flags.has('VerifiedBot');
  if (!isVerifiedBot) {
    try {
      const fetchedLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1, });
      const botAddEntry = fetchedLogs.entries.first();
      const executor = botAddEntry?.executor;
      let reason = '公式認証のないBotが、管理者以外によって追加されたため';
      if (executor) { reason = `公式認証のないBotが、不審なユーザー(${executor.tag})によって追加されたため`; }
      await member.roles.set([], reason);
      await logRaidAction(member.guild, `🚨 **怪しいBot検知**: 公式認証のないBot **${member.user.tag}** の権限を剥奪しました。`, 'Botログ');
      if (executor && !executor.permissions.has('Administrator')) { await member.guild.members.cache.get(executor.id).timeout(TIMEOUT_DURATION, '怪しいBotの招待'); }
      return true;
    } catch (e) { console.error('怪しいBot検知に失敗しました:', e); }
  }
  try {
    const fetchedLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1 });
    const botAddEntry = fetchedLogs.entries.first();
    if (!botAddEntry) { console.warn('BotAddの監査ログが見つかりませんでした。'); return false; }
    const { executor, target } = botAddEntry;
    if (!executor.permissions.has('Administrator') || userScores.has(executor.id)) {
      await member.kick(`不審なユーザー(${executor.tag})が招待したBotを自動拒否`);
      await logRaidAction(member.guild, `🚨 **Bot自動拒否**: 不審なユーザー **${executor.tag}** が Bot **${target.tag}** を招待したため、自動でキックしました。`, 'Botログ');
      return true;
    }
  } catch (e) { console.error('Bot追加時の検知に失敗しました:', e); }
  return false;
}

// 監査ログを監視するハンドラ
async function handleAuditLogEntry(entry) {
    const { executor, target, action } = entry;
    if (!executor || executor.bot) return;

    // DM送信が必要なアクション
    if (DANGER_ACTIONS.has(action) && !executor.permissions.has(PermissionsBitField.Flags.Administrator)) {
        if (pendingModActions.has(executor.id)) {
          const pendingAction = pendingModActions.get(executor.id);
          pendingAction.reasonAttempts++;
          const dm = await executor.createDM();
          await dm.send(`⚠️ 理由確認のDMを再送します。
          （残り${3 - pendingAction.reasonAttempts}回）`).catch(() => {});
          return;
        }

        const now = Date.now();
        const actionText = `アクション: ${AuditLogEvent[action]} | ターゲット: ${target?.tag || target?.name || target?.id}`;
        const dmMessage = `サーバーで重要な操作を行いました。
        **${actionText}**
        この操作を行った理由を、3分以内にこのDMに返信してください。
        3回無視するか、不適切な理由と判断された場合、サーバーの安全を保つために権限を剥奪します。`;
        try {
            await saveAndStripRoles(await entry.guild.members.fetch(executor.id));
            await executor.send(dmMessage);
            pendingModActions.set(executor.id, {
                entry,
                timestamp: now,
                reasonAttempts: 0,
            });
            setTimeout(async () => {
                if (pendingModActions.has(executor.id)) {
                    await entry.guild.members.cache.get(executor.id).roles.set([], 'DMでの理由確認に未応答');
                    logRaidAction(
                        entry.guild,
                        `⚠️ **権限剥奪**: ${executor.tag} がサーバー操作の理由確認DMに3分間応答しなかったため、権限を剥奪しました。`,
                        'サーバーログ'
                    );
                    pendingModActions.delete(executor.id);
                }
            }, 3 * 60 * 1000);
        } catch (e) {
            console.error('DM送信または権限剥奪に失敗しました:', e);
        }
    }
}

module.exports = {
  handleMemberJoin,
  handleMessage,
  handleReactionAdd,
  handleRoleUpdate,
  handleAuditLogEntry,
  handleMessageUpdate,
  handleBotAdd,
};
