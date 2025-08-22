// utils/anti-raid.js
// Discord.js v14 統合版

const fs = require('fs');
const path = require('path');
const {
  AuditLogEvent,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');

// ===== 設定（必要に応じて .env や config に移してOK）=====
const LOG_CHANNEL_ID = 1405660583025709106
const AUTH_CHANNEL_ID = process.env.ANTI_RAID_AUTH_CHANNEL_ID || 'YOUR_AUTH_CHANNEL_ID';
const JOIN_LOG_CHANNEL_ID = 1407669514425860136

// ホワイトリスト（ユーザー / ロール）
const WHITELIST_USERS = (process.env.ANTI_RAID_WHITELIST_USERS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const WHITELIST_ROLES = (process.env.ANTI_RAID_WHITELIST_ROLES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// AI 判定（任意）: utils/ai.js の chat() を使う
const USE_AI_JUDGEMENT = (process.env.ANTI_RAID_USE_AI || 'false').toLowerCase() === 'true';
let chat = null;
if (USE_AI_JUDGEMENT) {
  try { ({ chat } = require('./ai')); } catch {}
}

// ===== スコア永続化（JSON）=====
const DATA_DIR = path.join(__dirname, '../data');
const SCORE_PATH = path.join(DATA_DIR, 'raidScores.json');
const MARK_PATH = path.join(DATA_DIR, 'raidMarks.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let scores = {};
let markedUsersStore = {};
try { if (fs.existsSync(SCORE_PATH)) scores = JSON.parse(fs.readFileSync(SCORE_PATH, 'utf8')); } catch {}
try { if (fs.existsSync(MARK_PATH)) markedUsersStore = JSON.parse(fs.readFileSync(MARK_PATH, 'utf8')); } catch {}

function saveScores() {
  try { fs.writeFileSync(SCORE_PATH, JSON.stringify(scores, null, 2)); } catch {}
}
function saveMarks() {
  try { fs.writeFileSync(MARK_PATH, JSON.stringify(markedUsersStore, null, 2)); } catch {}
}

// ===== 閾値（昼/夜で可変）=====
const NIGHT_START_HOUR = 22; // JST
const NIGHT_END_HOUR = 7;

const cfg = {
  day: { THRESHOLD: 20, MASS_JOIN: 10, KEYWORD: 15, SIMILAR: 10, CMD_ABUSE: 10, REACT_SPAM: 5, NEWLINES: 8, ZALGO: 10, MASS_SPAM: 10, WEBHOOK: 25, AUDIT_ABUSE: 30, ACCOUNT_AGE: 15, },
  night: { THRESHOLD: 15, MASS_JOIN: 15, KEYWORD: 20, SIMILAR: 15, CMD_ABUSE: 15, REACT_SPAM: 10, NEWLINES: 12, ZALGO: 15, MASS_SPAM: 15, WEBHOOK: 30, AUDIT_ABUSE: 35, ACCOUNT_AGE: 20, }
};

function currentCfg() {
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;
  return (jstHour >= NIGHT_START_HOUR || jstHour < NIGHT_END_HOUR) ? cfg.night : cfg.day;
}

// ===== ルール定数 =====
const RAID_MEMBER_THRESHOLD = 3; // 1分でこの人数以上 join
const RAID_TIME_WINDOW = 60 * 1000;
const MASS_SPAM_THRESHOLD = 2; // 3秒で2件以上
const MASS_SPAM_WINDOW = 3 * 1000;
const SIMILAR_MESSAGE_THRESHOLD = 2;
const SIMILAR_MESSAGE_LENGTH = 5;
const TIMEOUT_MS = 5 * 60 * 1000; // 5分
const MARK_EXPIRE_MS = 48 * 60 * 60 * 1000; // 48h

const MASS_ACTION_WINDOW_MS = 2 * 60 * 1000; // 2分
const MASS_ACTION_THRESHOLD = 2; // 2人以上
const PROBATION_MS = 24 * 60 * 60 * 1000; // 24時間

const RAID_KEYWORDS = [
  ' this server is raided', ' this server has been raided', ' reidされました', ' on top', ' discord.gg',
  ' invite.gg', 'このサーバーをレイドしました', '包囲した',
];

const DANGEROUS_PERMISSIONS = [
  PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.KickMembers, PermissionsBitField.Flags.BanMembers, PermissionsBitField.Flags.ManageGuild,
];
const DANGEROUS_PERMS_BITFIELD = new PermissionsBitField().add(...DANGEROUS_PERMISSIONS);

const DANGER_ACTIONS = new Set([
  AuditLogEvent.MemberKick, AuditLogEvent.MemberBanAdd, AuditLogEvent.ChannelCreate, AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelUpdate, AuditLogEvent.RoleCreate, AuditLogEvent.RoleDelete, AuditLogEvent.RoleUpdate,
]);

// ===== 内部状態 =====
const memberJoinLog = new Map();
const messageHistory = new Map();
const userCmdTime = new Map();
const userReactTime = new Map();
const userMsgTs = new Map();
const pendingModActions = new Map();
const raidAuthRoles = new Map();

// 第二モジュールから統合した状態
const executorActionLog = new Map();
const probationAdmins = new Map();

// ===== ユーティリティ =====
function hasDangerousPerms(permBits) {
  const perm = new PermissionsBitField(permBits);
  return perm.any(DANGEROUS_PERMS_BITFIELD);
}

function isWhitelisted(member) {
  if (!member) return false;
  if (WHITELIST_USERS.includes(member.id)) return true;
  if (member.roles?.cache?.some(r => WHITELIST_ROLES.includes(r.id))) return true;
  return false;
}

function addScore(userId, amount) {
  scores[userId] = (scores[userId] || 0) + amount;
  saveScores();
  return scores[userId];
}
function setScore(userId, value) {
  scores[userId] = value;
  saveScores();
}
function getScore(userId) {
  return scores[userId] || 0;
}

function markUser(userId) {
  markedUsersStore[userId] = Date.now();
  saveMarks();
  setTimeout(() => {
    delete markedUsersStore[userId];
    saveMarks();
    delete scores[userId];
    saveScores();
    userCmdTime.delete(userId);
    userReactTime.delete(userId);
    userMsgTs.delete(userId);
  }, MARK_EXPIRE_MS);
}

function isMarked(userId) {
  const t = markedUsersStore[userId];
  if (!t) return false;
  if (Date.now() - t > MARK_EXPIRE_MS) {
    delete markedUsersStore[userId];
    saveMarks();
    return false;
  }
  return true;
}

async function getOrCreateLogChannel(guild, channelId = LOG_CHANNEL_ID) {
  if (!guild) return null;
  let ch = channelId && guild.channels.cache.get(channelId);
  if (ch) return ch;
  try {
    ch = await guild.channels.create({
      name: 'bot-logs',
      type: ChannelType.GuildText,
      reason: '荒らし対策ログ',
    });
    return ch;
  } catch {
    return null;
  }
}

async function sendLogEmbed(guild, { title, member, description, fields = [], color = 0xff0000, channelName, logChannelId = LOG_CHANNEL_ID }) {
  const ch = await getOrCreateLogChannel(guild, logChannelId);
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description || '')
    .addFields(
      ...(member ? [{ name: 'ユーザー', value: `${member.user?.tag || 'unknown'} (${member.id})`, inline: false }] : []),
      ...fields
    )
    .setFooter({ text: channelName ? `チャンネル: #${channelName}` : '' })
    .setTimestamp();
  ch.send({ embeds: [embed] }).catch(() => {});
}

async function sendPlainLog(guild, channelId, content) {
  try {
    const ch = guild.channels.cache.get(channelId) ||
               guild.systemChannel ||
               guild.channels.cache.find(c => c.type === ChannelType.GuildText);
    if (ch) await ch.send(content);
  } catch (e) {
    console.error('[anti-raid] Failed to send plain log:', e);
  }
}

async function saveAndStripRoles(member) {
  if (!member?.manageable) return;
  const oldRoles = member.roles.cache.map(r => r.id);
  raidAuthRoles.set(member.id, oldRoles);
  await member.roles.set([], 'Raid対策: 権限一時剥奪');
}

async function restoreRoles(member) {
  const old = raidAuthRoles.get(member.id);
  if (!old) return;
  await member.roles.set(old, 'Raid対策: 認証完了・復元');
  raidAuthRoles.delete(member.id);
  member.send('✅ 認証が完了しました。あなたのロールは元に戻されました。').catch(() => {});
}

async function createOneTimeInvite(guild) {
  try {
    const channel =
      guild.systemChannel ||
      guild.channels.cache.find(c =>
        c.type === ChannelType.GuildText &&
        c.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.CreateInstantInvite)
      );
    if (!channel) return null;
    const invite = await channel.createInvite({
      maxAge: 30 * 60,
      maxUses: 1,
      unique: true,
      reason: '救済用自動招待リンク',
    }).catch(() => null);
    return invite?.url || null;
  } catch (e) {
    console.error('[anti-raid] createOneTimeInvite error:', e);
    return null;
  }
}

function recordAndCheckMassAbuse(executorId, victimId, action) {
  const now = Date.now();
  const list = executorActionLog.get(executorId) || [];
  list.push({ t: now, victimId, action });
  const recent = list.filter(x => now - x.t <= MASS_ACTION_WINDOW_MS);
  executorActionLog.set(executorId, recent);
  const uniqueVictims = new Set(recent.map(x => x.victimId));
  return uniqueVictims.size >= MASS_ACTION_THRESHOLD;
}

function isInProbation(userId) {
  const until = probationAdmins.get(userId);
  return until && until > Date.now();
}

async function stripAllRoles(guild, userId, reason) {
  try {
    const m = await guild.members.fetch(userId);
    if (m?.manageable) {
      await m.roles.set([], reason);
      return true;
    }
    return false;
  } catch (e) {
    console.error('[anti-raid] stripAllRoles error:', e);
    return false;
  }
}

async function findExecutorForTarget(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(e => (e.target?.id === targetId));
    return entry?.executor || null;
  } catch (e) {
    console.error('[anti-raid] fetchAuditLogs error:', e);
    return null;
  }
}

async function punishByScore(member, reason, channelName) {
  if (!member || isWhitelisted(member) || probationAdmins.has(member.id)) return;
  const c = currentCfg();
  const score = getScore(member.id);

  if (score >= Math.floor(c.THRESHOLD * 0.5) && score < c.THRESHOLD) {
    const muteRole = member.guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
    if (muteRole && !member.roles.cache.has(muteRole.id)) {
      await member.roles.add(muteRole, '荒らし疑い（スコア中間）').catch(() => {});
      await sendLogEmbed(member.guild, {
        title: '⚠️ 荒らし疑い（Mute）', member, description: `理由: ${reason}\nスコア: ${score}/${c.THRESHOLD}`, channelName, color: 0xffa200,
      });
      return;
    }
  }

  if (score >= c.THRESHOLD) {
    try {
      await member.timeout(TIMEOUT_MS, reason);
      await sendLogEmbed(member.guild, {
        title: '🚨 Timeout 適用', member, description: `理由: ${reason}\nスコア: ${score}（閾値 ${c.THRESHOLD} 到達）\nTimeout: ${Math.floor(TIMEOUT_MS / 60000)}分`, channelName,
      });
      setScore(member.id, Math.floor(c.THRESHOLD * 0.5));
      markUser(member.id);
    } catch {
      await saveAndStripRoles(member).catch(() => {});
      await sendLogEmbed(member.guild, {
        title: '🚨 権限剥奪（代替）', member, description: `Timeout に失敗したためロール剥奪。\n理由: ${reason}\nスコア: ${score}`, channelName,
      });
      markUser(member.id);
    }
  }
}

// ====== AI 補助（任意）=====
const AI_ANTI_RAID_PROMPT = `
- 以下の行為のみ「不審」と判定:
  1) サーバー破壊（権限乱用/チャンネル大量作成/ロール削除など）
  2) Raid 予告や勧誘、荒らし用リンク（https 無しでも .gg を含むなど）
  3) 不適切画像の乱用
  4) メッセージの大量連投
- それ以外は「問題なし」。過剰検知を避けること。
- 出力形式: 「不審/問題なし | 理由: ...」
メッセージ:
`;

async function handleAiJudgement(message) {
  if (!USE_AI_JUDGEMENT || !chat) return;
  const member = message.member;
  if (!member || isWhitelisted(member) || member.permissions?.has(PermissionsBitField.Flags.Administrator)) return;
  try {
    const res = await chat(AI_ANTI_RAID_PROMPT + (message.content || ''), message.author.id);
    if (res && /^不審\b/.test(res)) {
      const reason = (res.split('|')[1] || '').trim() || 'AI判定: 不審';
      const added = addScore(member.id, 15);
      await sendLogEmbed(message.guild, {
        title: '🤖 AI 不審判定', member, description: `理由: ${reason}\n付与: +15\n現在: ${added}/${currentCfg().THRESHOLD}`,
        channelName: message.channel?.name, color: 0x6c5ce7,
      });
      await punishByScore(member, reason, message.channel?.name);
    }
  } catch {}
}

// ====== Join 監視 ======
async function handleMemberJoin(member) {
  if (!member || member.user.bot) return;
  if (isWhitelisted(member)) return;

  const now = Date.now();
  const gid = member.guild.id;
  if (!memberJoinLog.has(gid)) memberJoinLog.set(gid, []);
  const arr = memberJoinLog.get(gid);
  arr.push({ id: member.id, timestamp: now });
  const recent = arr.filter(j => now - j.timestamp < RAID_TIME_WINDOW);
  memberJoinLog.set(gid, recent);

  const c = currentCfg();

  if (recent.length >= RAID_MEMBER_THRESHOLD) {
    await sendLogEmbed(member.guild, {
      title: '🚨 Raid 警告（大量参加）', member, description: `過去1分で ${recent.length} 人が参加`, color: 0xff4757,
    });
    for (const j of recent) {
      const m = await member.guild.members.fetch(j.id).catch(() => null);
      if (!m) continue;
      await saveAndStripRoles(m).catch(() => {});
      m.send(`サーバーが一時的に警戒モードです。\n<#${AUTH_CHANNEL_ID}> で認証をお願いします。`).catch(() => {});
      addScore(m.id, c.MASS_JOIN);
    }
  }

  const age = now - member.user.createdAt.getTime();
  if (age < 24 * 60 * 60 * 1000) {
    const newScore = addScore(member.id, c.ACCOUNT_AGE);
    await sendLogEmbed(member.guild, {
      title: '⚠️ 新規アカウント参加', member, description: `年齢 < 24h → +${c.ACCOUNT_AGE}\n現在: ${newScore}/${c.THRESHOLD}`, color: 0xffa200,
    });
    await punishByScore(member, '新規アカウント', 'system');
  }

  if (JOIN_LOG_CHANNEL_ID) {
    await sendPlainLog(member.guild, JOIN_LOG_CHANNEL_ID,
      `👋 **参加**: ${member.user.bot ? '[BOT] ' : ''}<@${member.id}> (${member.user.tag})`);
  }
}

// ====== メッセージ監視 ======
async function handleMessage(message) {
  if (!message?.guild || message.author?.bot) return;
  const member = message.member;
  if (!member || isWhitelisted(member) || member.permissions?.has(PermissionsBitField.Flags.Administrator)) return;

  await handleAiJudgement(message);

  const c = currentCfg();
  const now = Date.now();
  const uid = member.id;

  // 3秒間の連投
  const list = userMsgTs.get(uid) || [];
  list.push(now);
  const recent = list.filter(t => now - t < MASS_SPAM_WINDOW);
  userMsgTs.set(uid, recent);
  if (recent.length >= MASS_SPAM_THRESHOLD) {
    const s = addScore(uid, c.MASS_SPAM);
    await safeDelete(message, 'メッセージ連投');
    await sendLogEmbed(message.guild, {
      title: '🚧 連投検知', member, description: `+${c.MASS_SPAM} / 現在 ${s}/${c.THRESHOLD}`, channelName: message.channel?.name, color: 0xffa200,
    });
    return punishByScore(member, 'メッセージ連投', message.channel?.name);
  }

  const content = (message.content || '').toLowerCase();

  // 危険キーワード
  if (RAID_KEYWORDS.some(k => content.includes(k))) {
    const s = addScore(uid, c.KEYWORD);
    await safeDelete(message, 'NGワード');
    await sendLogEmbed(message.guild, {
      title: '🚨 NGキーワード', member, description: `+${c.KEYWORD} / 現在 ${s}/${c.THRESHOLD}\n内容（抜粋）: ${snippet(message.content)}`, channelName: message.channel?.name,
    });
    return punishByScore(member, 'NGワード', message.channel?.name);
  }

  // 過度な改行
  if ((content.match(/\n/g) || []).length > 10) {
    const s = addScore(uid, c.NEWLINES);
    await safeDelete(message, '過度な改行');
    await sendLogEmbed(message.guild, {
      title: '🚧 過度な改行', member, description: `+${c.NEWLINES} / 現在 ${s}/${c.THRESHOLD}`, channelName: message.channel?.name, color: 0xffa200,
    });
    return punishByScore(member, '過度な改行', message.channel?.name);
  }

  // Zalgo
  const zalgo = (message.content.match(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g) || []).length;
  if (zalgo > 5) {
    const s = addScore(uid, c.ZALGO);
    await safeDelete(message, 'Zalgo 乱用');
    await sendLogEmbed(message.guild, {
      title: '🚧 Zalgo 乱用', member, description: `+${c.ZALGO} / 現在 ${s}/${c.THRESHOLD}`, channelName: message.channel?.name, color: 0xffa200,
    });
    return punishByScore(member, 'Zalgo 乱用', message.channel?.name);
  }

  // 類似メッセージ連投
  const gid = message.guild.id;
  const normalized = content.replace(/\s/g, '');
  if (normalized.length >= SIMILAR_MESSAGE_LENGTH) {
    if (!messageHistory.has(gid)) messageHistory.set(gid, new Map());
    const gmap = messageHistory.get(gid);
    if (!gmap.has(normalized)) gmap.set(normalized, new Map());
    const senders = gmap.get(normalized);
    senders.set(uid, (senders.get(uid) || 0) + 1);
    if (senders.get(uid) >= SIMILAR_MESSAGE_THRESHOLD) {
      const s = addScore(uid, c.SIMILAR);
      await safeDelete(message, '類似メッセージ連投');
      await sendLogEmbed(message.guild, {
        title: '🚧 類似メッセージ', member, description: `+${c.SIMILAR} / 現在 ${s}/${c.THRESHOLD}\n内容（抜粋）: ${snippet(message.content)}`, channelName: message.channel?.name, color: 0xffa200,
      });
      return punishByScore(member, '類似メッセージ連投', message.channel?.name);
    }
  }

  // コマンド連打
  if (content.startsWith('!') || content.startsWith('/')) {
    const last = userCmdTime.get(uid) || 0;
    if (now - last < 1000) {
      const s = addScore(uid, c.CMD_ABUSE);
      await sendLogEmbed(message.guild, {
        title: '🚧 コマンド連打', member, description: `+${c.CMD_ABUSE} / 現在 ${s}/${c.THRESHOLD}`, channelName: message.channel?.name, color: 0xffa200,
      });
      return punishByScore(member, 'コマンド連打', message.channel?.name);
    }
    userCmdTime.set(uid, now);
  }
}

async function handleMessageUpdate(oldMessage, newMessage) {
  if (!newMessage || newMessage.author?.bot) return;
  if (oldMessage?.content === newMessage?.content) return;
  return handleMessage(newMessage);
}

async function handleReactionAdd(reaction, user) {
  if (!reaction?.message?.guild) return;
  if (user.bot) return;
  const member = reaction.message.guild.members.cache.get(user.id);
  if (!member || isWhitelisted(member) || member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  const now = Date.now();
  const last = userReactTime.get(user.id) || 0;
  if (now - last < 1000) {
    const s = addScore(user.id, currentCfg().REACT_SPAM);
    await sendLogEmbed(reaction.message.guild, {
      title: '🚧 リアクション連打', member, description: `+${currentCfg().REACT_SPAM} / 現在 ${s}/${currentCfg().THRESHOLD}`,
      channelName: reaction.message.channel?.name, color: 0xffa200,
    });
    await punishByScore(member, 'リアクション連打', reaction.message.channel?.name);
  }
  userReactTime.set(user.id, now);
}

// ====== 監査ログ / 危険操作 ======
async function handleAuditLogEntry(entry) {
  const { guild, executor, action, target } = entry;
  if (!executor || executor.bot) return;

  if (DANGER_ACTIONS.has(action)) {
    const member = guild.members.cache.get(executor.id);
    if (!member) return;

    if (isWhitelisted(member)) return;

    const c = currentCfg();
    const now = Date.now();

    // スコア加算
    const s = addScore(executor.id, c.AUDIT_ABUSE);
    await sendLogEmbed(guild, {
      title: '🚨 不審な監査ログ操作', member, description: `アクション: ${AuditLogEvent[action]} → +${c.AUDIT_ABUSE}\n現在: ${s}/${c.THRESHOLD}`,
      color: 0xff4757,
    });
    // スコアベースの処罰も適用
    await punishByScore(member, `不審な監査ログ操作 (${AuditLogEvent[action]})`, 'system');

    // 危険操作時は DM で理由確認 → 未回答なら剥奪
    if (pendingModActions.has(executor.id)) {
      const p = pendingModActions.get(executor.id);
      p.reasonAttempts++;
      try {
        const dm = await executor.createDM();
        await dm.send(`⚠️ 理由確認の再送（残り ${Math.max(0, 3 - p.reasonAttempts)} 回）`);
      } catch {}
      return;
    }

    try {
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await saveAndStripRoles(member);
        const actionText = `アクション: ${AuditLogEvent[action]} / 対象: ${target?.tag || target?.name || target?.id}`;
        const dmText = `サーバーで重要な操作を行いました。\n${actionText}\nこのDMに **3分以内** に理由を返信してください。未回答なら権限剥奪を継続します。`;
        await executor.send(dmText).catch(() => {});
        pendingModActions.set(executor.id, { entry, timestamp: now, reasonAttempts: 0 });

        setTimeout(async () => {
          const pending = pendingModActions.get(executor.id);
          if (!pending) return;
          await sendLogEmbed(guild, {
            title: '⚠️ DM未応答につき権限剥奪継続', member, description: '重要操作の理由確認に未応答', color: 0xffa200,
          });
          pendingModActions.delete(executor.id);
        }, 3 * 60 * 1000);
      }
    } catch {}
  }
}

// ====== Bot 追加監視 ======
async function handleBotAdd(member) {
  if (!member?.user?.bot) return false;
  const isVerified = !!member.user.flags?.has?.('VerifiedBot');
  if (!isVerified) {
    try {
      const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1 });
      const entry = logs.entries.first();
      const executor = entry?.executor;
      await member.roles.set([], '未認証Botのため権限剥奪').catch(() => {});
      await sendLogEmbed(member.guild, {
        title: '🚨 怪しいBot検知', member, description: `招待者: ${executor?.tag || '不明'}`, color: 0xff4757,
      });
      return true;
    } catch {}
  }
  return false;
}

