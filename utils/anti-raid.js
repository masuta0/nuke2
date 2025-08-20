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

// 荒らしと判断された場合の処置
const TIMEOUT_DURATION = 10 * 60 * 1000; // 10分
const MARK_DURATION = 48 * 60 * 60 * 1000; // 48時間

// 荒らしと判断される特定のキーワード
const RAID_KEYWORDS = [
  ' this server is raided',
  ' this server has been raided',
  ' reidされました',
  ' on top',
  ' discord.gg',
  ' invite.gg',
];

// === 内部変数 ===
const memberJoinLog = new Map();
const messageHistory = new Map();
const markedUsers = new Map();

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
    memberJoinLog.set(guildId, recentJoins);
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
    try {
      await message.member.timeout(TIMEOUT_DURATION, '荒らしメッセージの送信');
      await message.delete();
      message.channel.send(`🚨 **${message.author.tag}** は荒らしメッセージを送信したため、10分間タイムアウトされました。`).catch(console.error);
      await logRaidAction(
        message.guild,
        `🚨 **荒らし行為検知**: ${message.author.tag} が不適切なメッセージを送信しました。\n理由: キーワードに一致`,
        message.channel.name
      );
      markUser(message.author.id);
      return;
    } catch (e) {
      console.error('タイムアウト処理に失敗しました:', e);
    }
  }

  // 2. 類似メッセージによる検知
  const guildId = message.guild.id;
  const authorId = message.author.id;
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

  // 類似メッセージの送信回数をチェック
  const sendCount = msgSenders.get(authorId);
  if (sendCount >= SIMILAR_MESSAGE_THRESHOLD) {
    try {
      await message.member.timeout(TIMEOUT_DURATION, '類似メッセージの連投');
      message.channel.send(`⚠️ **${message.author.tag}** は類似メッセージを連投したため、10分間タイムアウトされました。`).catch(console.error);
      await logRaidAction(
        message.guild,
        `⚠️ **類似メッセージ連投警告**: ${message.author.tag} が類似メッセージを${SIMILAR_MESSAGE_THRESHOLD}回以上送信しました。`,
        message.channel.name
      );
      markUser(message.author.id);
      return;
    } catch (e) {
      console.error('タイムアウト処理に失敗しました:', e);
    }
  }

  // 複数の人間が送った場合も検知
  const totalSenders = msgSenders.size;
  if (totalSenders >= SIMILAR_MESSAGE_THRESHOLD) {
     try {
       await message.member.timeout(TIMEOUT_DURATION, '複数のユーザーによる類似メッセージ連投');
       message.channel.send(`⚠️ 複数のユーザーが類似メッセージを送信したため、関連するユーザーを10分間タイムアウトしました。`).catch(console.error);
       await logRaidAction(
         message.guild,
         `⚠️ **協調荒らし警告**: 複数のユーザーが類似メッセージを送信しました。`,
         message.channel.name
       );
       msgSenders.forEach(async (_, userId) => {
         await message.guild.members.cache.get(userId).timeout(TIMEOUT_DURATION, '協調荒らし');
         markUser(userId);
       });
     } catch (e) {
       console.error('協調荒らしのタイムアウト処理に失敗しました:', e);
     }
  }
}

// === ユーザーをマーク ===
function markUser(userId) {
  const now = Date.now();
  markedUsers.set(userId, now);
  setTimeout(() => {
    markedUsers.delete(userId);
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
                name: 'bot-logs', // チャンネル名を自由に設定
                type: 0, // TextChannel
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


module.exports = {
  handleMemberJoin,
  handleMessage,
  LOG_CHANNEL_ID,
};
