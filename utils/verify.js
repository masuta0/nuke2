// commands/verify.js

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

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
    .setDescription('認証メッセージを設置します (管理者用)')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('認証後に付与するロール')
        .setRequired(true)
    ),

  async execute(interaction) {
    const role = interaction.options.getRole('role');

    const verifyEmbed = new EmbedBuilder()
      .setTitle('🛡️ サーバー認証')
      .setDescription(`サーバーに参加するには、「認証する」ボタンを押し、DMで送られたコードを入力してください。\n認証後は、**${role.name}** ロールが付与されます。`)
      .setColor('Blue');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verify_button_${role.id}`) // ロールIDをカスタムIDに含める
        .setLabel('認証する')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ embeds: [verifyEmbed], components: [row] });
  },

  async buttonHandler(interaction) {
    const [command, roleId] = interaction.customId.split('_');

    if (command === 'verify' && roleId === 'button') { // `verify_button_<roleId>` の形式で判断
      // ユーザーにコードが未発行なら発行してDM送信
      if (!userCodes.has(interaction.user.id)) {
        const code = generateCode();
        userCodes.set(interaction.user.id, { code, roleId }); // ロールIDも一緒に保存

        try {
          await interaction.user.send(`🔐 認証コード: **${code}**\nサーバーで入力してください！`);
        } catch (err) {
          return interaction.reply({ content: '❌ DMを送れませんでした。DMを解放してください。', ephemeral: true });
        }
      }

      // モーダル作成
      const modal = new ModalBuilder()
        .setCustomId(`verify_modal_${roleId}`) // ロールIDをカスタムIDに含める
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

  async modalHandler(interaction) {
    const [command, roleId] = interaction.customId.split('_');

    if (command === 'verify' && roleId === 'modal') { // `verify_modal_<roleId>` の形式で判断
      const input = interaction.fields.getTextInputValue('verify_input');
      const userData = userCodes.get(interaction.user.id);

      if (!userData) {
        return interaction.reply({ content: '❌ 認証コードが発行されていません。もう一度ボタンを押してください。', ephemeral: true });
      }

      if (input === userData.code) {
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          await member.roles.add(userData.roleId);
          userCodes.delete(interaction.user.id); // 1回限り

          await interaction.reply({ content: '✅ 認証に成功しました！ロールを付与しました。', ephemeral: true });
        } catch (err) {
          console.error('ロール付与に失敗しました:', err);
          await interaction.reply({ content: '❌ ロールの付与に失敗しました。ボットの権限を確認してください。', ephemeral: true });
        }
      } else {
        await interaction.reply({ content: '❌ 認証コードが間違っています。', ephemeral: true });
      }
    }
  }
};
