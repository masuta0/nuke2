// utils/ticket.js
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const TICKET_CATEGORY_ID = '1419438659433795673'; // チケットカテゴリID
const LOG_DIR = path.join(__dirname, '../tickets');

// パネル送信（全員に見える）
async function sendTicketPanel(channel) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_create')
      .setLabel('🎫 チケットを作成')
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({
    content: 'サポートが必要な場合は以下のボタンを押してください。',
    components: [row],
  });
}

// ボタン操作
async function handleTicketInteraction(interaction) {
  if (!interaction.isButton()) return;

  const guild = interaction.guild;
  const member = interaction.member;

  // ── チケット作成 ──
  if (interaction.customId === 'ticket_create') {
    // 既存チケット確認
    const existing = guild.channels.cache.find(
      ch => ch.parentId === TICKET_CATEGORY_ID && ch.topic === `ticket-${member.id}`
    );
    if (existing) {
      return interaction.reply({
        content: `❌ 既にチケットがあります: ${existing}`,
        ephemeral: true,
      });
    }

    // チケットチャンネル作成
    const channel = await guild.channels.create({
      name: `ticket-${member.user.username}`,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      topic: `ticket-${member.id}`,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: guild.members.me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
    });

    // 閉じるボタン
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('🔒 チケットを閉じる')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `${member} サポートスタッフが対応します。終了する場合は 🔒 を押してください。`,
      components: [row],
    });

    return interaction.reply({
      content: `✅ チケットを作成しました: ${channel}`,
      ephemeral: true, // 作成通知は本人だけ
    });
  }

  // ── チケット閉じる ──
  if (interaction.customId === 'ticket_close') {
    const channel = interaction.channel;

    // メッセージ取得 & ログ作成
    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    let log = `# チケットログ: ${channel.name}\n\n`;
    sorted.forEach(msg => {
      log += `[${new Date(msg.createdTimestamp).toLocaleString()}] ${msg.author.tag}: ${msg.content}\n`;
    });

    // ディレクトリ作成
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const filePath = path.join(LOG_DIR, `${channel.name}.txt`);
    fs.writeFileSync(filePath, log, 'utf8');

    await interaction.reply({
      content: `✅ ログを保存しました (${filePath})`,
      ephemeral: true,
    });

    // 3秒後にチャンネル削除
    setTimeout(() => channel.delete().catch(() => {}), 3000);
  }
}

module.exports = {
  sendTicketPanel,
  handleTicketInteraction,
};