// utils/ticket.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, PermissionsBitField } = require("discord.js");

// 設定
const TICKET_CATEGORY_NAME = "チケット";
const TICKET_LOG_CHANNEL = "123456789012345678"; // チケット履歴送信先チャンネルID
const TICKET_BUTTON_ID = "ticket_create";

// チケット作成パネルを送信
async function sendTicketPanel(interaction) {
  const button = new ButtonBuilder()
    .setCustomId(TICKET_BUTTON_ID)
    .setLabel("チケットを作成")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  const embed = new EmbedBuilder()
    .setTitle("チケット")
    .setDescription("以下のボタンを押すと、査定チケットが作成されます。")
    .setColor(0x00aaff);

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

// ボタン押下時の処理
async function buttonHandler(interaction) {
  if (interaction.customId !== TICKET_BUTTON_ID) return;

  // モーダル作成
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${interaction.user.id}`)
    .setTitle("チケット作成");

  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("査定内容")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("ここに査定して欲しい内容を入力してください。")
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(reasonInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

// モーダル送信時の処理
async function modalHandler(interaction) {
  if (!interaction.customId.startsWith("ticket_modal_")) return;

  const reason = interaction.fields.getTextInputValue("reason");

  // カテゴリ取得または作成
  let category = interaction.guild.channels.cache.find(c => c.name === TICKET_CATEGORY_NAME && c.type === 4);
  if (!category) {
    category = await interaction.guild.channels.create({
      name: TICKET_CATEGORY_NAME,
      type: 4, // Category
    });
  }

  // チケット用チャンネル作成
  const ticketChannel = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.username}`,
    type: 0, // Text
    parent: category.id,
    permissionOverwrites: [
      {
        id: interaction.guild.roles.everyone,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
      },
    ],
  });

  const embed = new EmbedBuilder()
    .setTitle("チケット作成")
    .setDescription(`ユーザー: ${interaction.user.tag}\n内容:\n${reason}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });

  // ログ送信
  const logChannel = interaction.guild.channels.cache.get(TICKET_LOG_CHANNEL);
  if (logChannel) {
    await logChannel.send({ embeds: [embed] });
  }

  await interaction.reply({ content: `✅ チケットが作成されました: ${ticketChannel}`, ephemeral: true });
}

module.exports = {
  sendTicketPanel,
  buttonHandler,
  modalHandler,
};