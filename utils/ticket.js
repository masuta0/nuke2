// utils/ticket.js
const { 
  ChannelType, 
  PermissionFlagsBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');

const STAFF_ROLE_IDS = [
  '1419417500579528958',
  '1409196340780466367',
  '1414515772352495687',
  '1411968646649217024',
  '1405192800919883776'
];

const TICKET_LOG_CHANNEL_ID = '1419418871986917446';
const activeTickets = new Map();

module.exports = {
  // チケットシステムを起動（ボタン送信用）
  async sendTicketPanel(channel) {
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_create')
          .setLabel('🎫 チケットを作成')
          .setStyle(ButtonStyle.Primary)
      );

    await channel.send({
      content: 'サポートが必要な方は下のボタンを押してチケットを作成してください。',
      components: [row],
    });
  },

  // ボタンハンドラ
  async handleButton(interaction) {
    if (interaction.customId === 'ticket_create') {
      if (activeTickets.has(interaction.user.id)) {
        const channelId = activeTickets.get(interaction.user.id);
        const channel = interaction.guild.channels.cache.get(channelId);
        return interaction.reply({ 
          content: `⚠️ すでにチケットがあります → ${channel}`, 
          ephemeral: true 
        });
      }

      let category = interaction.guild.channels.cache.find(
        c => c.name.toLowerCase() === 'チケット' && c.type === ChannelType.GuildCategory
      );
      if (!category) {
        category = await interaction.guild.channels.create({
          name: 'チケット',
          type: ChannelType.GuildCategory,
        });
      }

      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.id}`,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          {
            id: interaction.guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel, 
              PermissionFlagsBits.SendMessages, 
              PermissionFlagsBits.ReadMessageHistory
            ],
          },
          ...STAFF_ROLE_IDS.map(id => ({
            id,
            allow: [
              PermissionFlagsBits.ViewChannel, 
              PermissionFlagsBits.SendMessages, 
              PermissionFlagsBits.ReadMessageHistory
            ],
          }))
        ]
      });

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('閉じる')
            .setStyle(ButtonStyle.Danger)
        );

      await ticketChannel.send({
        content: `<@${interaction.user.id}> さんのチケットを作成しました。スタッフが対応します。`,
        components: [row],
      });

      activeTickets.set(interaction.user.id, ticketChannel.id);

      const logChannel = interaction.guild.channels.cache.get(TICKET_LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send(`📩 チケット作成: ${ticketChannel} | 作成者: <@${interaction.user.id}>`);
      }

      return interaction.reply({ 
        content: `✅ チケットを作成しました: ${ticketChannel}`, 
        ephemeral: true 
      });
    }

    if (interaction.customId === 'ticket_close') {
      const creatorId = interaction.channel.name.split('-')[1];
      if (interaction.user.id !== creatorId &&
        !STAFF_ROLE_IDS.some(rid => interaction.member.roles.cache.has(rid))) {
        return interaction.reply({ 
          content: '⚠️ このチケットを閉じる権限がありません。', 
          ephemeral: true 
        });
      }

      await interaction.reply({ content: 'チケットを閉じています…', ephemeral: true });

      const logChannel = interaction.guild.channels.cache.get(TICKET_LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send(`📪 チケット閉鎖: ${interaction.channel.name} | 閉鎖者: <@${interaction.user.id}>`);
      }

      if (activeTickets.has(creatorId)) activeTickets.delete(creatorId);

      setTimeout(async () => {
        try {
          await interaction.channel.delete();
        } catch (e) {
          console.error('チケット削除エラー:', e);
        }
      }, 2000);
    }
  }
};