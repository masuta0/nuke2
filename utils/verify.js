// commands/verify.js

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');

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
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const role = interaction.options.getRole('role');
    const roleId = role.id;

    VERIFY_ROLE_ID_MAP.set(interaction.guild.id, roleId);
    console.log(`✅ サーバー ${interaction.guild.name} の認証ロールを ${role.name} に設定しました。`);

    const verifyEmbed = new EmbedBuilder()
      .setTitle('🛡️ サーバー認証')
      .setDescription(`サーバーに参加するには、「認証する」ボタンを押し、表示されるコードを入力してください。\n認証後は、**${role.name}** ロールが付与されます。`)
      .setColor('Blue');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_button')
        .setLabel('認証する')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ embeds: [verifyEmbed], components: [row] });
  },

  async buttonHandler(interaction) {
    if (interaction.customId === 'verify_button') {
      const code = generateCode();
      userCodes.set(interaction.user.id, code);

      const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('認証コード入力');

      const codeInput = new TextInputBuilder()
        .setCustomId('verify_input')
        .setLabel(`表示されたコード: ${code}`) // 修正: コードをラベルに表示
        .setPlaceholder('コードを手動で入力してください') // 修正: プレースホルダーを追加
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(codeInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
    }
  },

  async modalHandler(interaction) {
    if (interaction.customId === 'verify_modal') {
      const inputCode = interaction.fields.getTextInputValue('verify_input');
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
