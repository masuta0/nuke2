// utils/ticket.js
const { 
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require("discord.js");

const TICKET_CATEGORY_ID = "1419438659433795673"; // ✅ チケットカテゴリのID
const LOG_CHANNEL_ID = "1419418871986917446";    // ✅ ログチャンネルのID

module.exports = {
  // /ticket コマンドでパネルを送信
  async sendTicketPanel(interaction) {
    const button = new ButtonBuilder()
      .setCustomId("ticket_create")
      .setLabel("📩 査定チケットを作成")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.reply({
      content: "査定を希望する場合は、下のボタンを押してください。",
      components: [row],
    });
  },

  // ボタン処理
  async buttonHandler(interaction) {
    if (interaction.customId === "ticket_create") {
      const modal = new ModalBuilder()
        .setCustomId("ticket_modal")
        .setTitle("査定チケット");

      const reasonInput = new TextInputBuilder()
        .setCustomId("ticket_reason")
        .setLabel("査定内容を入力してください")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

      return interaction.showModal(modal);
    }

    if (interaction.customId === "ticket_close") {
      const channel = interaction.channel;
      const log = channel.guild.channels.cache.get(LOG_CHANNEL_ID);

      if (log) {
        await log.send(`🗑️ チケット **${channel.name}** を ${interaction.user} が閉じました。`);
      }

      return channel.delete("Ticket closed");
    }
  },

  // モーダル送信処理
  async modalHandler(interaction) {
    if (interaction.customId !== "ticket_modal") return;

    const reason = interaction.fields.getTextInputValue("ticket_reason");

    // ✅ カテゴリ確認
    const category = interaction.guild.channels.cache.get(TICKET_CATEGORY_ID);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.reply({
        content: "❌ チケットカテゴリが見つかりません。",
        ephemeral: true,
      });
    }

    // ✅ チャンネル作成
    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
        {
          id: interaction.guild.roles.highest.id, // 管理者ロール
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
    });

    // ✅ 閉じるボタン
    const closeButton = new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("❌ チケットを閉じる")
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(closeButton);

    // ✅ チケット内容をそのまま送信
    await channel.send({
      content: `🎫 ${interaction.user} がチケットを作成しました。\n**内容:**\n${reason}`,
      components: [row],
    });

    // ✅ ログに通知
    const log = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (log) {
      await log.send(`📩 ${interaction.user} がチケットを作成しました。\n内容: ${reason}`);
    }

    await interaction.reply({
      content: `✅ チケットを作成しました: ${channel}`,
      ephemeral: true,
    });
  },
};