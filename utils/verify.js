// commands/verify.js

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises; // ローカルファイルは不要だが、一部ロジックのために残す
const path = require('path');
const { uploadToDropbox, downloadFromDropbox, ensureFolder } = require('../utils/storage');

const userCodes = new Map();
const DROPBOX_VERIFY_DATA_PATH = '/bot_data/verifyData.json';

async function saveVerifyData(data) {
  try {
    // Dropboxに認証データをアップロード
    const success = await uploadToDropbox(DROPBOX_VERIFY_DATA_PATH, JSON.stringify(data, null, 2));
    if (success) {
      console.log('✅ 認証データをDropboxに正常に保存しました:', data);
    } else {
      console.error('❌ 認証データのDropboxへの保存に失敗しました。');
    }
  } catch (err) {
    console.error('❌ 認証データの保存中にエラーが発生しました:', err);
  }
}

async function loadVerifyData() {
  try {
    // Dropboxから認証データをダウンロード
    const data = await downloadFromDropbox(DROPBOX_VERIFY_DATA_PATH);
    if (data) {
      const parsedData = JSON.parse(data);
      console.log('✅ 認証データをDropboxから正常に読み込みました:', parsedData);
      return parsedData;
    }
    console.log('⚠️ 認証データがDropboxに見つかりません。');
    return {};
  } catch (err) {
    console.error('❌ 認証データの読み込み中にエラーが発生しました:', err);
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
        .setLabel('表示されたコード: ' + code)
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
