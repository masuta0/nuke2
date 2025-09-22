// utils/ticket.js (修正版)
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require("discord.js");

const TICKET_CATEGORY_ID = "1419438659433795673";
const LOG_CHANNEL_ID = "1419418871986917446";
const STAFF_ROLE_ID = "1419417500579528958";

module.exports = {
  async sendTicketPanel(interaction) {
    const button = new ButtonBuilder()
      .setCustomId("ticket_create")
      .setLabel("査定チケットを作成")
      .setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(button);

    await interaction.reply({
      content: "査定したい場合は下のボタンからチケットを作成してください。",
      components: [row],
      ephemeral: false, // ユーザーだけに表示
    });
  },

  async buttonHandler(interaction) {
    if (interaction.customId === "ticket_create") {
      const modal = new ModalBuilder()
        .setCustomId("ticket_modal")
        .setTitle("査定チケット");

      const reasonInput = new TextInputBuilder()
        .setCustomId("ticket_reason")
        .setLabel("査定内容")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "ticket_close") {
      const channel = interaction.channel;
      const log = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

      if (log) {
        const messages = await channel.messages.fetch({ limit: 100 });
        const content = messages
          .map(m => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
          .reverse()
          .join("\n");

        const filePath = require("path").join(__dirname, "ticket_log.txt");
        const fs = require("fs").promises;
        await fs.writeFile(filePath, content);

        await log.send({
          content: `🗑️ チケット **${channel.name}** を ${interaction.user} が閉じました。`,
          files: [{ attachment: filePath, name: `${channel.name}.txt` }],
        });

        await fs.unlink(filePath).catch(() => {});
      }

      return channel.delete("Ticket closed");
    }
  },

  async modalHandler(interaction) {
    if (interaction.customId !== "ticket_modal") return;

    const reason = interaction.fields.getTextInputValue("ticket_reason");
    const category = interaction.guild.channels.cache.get(TICKET_CATEGORY_ID);

    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.reply({
        content: "❌ チケットカテゴリが見つかりません。",
        ephemeral: true,
      });
    }

    // チャンネル作成
    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ],
    });

    const closeButton = new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("❌ チケットを閉じる")
      .setStyle(ButtonStyle.Danger);

    await channel.send({
      content: `🎫 ${interaction.user} がチケットを作成しました。\n**内容:** ${reason}`,
      components: [new ActionRowBuilder().addComponents(closeButton)],
    });

    // 作成時ログ削除（ここはコメントアウト）
    // await interaction.reply({...}) ではなく、ephemeralのみ
    await interaction.reply({
      content: `✅ チケットを作成しました: ${channel}`,
      ephemeral: true,
    });
  },
};