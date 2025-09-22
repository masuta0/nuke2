const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const TICKET_LOG_CHANNEL_ID = '1419418871986917446';

const ticketCommand = {
  data: {
    name: 'ticket',
    description: 'サポートチケットを作成します',
  },

  async execute(interaction) {
    // ボタンを送信
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel('チケットを開く')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ content: 'チケットを開きたい場合ボタンを押してください。', components: [row], ephemeral: true });
  },

  async buttonHandler(interaction) {
    if (interaction.customId !== 'ticket_open') return;

    const logChannel = interaction.guild.channels.cache.get(TICKET_LOG_CHANNEL_ID);
    if (!logChannel) return interaction.reply({ content: '⚠️ ログチャンネルが見つかりません', ephemeral: true });

    // 管理用ログに送信
    await logChannel.send(`📩 ${interaction.user.tag} がチケットを開きました`);

    // ユーザーに確認メッセージ
    await interaction.reply({ content: '✅ チケットを受付けました。管理者から連絡があります。', ephemeral: true });
  }
};

module.exports = ticketCommand;