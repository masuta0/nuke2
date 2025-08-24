// commands/verify.js

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const userCodes = new Map(); // ユーザーごとの認証コードを保存
const VERIFY_ROLE_ID_MAP = new Map(); // サーバーIDとロールIDを紐づけて保存

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

    // 認証ロールのIDを保存
    VERIFY_ROLE_ID_MAP.set(interaction.guild.id, role.id);
    console.log(`✅ サーバー ${interaction.guild.name} の認証ロールを ${role.name} に設定しました。`);

    const verifyEmbed = new EmbedBuilder()
      .setTitle('🛡️ サーバー認証')
      .setDescription(`サーバーに参加するには、「認証する」ボタンを押し、DMで送られたコードを入力してください。\n認証後は、**${role.name}** ロールが付与されます。`)
      .setColor('Blue');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_button')
        .setLabel('認証する')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ embeds: [verifyEmbed], components: [row] });
  },

  async buttonHandler(interaction, client) {
    if (interaction.customId === 'verify_button') {
      const code = generateCode();
      userCodes.set(interaction.user.id, code);

      const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('認証コード入力');

      const codeInput = new TextInputBuilder()
        .setCustomId('verify_code_input')
        .setLabel('DMで送られた6文字コードを入力してください')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const dmPromptInput = new TextInputBuilder()
        .setCustomId('verify_code_prompt')
        .setLabel(`🔐 DMに送信されたコード（${code}）をここに貼り付け`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const firstRow = new ActionRowBuilder().addComponents(codeInput);
      const secondRow = new ActionRowBuilder().addComponents(dmPromptInput);
      modal.addComponents(firstRow, secondRow);

      await interaction.showModal(modal);
    }
  },

  async modalHandler(interaction, client) {
    if (interaction.customId === 'verify_modal') {
      const inputCode = interaction.fields.getTextInputValue('verify_code_input');
      const correctCode = userCodes.get(interaction.user.id);

      if (inputCode === correctCode) {
        const roleId = VERIFY_ROLE_ID_MAP.get(interaction.guild.id);
        if (!roleId) {
          return interaction.reply({ content: '❌ 認証ロールが設定されていません。管理者に連絡してください。', ephemeral: true });
        }

        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          await member.roles.add(roleId);
          userCodes.delete(interaction.user.id);

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
