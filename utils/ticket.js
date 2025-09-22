const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');

const TICKET_LOG_CHANNEL_ID = '1419418871986917446';

// パネルを送信
async function sendTicketPanel(channel) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_open')
      .setLabel('🎫 チケットを開く')
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({
    content: 'サポートが必要な方は下のボタンを押してください。',
    components: [row],
  });
}

// ボタン押下時の処理
async function handleButton(interaction) {
  if (interaction.customId === 'ticket_open') {
    const guild = interaction.guild;
    const member = interaction.member;

    // チケット用チャンネル作成
    const ticketChannel = await guild.channels.create({
      name: `ticket-${member.user.username}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ],
    });

    // 閉じるボタン
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('🔒 閉じる')
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `${member} さんのチケットです。サポートが必要な内容を入力してください。`,
      components: [row],
    });

    // ログチャンネルに通知
    const logChannel = guild.channels.cache.get(TICKET_LOG_CHANNEL_ID);
    if (logChannel) {
      await logChannel.send(`📩 ${interaction.user.tag} が ${ticketChannel} を開きました`);
    }

    await interaction.reply({ content: `✅ チケットを作成しました: ${ticketChannel}`, ephemeral: true });
  }

  if (interaction.customId === 'ticket_close') {
    // ログチャンネル通知
    const logChannel = interaction.guild.channels.cache.get(TICKET_LOG_CHANNEL_ID);
    if (logChannel) {
      await logChannel.send(`🔒 ${interaction.user.tag} が ${interaction.channel} を閉じました`);
    }

    await interaction.channel.delete().catch(() => {});
  }
}

module.exports = { sendTicketPanel, handleButton };