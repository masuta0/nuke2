const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const STAFF_ROLE_IDS = [
  '1419417500579528958',
  '1409196340780466367',
  '1414515772352495687',
  '1411968646649217024',
  '1405192800919883776'
];

const TICKET_LOG_CHANNEL_ID = '1419418871986917446';
const activeTickets = new Map(); // ユーザーID → チャンネルID

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('チケット作成')
    .addSubcommand(sub =>
      sub.setName('create')
         .setDescription('新しいチケットを作成します')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      if (activeTickets.has(interaction.user.id)) {
        const channelId = activeTickets.get(interaction.user.id);
        const channel = interaction.guild.channels.cache.get(channelId);
        return interaction.reply({ content: `すでにチケットがあります: ${channel}`, ephemeral: true });
      }

      let category = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === 'チケット' && c.type === ChannelType.GuildCategory);
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
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          ...STAFF_ROLE_IDS.map(id => ({
            id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          }))
        ]
      });

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_close_confirm')
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
        await logChannel.send(`📂 新しいチケット作成: ${ticketChannel} | 作成者: <@${interaction.user.id}>`);
      }

      return interaction.reply({ content: `✅ チケットを作成しました: ${ticketChannel}`, ephemeral: true });
    }
  },

  async buttonHandler(interaction) {
    if (!interaction.customId.startsWith('ticket_close')) return;

    const creatorId = interaction.channel.name.split('-')[1];
    const isStaff = STAFF_ROLE_IDS.some(rid => interaction.member.roles.cache.has(rid));
    if (interaction.user.id !== creatorId && !isStaff) {
      return interaction.reply({ content: '⚠️ あなたはこのチケットを閉じる権限がありません。', ephemeral: true });
    }

    if (interaction.customId === 'ticket_close_confirm') {
      const confirmRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_close_final')
            .setLabel('本当に閉じる')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('ticket_close_cancel')
            .setLabel('キャンセル')
            .setStyle(ButtonStyle.Secondary)
        );

      return interaction.reply({ content: 'チケットを閉じますか？', components: [confirmRow], ephemeral: true });
    }

    if (interaction.customId === 'ticket_close_cancel') {
      return interaction.update({ content: 'チケット閉鎖をキャンセルしました。', components: [] });
    }

    if (interaction.customId === 'ticket_close_final') {
      await interaction.update({ content: '💥 チケットを閉じています…', components: [] });

      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const logText = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(m => `[${new Date(m.createdTimestamp).toLocaleString()}] ${m.author.tag}: ${m.content}`)
        .join('\n');

      // 一時ファイルを作成して添付
      const fileName = `ticket-${creatorId}.txt`;
      const filePath = path.join(__dirname, fileName);
      fs.writeFileSync(filePath, logText);

      const logChannel = interaction.guild.channels.cache.get(TICKET_LOG_CHANNEL_ID);
      if (logChannel) {
        const attachment = new AttachmentBuilder(filePath);
        await logChannel.send({ content: `🗑 チケット閉鎖: ${interaction.channel.name} | 閉鎖者: <@${interaction.user.id}>`, files: [attachment] });
      }

      if (activeTickets.has(creatorId)) activeTickets.delete(creatorId);

      setTimeout(async () => {
        try {
          await interaction.channel.delete();
          fs.unlinkSync(filePath); // ファイル削除
        } catch (e) {
          console.error('チケット削除エラー:', e);
        }
      }, 2000);
    }
  }
};