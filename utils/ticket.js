// utils/ticket.js
const { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const LOG_CHANNEL_ID = '1419418871986917446'; // ログ用チャンネルID

module.exports = {
  // /ticket コマンドで実行
  async sendTicketPanel(interaction) {
    if (!interaction.guild) return interaction.reply({ content: "サーバー内でのみ使用可能", ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_create")
        .setLabel("チケットを作成")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ content: "査定", components: [row] });
  },

  // ボタン押下時
  async buttonHandler(interaction) {
    if (interaction.customId === "ticket_create") {
      const guild = interaction.guild;
      const user = interaction.user;

      // すでにユーザー用チャンネルがあるか確認
      const existing = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase()}`);
      if (existing) {
        return interaction.reply({ content: `すでにチケットが存在します: ${existing}`, ephemeral: true });
      }

      // チケット用チャンネル作成
      const channel = await guild.channels.create({
        name: `ticket-${user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          },
          {
            id: guild.members.me.roles.highest, // Bot自身
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
          },
        ],
      });

      // チケットチャンネルに案内を送信
      await channel.send(`🎟️ ${user} さんのチケットが作成されました。スタッフが対応します。`);

      // 応答
      await interaction.reply({ content: `チケットを作成しました: ${channel}`, ephemeral: true });

      // ログチャンネルに通知
      if (LOG_CHANNEL_ID) {
        const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
          await logChannel.send(`📩 ${user.tag} が新しいチケットを作成しました → ${channel}`);
        }
      }
    }
  },
};