// ====== ロール更新 (@everyone 危険権限検知) ======
async function handleRoleUpdate(oldRole, newRole) {
  if (oldRole.id !== oldRole.guild.id) return;
  const before = oldRole.permissions;
  const after = newRole.permissions;
  const added = DANGEROUS_PERMISSIONS.filter(p => after.has(p) && !before.has(p));
  if (added.length === 0) return;

  try {
    const logs = await oldRole.guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 1 });
    const entry = logs.entries.first();
    const executor = entry?.executor;
    if (!executor) return;

    const member = oldRole.guild.members.cache.get(executor.id);
    if (!member || isWhitelisted(member)) return;

    await newRole.setPermissions(before, '危険権限の自動削除');
    await oldRole.guild.members.ban(executor.id, { reason: '@everyone に危険権限を付与' }).catch(() => {});
    await sendLogEmbed(oldRole.guild, {
      title: '🚨 危険権限を検知し差し戻し', member, description: `追加された権限: ${added.map(p => PermissionsBitField.Flags[p]).join(', ')}`,
    });
  } catch {}
}

// ====== 第二モジュールからの統合部分 ======

async function onGuildMemberUpdate(memberBefore, memberAfter) {
  if (memberAfter.user.bot) return;

  const beforePerms = memberBefore.permissions?.bitfield ?? 0n;
  const afterPerms = memberAfter.permissions?.bitfield ?? 0n;

  if (!hasDangerousPerms(beforePerms) && hasDangerousPerms(afterPerms)) {
    await sendPlainLog(memberAfter.guild, LOG_CHANNEL_ID,
      `⚠️ **危険権限付与検知**: <@${memberAfter.id}> に危険権限が付与されました。`);
  }

  const beforeAdmin = new PermissionsBitField(beforePerms).has(PermissionsBitField.Flags.Administrator);
  const afterAdmin = new PermissionsBitField(afterPerms).has(PermissionsBitField.Flags.Administrator);
  if (!beforeAdmin && afterAdmin) {
    const until = Date.now() + PROBATION_MS;
    probationAdmins.set(memberAfter.id, until);
    await sendPlainLog(memberAfter.guild, LOG_CHANNEL_ID,
      `⏱️ **新管理者クールダウン開始**: <@${memberAfter.id}> は ${new Date(until).toLocaleString()} まで処罰行為（BAN/Kick/Timeout）を行うと権限剥奪されます。`);
  }

  const beforeUntil = memberBefore.communicationDisabledUntilTimestamp || 0;
  const afterUntil = memberAfter.communicationDisabledUntilTimestamp || 0;
  const timeoutAdded = beforeUntil === 0 && afterUntil > 0;
  if (timeoutAdded) {
    const executor = await findExecutorForTarget(memberAfter.guild, AuditLogEvent.MemberUpdate, memberAfter.id);
    if (executor && (isInProbation(executor.id) || recordAndCheckMassAbuse(executor.id, memberAfter.id, 'TIMEOUT'))) {
      try {
        await memberAfter.timeout(null, '荒らし検知: Timeout解除');
      } catch (e) {}
      const ok = await stripAllRoles(memberAfter.guild, executor.id, '荒らし検知: クールダウン中の処罰 or 大量処罰');
      await sendLogEmbed(memberAfter.guild, {
        title: '🚨 不審なTimeout検知',
        description: `実行者 <@${executor.id}> を権限剥奪（成功:${ok}）。\n対象: <@${memberAfter.id}> のTimeoutは解除しました。`,
        member: memberAfter,
      });
      try {
        const dm = await memberAfter.createDM();
        const url = await createOneTimeInvite(memberAfter.guild);
        await dm.send(`すみません。サーバー側で不正なTimeoutを検知し、解除しました。\n` +
          (url ? `よろしければ再参加・確認はこちら: ${url}` : `再参加招待の作成に失敗しました。管理者へご連絡ください。`));
      } catch {}
    }
  }
}

