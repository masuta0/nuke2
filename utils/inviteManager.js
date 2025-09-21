const { PermissionsBitField } = require("discord.js");

// 作成済みリンクをキャッシュ（サーバーごと）
const userInviteMap = new Map(); // key: guildId-userId, value: inviteCode

async function createInvite(member, maxUses = 0, expireSeconds = 0) {
  if (!member.guild || !member.permissions.has(PermissionsBitField.Flags.CreateInstantInvite)) {
    throw new Error("招待リンクを作成する権限がありません");
  }

  const key = `${member.guild.id}-${member.id}`;
  if (userInviteMap.has(key)) {
    return userInviteMap.get(key); // 既に作成済みリンクを返す
  }

  const channel = member.guild.channels.cache.find(c => c.type === 0); // テキストチャンネル
  if (!channel) throw new Error("招待リンクを作成できるチャンネルがありません");

  const invite = await channel.createInvite({
    maxUses,
    maxAge: expireSeconds,
    unique: true,
    reason: `個別招待リンク作成: ${member.user.tag}`
  });

  userInviteMap.set(key, invite.url);
  return invite.url;
}

async function fetchInviteCount(member) {
  const invites = await member.guild.invites.fetch();
  let count = 0;
  invites.forEach(inv => {
    if (inv.inviterId === member.id) {
      count += inv.uses;
    }
  });
  return count;
}

module.exports = { createInvite, fetchInviteCount };