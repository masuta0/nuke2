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
        .setCustomId('verify_button') // 修正: ロールIDをカスタムIDから削除
        .setLabel('認証する')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ embeds: [verifyEmbed], components: [row] });
  },

  async buttonHandler(interaction, client) {
    if (interaction.customId === 'verify_button') {
      const code = generateCode();
      userCodes.set(interaction.user.id, code);

      try {
        await interaction.user.send(`🔐 認証コード: **${code}**\nこのコードをサーバーの認証モーダルに入力してください。`);
      } catch (err) {
        return interaction.reply({ content: '❌ DMを送れませんでした。DM設定を「フレンドとサーバーメンバーから許可」にしてください。', ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('認証コード入力');

      const input = new TextInputBuilder()
        .setCustomId('verify_input')
        .setLabel('DMで送られたコードを入力してください')
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
        // ロールIDを verifysetup コマンドから動的に取得する方法は slash.js で実装する必要があります。
        // ここでは仮にハードコードされたロールIDを使用します。
        // もしくは、verifysetup コマンドでロールIDを外部に保存するロジックが必要です。
        const roleId = 'ロールIDをここに'; // ここを適切なロールIDに書き換えてください
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
