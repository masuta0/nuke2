// utils/ticket.js
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder,
} = require("discord.js");
const fs = require("fs").promises;

const TICKET_CATEGORY_ID = "1419438659433795673"; // チケットカテゴリID
const LOG_CHANNEL_ID = "1419418871986917446";    // ログチャンネルID

module.exports = {
  // /ticket コマンドでパネル送信
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

  // ボタン処理
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

      // スタッフロール選択用メニュー
      const staffSelect = new RoleSelectMenuBuilder()
        .setCustomId("ticket_staff")
        .setPlaceholder("チケットを管理するスタッフロールを選択")
        .setRequired(true);

      const row1 = new ActionRowBuilder().addComponents(reasonInput);
      const row2 = new ActionRowBuilder().addComponents(staffSelect);
      modal.addComponents(row1, row2);

      return interaction.showModal(modal);
    }

    if (interaction.customId === "ticket_close") {
      const channel = interaction.channel;
      const log = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

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
    const staffRole = interaction.fields.getRole("ticket_staff"); // 選択されたスタッフロール

    // カテゴリ取得
    const category = interaction.guild.channels.cache.get(TICKET_CATEGORY_ID);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return interaction.reply({ content: "❌ チケットカテゴリが見つかりません。", ephemeral: true });
    }

    // チャンネル作成
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
          id: staffRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
    });

    // 閉じるボタン
    const closeButton = new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("❌ チケットを閉じる")
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(closeButton);

    // チャンネル内に送信
    await channel.send({
      content: `🎫 ${interaction.user} がチケットを作成しました。\n**内容:** ${reason}`,
      components: [row],
    });

    // ログ.txt作成
    const logText = `チケット作成者: ${interaction.user.tag}\n内容:\n${reason}\nスタッフロール: ${staffRole.name}`;
    const buffer = Buffer.from(logText, "utf-8");
    const attachment = new AttachmentBuilder(buffer, { name: `ticket-${interaction.user.username}.txt` });

    const log = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (log) await log.send({ content: `📩 新しいチケット作成`, files: [attachment] });

    await interaction.reply({ content: `✅ チケットを作成しました: ${channel}`, ephemeral: true });
  },
};