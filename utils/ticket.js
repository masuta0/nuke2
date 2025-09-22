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
      .setLabel("査定チケットを作成")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.reply({
      content: "査定したい場合は下のボタンからチケットを作成してください。",
      components: [row],
    });
  },

  // ボタンの処理
  async buttonHandler(interaction) {
    if (interaction.customId === "ticket_create") {
      // ✅ モーダル表示
      const modal = new ModalBuilder()
        .setCustomId("ticket_modal")
        .setTitle("査定チケット");

      const reasonInput = new TextInputBuilder()
        .setCustomId("ticket_reason")
        .setLabel("査定内容")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(reasonInput);
      modal.addComponents(row);

      return interaction.showModal(modal);
    }

    if (interaction.customId === "ticket_close") {
      // ✅ チケットを閉じる
      const channel = interaction.channel;
      const log = channel.guild.channels.cache.get(LOG_CHANNEL_ID);

      if (log) {
        await log.send(`🗑️ チケット **${channel.name}** を ${interaction.user} が閉じました。`);
      }

      return channel.delete("Ticket closed");
    }
  },

  // モーダル送信後の処理
  async modalHandler(interaction) {
    if (interaction.customId !== "ticket_modal") return;

    const reason = interaction.fields.getTextInputValue("ticket_reason");

    // ✅ カテゴリ取得
    const category = interaction.guild.channels.cache.get(TICKET_CATEGORY_ID);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.reply({ content: "❌ チケットカテゴリが見つかりません。", ephemeral: true });
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
          id: interaction.guild.roles.highest.id, // 管理者ロールをここに指定するなら変更
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

    await channel.send({
      content: `🎫 ${interaction.user} がチケットを作成しました。\n**内容:** ${reason}`,
      components: [row],
    });

    // ✅ ログに送信
    const log = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (log) {
      await log.send(`📩 ${interaction.user} がチケットを作成しました。\n内容: ${reason}`);
    }

    await interaction.reply({ content: `✅ チケットを作成しました: ${channel}`, ephemeral: true });
  },
};