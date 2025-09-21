const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const fs = require('fs');

const {
  hasManageGuildPermission,
  backupServer,
  restoreServer,
  nukeChannel,
  clearMessages,
  addRoleToAll,
  lockChannels,
} = require('../utils/guild');
const { chat } = require('../utils/ai');
const { saveUserWeatherPref, loadUserWeatherPref, fetchWeather } = require('../utils/weather');
const { joinVoice, playUrl, leaveVoice } = require('../utils/music');
const { getVoiceConnection } = require('@discordjs/voice');
const { askQuiz } = require('../utils/quiz');
const { getLevelData, setLevelAndXp, calculateRequiredXp } = require('../utils/level');
const verifyCommand = require('../utils/verify');
const panelCommand = require('../utils/panel');
const { createInvite, fetchInviteCount } = require('../utils/inviteManager');
const ticketSystem = require('../utils/ticket'); // ✅ チケットモジュール

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const aiCooldown = new Map();

const aiCooldownExemptIds = [
  "1401303406596853785",
  "1366740571707801610",
  "1409820488301023257"
];

// ----- スラッシュコマンド登録 -----
async function registerSlashCommands(client) {
  const commands = [
    // AI
    new SlashCommandBuilder()
      .setName('ai')
      .setDescription('AIに質問')
      .addStringOption(o => o.setName('prompt').setDescription('質問内容').setRequired(true)),

    // レベル
    new SlashCommandBuilder()
      .setName('level')
      .setDescription('ユーザーのレベルと経験値に関するコマンドです。')
      .addSubcommand(sub =>
        sub.setName('check').setDescription('レベルを確認')
          .addUserOption(option => option.setName('target').setDescription('ユーザー')))
      .addSubcommand(sub =>
        sub.setName('set').setDescription('レベルを設定')
          .addUserOption(option => option.setName('target').setDescription('ユーザー').setRequired(true))
          .addIntegerOption(option => option.setName('level').setDescription('レベル').setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    // 天気
    new SlashCommandBuilder().setName('天気').setDescription('天気を表示／場所を保存')
      .addStringOption(o => o.setName('場所').setDescription('例: 東京')),

    // クイズ
    new SlashCommandBuilder().setName('クイズ').setDescription('クイズ出題')
      .addStringOption(o => o.setName('カテゴリ').setDescription('general/trivia/mix')),

    // 音楽
    new SlashCommandBuilder().setName('join').setDescription('ボイス参加'),
    new SlashCommandBuilder().setName('play').setDescription('音楽再生')
      .addStringOption(o => o.setName('query').setDescription('URL/検索').setRequired(true)),
    new SlashCommandBuilder().setName('stop').setDescription('音楽停止'),
    new SlashCommandBuilder().setName('leave').setDescription('ボイス退出'),

    // サーバー管理
    new SlashCommandBuilder().setName('backup').setDescription('バックアップ')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('restore').setDescription('復元')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('nuke').setDescription('チャンネル再作成')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('clear').setDescription('メッセージ一括削除')
      .addIntegerOption(o => o.setName('amount').setDescription('1〜1000').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('addrole').setDescription('全ユーザーにロール付与')
      .addStringOption(o => o.setName('role_name').setDescription('ロール名/ID').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder().setName('boost').setDescription('連続メッセージ送信'),
    new SlashCommandBuilder().setName('lock').setDescription('チャンネル権限変更')
      .addRoleOption(o => o.setName('role').setDescription('対象ロール').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('unlock').setDescription('チャンネル権限リセット')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    // 招待リンク
    new SlashCommandBuilder().setName('invite').setDescription('招待リンク管理')
      .addSubcommand(sub => sub.setName('create').setDescription('作成'))
      .addSubcommand(sub => sub.setName('count').setDescription('招待人数確認')),

    // verify/rolepanel
    verifyCommand.data,
    ...panelCommand.data,

    // ✅ チケット
    ticketSystem.data
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });

  // ----- interactionCreate -----
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const name = interaction.commandName;

        // ✅ チケット
        if (name === 'ticket') return ticketSystem.execute(interaction);

        // AI
        if (name === 'ai') {
          if (!aiCooldownExemptIds.includes(interaction.user.id)) {
            const now = Date.now();
            const last = aiCooldown.get(interaction.user.id) || 0;
            const cooldownTime = 30 * 1000;
            if (now - last < cooldownTime)
              return interaction.reply({ content: `AIはクールタイム中。あと${Math.ceil((cooldownTime - (now - last)) / 1000)}秒`, ephemeral: true });
            aiCooldown.set(interaction.user.id, now);
          }
          const prompt = interaction.options.getString('prompt', true);
          await interaction.deferReply();
          const res = await chat(prompt, interaction.user.id);
          return interaction.editReply(`**${interaction.user.username}**さんの質問:\n> ${prompt}\n\n**AIの返答:**\n${res}`);
        }

        // (省略: 天気 / レベル / クイズ / 音楽 / サーバー管理 / 招待リンク / verify / rolepanel)
        // ※ あなたの元コードをそのまま残してください
      }

      // ----- ボタン -----
      if (interaction.isButton()) {
        if (interaction.customId.startsWith('ticket')) return ticketSystem.buttonHandler(interaction);
        if (interaction.customId.startsWith('verify')) return verifyCommand.buttonHandler(interaction, client);
        if (interaction.customId.startsWith('role')) return panelCommand.buttonHandler(interaction);
      }

      // ----- モーダル -----
      if (interaction.type === 5) {
        if (interaction.customId.startsWith('verify')) return verifyCommand.modalHandler(interaction, client);
      }

    } catch (e) {
      console.error('Slash handler error:', e);
      if (!interaction.replied) {
        try { await interaction.reply({ content: '❌ エラー', ephemeral: true }); } catch { }
      }
    }
  });
}

module.exports = registerSlashCommands;