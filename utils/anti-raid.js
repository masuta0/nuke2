// utils/anti-raid.js

const { AuditLogEvent } = require('discord.js');

// === 設定 ===
// 荒らしログを送信するチャンネルID
const LOG_CHANNEL_ID = '1405660583025709106';

// メンバー参加検知
const RAID_MEMBER_THRESHOLD = 3; // 3人
const RAID_TIME_WINDOW = 60 * 1000; // 1分

// 類似メッセージ検知
const SIMILAR_MESSAGE_THRESHOLD = 2; // 2回
const SIMILAR_MESSAGE_LENGTH = 5; // 5文字以上

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
const RAID_SCORE_COMMAND_ABUSE = 5;  // ★ 新規: コマンド乱用
const RAID_SCORE_REACTION_SPAM = 5;  // ★ 新規: リアクション連打
const RAID_SCORE_EXCESSIVE_NEWLINES = 8; // ★ 新規: 過度な改行
const RAID_SCORE_ZALGO = 10;         // ★ 新規: Zalgo文字

// 処罰
const TIMEOUT_DURATION = 10 * 60 * 1000; // 10分
const MARK_DURATION = 48 * 60 * 60 * 1000; // 48時間

// === 内部変数 ===
const memberJoinLog = new Map();
const messageHistory = new Map();
const markedUsers = new Map();
const userScores = new Map();
const userCommandCounts = new Map(); // ★ 新規: コマンド乱用監視用
const userReactionCounts = new Map(); // ★ 新規: リアクション監視用
const userMessageTimestamps = new Map(); // ★ 新規: 連投監視用

// === メンバー参加を監視 ===
function handleMemberJoin(member) {
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
  if (accountAge < 24 * 60 * 60 * 1000) { // 24時間未満
    incrementScore(member.id, RAID_SCORE_ACCOUNT_AGE, null, 'アカウント作成から24時間未満');
  }
}

// === スコア加算と処罰の実行 ===
async function incrementScore(userId, score, message = null, reason = '不審な行動') {
    const newScore = (userScores.get(userId) || 0) + score;
    userScores.set(userId, newScore);

    if (newScore >= RAID_SCORE_THRESHOLD) {
        if (markedUsers.has(userId)) return;

        const member = message?.member || await message.guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        try {
            await member.timeout(TIMEOUT_DURATION, reason);
            if (message) {
              await message.delete();
              message.channel.send(`🚨 **${member.user.tag}** は不審な行動を複数回行ったため、10分間タイムアウトされました。`).catch(console.error);
            }
            await logRaidAction(
              member.guild,
              `🚨 **不審者検知**: ${member.user.tag} の不審度スコアが閾値(${RAID_SCORE_THRESHOLD})を超過しました。\n理由: ${reason}\n現在のスコア: ${newScore}`,
              message?.channel.name || '不明なチャンネル'
            );
            markUser(userId);
        } catch (e) {
            console.error('タイムアウト処理に失敗しました:', e);
        }
    }
}

// === メッセージを監視 ===
async function handleMessage(message) {
  if (message.author.bot || markedUsers.has(message.author.id)) {
    return;
  }

  const content = message.content.toLowerCase();

  // 1. NGキーワードによる検知
  const isRaidMessage = RAID_KEYWORDS.some(keyword => content.includes(keyword));
  if (isRaidMessage) {
    incrementScore(message.author.id, RAID_SCORE_KEYWORD, message, 'NGキーワードを含むメッセージ');
    return;
  }

  // 2. 過度な改行による検知
  const newlineCount = (message.content.match(/\n/g) || []).length;
  if (newlineCount > 10) {
    incrementScore(message.author.id, RAID_SCORE_EXCESSIVE_NEWLINES, message, '過度な改行');
    return;
  }

  // 3. Zalgo文字の乱用検知 (Unicodeの特定の範囲をチェック)
  const zalgoCount = (message.content.match(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g) || []).length;
  if (zalgoCount > 5) {
      incrementScore(message.author.id, RAID_SCORE_ZALGO, message, 'Zalgo文字の乱用');
      return;
  }

  // 4. 類似メッセージによる検知
  const guildId = message.guild.id;
  const authorId = message.author.id;
  const normalizedContent = content.replace(/\s/g, '');

  if (normalizedContent.length < SIMILAR_MESSAGE_LENGTH) return;

  if (!messageHistory.has(guildId)) {
    messageHistory.set(guildId, new Map());
  }

  const guildHistory = messageHistory.get(normalizedContent);
  if (!guildHistory) {
    guildHistory.set(normalizedContent, new Map());
    guildHistory.get(normalizedContent).set(authorId, 1);
  } else {
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
  }

  // 5. ボットコマンドの連打検知
  if (message.content.startsWith('!')) {
    const now = Date.now();
    const lastCmdTime = userCommandCounts.get(authorId) || 0;
    if (now - lastCmdTime < 2000) { // 2秒以内に再度コマンド
      incrementScore(authorId, RAID_SCORE_COMMAND_ABUSE, message, 'ボットコマンドの連打');
      return;
    }
    userCommandCounts.set(authorId, now);
  }
}

// === リアクションを監視 ===
async function handleReactionAdd(reaction, user) {
    if (user.bot || markedUsers.has(user.id)) return;

    const now = Date.now();
    const lastReactionTime = userReactionCounts.get(user.id) || 0;
    if (now - lastReactionTime < 1000) { // 1秒以内に再度リアクション
        const message = reaction.message;
        const member = message.guild.members.cache.get(user.id);
        incrementScore(user.id, RAID_SCORE_REACTION_SPAM, { member: member, channel: message.channel, guild: message.guild }, '過度なリアクション連打');
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
  handleReactionAdd, // ★ エクスポート
  LOG_CHANNEL_ID,
};
