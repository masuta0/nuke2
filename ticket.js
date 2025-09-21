// ticketSystem.js
const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');

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
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('チケットシステム')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('チケット作成ボタンを設置（管理者専用）')
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ 管理者のみ実行可能です', ephemeral: true });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_create')
          .setLabel('🎫 チケットを作成')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({
        content: 'サポートが必要な方は下のボタンを押してください。',
        components: [row]
      });
    }
  },

  async buttonHandler(interaction) {
    // ---- 作成 ----
    if (interaction.customId === 'ticket_create') {
      if (activeTickets.has(interaction.user.id)) {
        const channelId = activeTickets.get(interaction.user.id);
        return interaction.reply({ content: `すでにチケットがあります: <#${channelId}>`, ephemeral: true });
      }

      let category = interaction.guild.channels.cache.find(c => c.name === 'チケット' && c.type === ChannelType.GuildCategory);
      if (!category) {
        category = await interaction.guild.channels.create({
          name: 'チケット',
          type: ChannelType.GuildCategory,
        });
      }

      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          ...STAFF_ROLE_IDS.map(id => ({
            id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          }))
        ]
      });

      // 閉じるボタン
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('閉じる').setStyle(ButtonStyle.Danger)
      );

      const initialMsg = `<@${interaction.user.id}> さんのチケットを作成しました。スタッフが対応します。`;
      await ticketChannel.send({ content: initialMsg, components: [row] });

      // ローカル保存
      if (!fs.existsSync('./tickets')) fs.mkdirSync('./tickets');
      fs.writeFileSync(`./tickets/ticket-${interaction.user.id}.txt`, initialMsg);

      activeTickets.set(interaction.user.id, ticketChannel.id);

      const logChannel = interaction.guild.channels.cache.get(TICKET_LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send(`新しいチケット作成: ${ticketChannel} | 作成者: <@${interaction.user.id}>`);
      }

      return interaction.reply({ content: `✅ チケットを作成しました: ${ticketChannel}`, ephemeral: true });
    }

    // ---- 閉じる ----
    if (interaction.customId === 'ticket_close') {
      const creatorId = [...activeTickets.entries()]
        .find(([uid, cid]) => cid === interaction.channel.id)?.[0];

      if (interaction.user.id !== creatorId &&
        !STAFF_ROLE_IDS.some(rid => interaction.member.roles.cache.has(rid))) {
        return interaction.reply({ content: '⚠️ 閉じる権限がありません', ephemeral: true });
      }

      await interaction.reply({ content: 'チケットを閉じています…', ephemeral: true });

      const logChannel = interaction.guild.channels.cache.get(TICKET_LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send(`チケット閉鎖: ${interaction.channel.name} | 閉鎖者: <@${interaction.user.id}>`);
      }

      if (creatorId) activeTickets.delete(creatorId);

      setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
    }
  }
};