async function onGuildBanAdd(ban) {
  const { guild, user } = ban;
  setTimeout(async () => {
    const executor = await findExecutorForTarget(guild, AuditLogEvent.MemberBanAdd, user.id);
    if (!executor) return;
    if (isInProbation(executor.id) || recordAndCheckMassAbuse(executor.id, user.id, 'BAN')) {
      try { await guild.members.unban(user.id, '荒らし検知: 誤BAN救済'); } catch {}
      const ok = await stripAllRoles(guild, executor.id, '荒らし検知: クールダウン中の処罰 or 大量処罰');
      await sendLogEmbed(guild, {
        title: '🚨 不審なBAN検知',
        description: `実行者 <@${executor.id}> を権限剥奪（成功:${ok}）。\n対象: **${user.tag}** はBAN解除しました。`,
      });
      try {
        const url = await createOneTimeInvite(guild);
        const dm = await user.createDM();
        await dm.send(`すみません。サーバー側で不正なBANを検知し、解除しました。\n` +
          (url ? `再参加用の招待リンク: ${url}` : `再参加招待の作成に失敗しました。管理者へご連絡ください。`));
      } catch {}
    }
  }, 1500);
}

async function onGuildMemberRemove(member) {
  const guild = member.guild;
  setTimeout(async () => {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 }).catch(() => null);
    const entry = logs?.entries?.find(e => e.target?.id === member.id);
    if (!entry) return;
    const executor = entry.executor;
    if (!executor) return;
    if (isInProbation(executor.id) || recordAndCheckMassAbuse(executor.id, member.id, 'KICK')) {
      const ok = await stripAllRoles(guild, executor.id, '荒らし検知: クールダウン中の処罰 or 大量処罰');
      await sendLogEmbed(guild, {
        title: '🚨 不審なKick検知',
        description: `実行者 <@${executor.id}> を権限剥奪（成功:${ok}）。\n対象: **${member.user?.tag || member.id}** にはお詫びDMを送ります。`,
      });
      try {
        const url = await createOneTimeInvite(guild);
        const dm = await member.user.createDM();
        await dm.send(`すみません。サーバー側で不正なKickを検知しました。\n` +
          (url ? `再参加用の招待リンク: ${url}` : `再参加招待の作成に失敗しました。管理者へご連絡ください。`));
      } catch {}
    }
  }, 1500);
}

// ====== 補助関数 ======
async function safeDelete(message, why) {
  if (!message?.deletable) return;
  try { await message.delete(); } catch {}
}
function snippet(text, max = 140) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// ====== エクスポート ======
module.exports = {
  handleMemberJoin,
  handleMessage,
  handleReactionAdd,
  handleRoleUpdate,
  handleAuditLogEntry,
  handleMessageUpdate,
  handleBotAdd,
  onGuildMemberUpdate,
  onGuildBanAdd,
  onGuildMemberRemove,
  pendingModActions,
  DANGER_ACTIONS,
  restoreRoles,
  probationAdmins,
  executorActionLog,
};
