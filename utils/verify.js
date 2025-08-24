const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType } = require('discord.js');

const userCodes = new Map(); // ユーザーごとの認証コードを保存

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifysetup')
    .setDescription('認証メッセージを設置します (管理者用)'), // 管理者が使う

  async execute(interaction) {
    const verifyEmbed = new EmbedBuilder()
      .setTitle('🛡️ サーバー認証')
      .setDescription('「認証する」ボタンを押して、DMで送られたコードを入力してください。')
      .setColor('Blue');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_button')
        .setLabel('認証する')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ embeds: [verifyEmbed], components: [row] });
  },

  // ボタン & モーダル処理はここ
  async buttonHandler(interaction, client) {
    if (interaction.customId === 'verify_button') {
      // ユーザーにコードが未発行なら発行してDM送信
      if (!userCodes.has(interaction.user.id)) {
        const code = generateCode();
        userCodes.set(interaction.user.id, code);

        try {
          await interaction.user.send(`🔐 認証コード: **${code}**\nサーバーで入力してください！`);
        } catch (err) {
          return interaction.reply({ content: '❌ DMを送れませんでした。DMを解放してください。', ephemeral: true });
        }
      }

      // モーダル作成
      const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('認証コード入力');

      const input = new TextInputBuilder()
        .setCustomId('verify_input')
        .setLabel('DMで送られた6文字コードを入力してください')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
    }
  },

  async modalHandler(interaction, client) {
    if (interaction.customId === 'verify_modal') {
      const input = interaction.fields.getTextInputValue('verify_input');
      const correctCode = userCodes.get(interaction.user.id);

      if (input === correctCode) {
        const roleId = '<<<ここに認証後に付与するロールID>>>';
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.add(roleId);

        userCodes.delete(interaction.user.id); // 1回限り

        await interaction.reply({ content: '✅ 認証に成功しました！ロールを付与しました。', ephemeral: true });
      } else {
        await interaction.reply({ content: '❌ 認証コードが間違っています。', ephemeral: true });
      }
    }
  }
};