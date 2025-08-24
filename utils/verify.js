// commands/verify.js

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const userCodes = new Map();
const VERIFY_DATA_PATH = path.join(__dirname, '../data/verifyData.json');

async function saveVerifyData(data) {
  try {
    const dataDir = path.dirname(VERIFY_DATA_PATH);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(VERIFY_DATA_PATH, JSON.stringify(data, null, 2));
    console.log('✅ 認証データを正常に保存しました:', data); // デバッグログ
  } catch (err) {
    console.error('❌ 認証データの保存に失敗しました:', err); // デバッグログ
  }
}

async function loadVerifyData() {
  try {
    const data = await fs.readFile(VERIFY_DATA_PATH, 'utf8');
    const parsedData = JSON.parse(data);
    console.log('✅ 認証データを正常に読み込みました:', parsedData); // デバッグログ
    return parsedData;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('⚠️ 認証データファイルが見つかりません。'); // デバッグログ
      return {};
    }
    console.error('❌ 認証データの読み込みに失敗しました:', err); // デバッグログ
    return {};
  }
}

async function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function createVerifyMessageEmbedAndComponents(roleName) {
  const verifyEmbed = new EmbedBuilder()
    .setTitle('🛡️ サーバー認証')
    .setDescription(`サーバーに参加するには、「認証する」ボタンを押し、表示されるコードを入力してください。\n認証後は、**${roleName}** ロールが付与されます。`)
    .setColor('Blue');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify_button')
      .setLabel('認証する')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [verifyEmbed], components: [row] };
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
    const channelId = interaction.channel.id;
    const guildId = interaction.guild.id;

    await saveVerifyData({ channelId, roleId, guildId });
    console.log(`✅ サーバー ${interaction.guild.name} の認証設定を保存しました。`);

    const messagePayload = await createVerifyMessageEmbedAndComponents(role.name);
    await interaction.reply(messagePayload);
  },

  async buttonHandler(interaction) {
    if (interaction.customId === 'verify_button') {
      const code = await generateCode();
      userCodes.set(interaction.user.id, code);

      const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('認証コード入力');

      const codeInput = new TextInputBuilder()
        .setCustomId('verify_input')
        .setLabel(`表示されたコード: ${code}`)
        .setPlaceholder('コードを手動で入力してください')
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
        const verifyData = await loadVerifyData();
        const roleId = verifyData.roleId;

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
  },

  async restoreVerifyMessage(client) {
    const verifyData = await loadVerifyData();
    if (verifyData && verifyData.channelId && verifyData.guildId) {
      try {
        const guild = await client.guilds.fetch(verifyData.guildId);
        const channel = await guild.channels.fetch(verifyData.channelId);
        const role = await guild.roles.fetch(verifyData.roleId);

        if (channel && channel.isTextBased() && role) {
          const messages = await channel.messages.fetch({ limit: 100 });
          const oldBotMessage = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === '🛡️ サーバー認証');
          if (oldBotMessage) {
            await oldBotMessage.delete().catch(() => {});
          }

          const messagePayload = await createVerifyMessageEmbedAndComponents(role.name);
          await channel.send(messagePayload);
          console.log('✅ 認証メッセージを自動再設置しました。');
        }
      } catch (err) {
        console.error('❌ 認証メッセージの自動再設置に失敗しました:', err);
      }
    }
  },
};
