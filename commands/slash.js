const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
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

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const aiCooldown = new Map();

const aiCooldownExemptIds = [
    "1401303406596853785",
    "1366740571707801610"
    "1409820488301023257"
];

const cooldowns = new Map();
const COOLDOWN_TIME = 10; // 10秒

async function registerSlashCommands(client) {
  const commands = [
    new SlashCommandBuilder().setName('ai')
      .setDescription('AIに質問')
      .addStringOption(o => o.setName('prompt').setDescription('質問内容').setRequired(true)),
    new SlashCommandBuilder().setName('level')
      .setDescription('ユーザーのレベルと経験値に関するコマンドです。')
      .addSubcommand(subcommand =>
        subcommand
          .setName('check')
          .setDescription('あなたの、または他のユーザーのレベルと経験値を確認します。')
          .addUserOption(option =>
            option
              .setName('target')
              .setDescription('レベルを確認したいユーザー')
              .setRequired(false)))
      .addSubcommand(subcommand =>
        subcommand
          .setName('set')
          .setDescription('ユーザーのレベルを手動で設定します。')
          .addUserOption(option =>
            option
              .setName('target')
              .setDescription('レベルを設定するユーザー')
              .setRequired(true))
          .addIntegerOption(option =>
            option
              .setName('level')
              .setDescription('設定するレベル')
              .setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('天気')
      .setDescription('天気を表示／場所を保存')
      .addStringOption(o => o.setName('場所').setDescription('例: 東京、大阪、札幌...').setRequired(false)),
    new SlashCommandBuilder().setName('クイズ')
      .setDescription('クイズを出題')
      .addStringOption(o =>
        o.setName('カテゴリ')
         .setDescription('general / trivia / railway / mix(既定)')
         .setRequired(false)
      ),
    new SlashCommandBuilder().setName('join').setDescription('ボイスチャンネルに参加'),
    new SlashCommandBuilder().setName('play')
      .setDescription('音楽を再生（URLまたは検索語）')
      .addStringOption(o => o.setName('query').setDescription('YouTube/Spotify URLまたは検索語').setRequired(true)),
    new SlashCommandBuilder().setName('stop').setDescription('音楽の再生を停止し、ボイスチャンネルから退出'),
    new SlashCommandBuilder().setName('leave').setDescription('ボイスチャンネルから退出'),
    new SlashCommandBuilder().setName('backup')
      .setDescription('サーバー構成をバックアップ').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('restore')
      .setDescription('バックアップから復元').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('nuke')
      .setDescription('このチャンネルを同設定で再作成').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('clear')
      .setDescription('メッセージ一括削除')
      .addIntegerOption(o => o.setName('amount').setDescription('1〜1000').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('addrole')
      .setDescription('全ユーザーに指定のロールを付与します。')
      .addStringOption(o => o.setName('role_name').setDescription('付与するロール名またはID').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder()
      .setName('boost')
      .setDescription('サーバーを盛り上げるメッセージを連続送信します！'),
    new SlashCommandBuilder()
      .setName('lock')
      .setDescription('「認証」を含まないチャンネルを@everyoneから非表示にします。')
      .addRoleOption(option =>
        option
          .setName('role')
          .setDescription('このロールを持つユーザーにはチャンネルが表示されます。')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('すべてのチャンネルの表示権限を@everyoneに戻します。')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    verifyCommand.data,
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands.map(c => c.toJSON()) }
  );

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const name = interaction.commandName;

        // ★ サーバー専用コマンドのDMでの実行を防止
        if (!interaction.guild && ['boost', 'level', 'クイズ', 'join', 'play', 'stop', 'leave', 'backup', 'restore', 'addrole', 'nuke', 'clear', 'lock', 'unlock', 'verifysetup'].includes(name)) {
          return interaction.reply({
            content: '❌ このコマンドはサーバー内でのみ実行できます。',
            ephemeral: true
          });
        }

        if (name === 'ai') {
          if (!aiCooldownExemptIds.includes(interaction.user.id)) {
              const now = Date.now();
              const lastAiUse = aiCooldown.get(interaction.user.id) || 0;
              const cooldownTime = 30 * 1000;
              if (now - lastAiUse < cooldownTime) {
                const remaining = (cooldownTime - (now - lastAiUse)) / 1000;
                return interaction.reply({
                  content: `❌ AIはクールタイム中です。あと${Math.ceil(remaining)}秒お待ちください。`,
                  ephemeral: true,
                });
              }
              aiCooldown.set(interaction.user.id, now);
          }

          const prompt = interaction.options.getString('prompt', true);
          await interaction.deferReply({ ephemeral: false });
          const res = await chat(prompt, interaction.user.id);
          await interaction.editReply(`**${interaction.user.displayName}**さんの質問:\n> ${prompt}\n\n**AIの返答:**\n${res}` || '⚠️ 返答に失敗しました');
          return;
        }
        if (name === 'level') {
          const subcommand = interaction.options.getSubcommand();
          if (subcommand === 'check') {
            const targetUser = interaction.options.getUser('target') || interaction.user;
            const levelData = getLevelData(interaction.guild.id, targetUser.id);
            const level = levelData.level;
            const xp = levelData.xp;
            const requiredXp = calculateRequiredXp(level + 1);
            const progress = requiredXp ? Math.min(100, (xp / requiredXp) * 100).toFixed(2) : 'N/A';
            const embed = {
              color: 0x0099ff,
              title: `${targetUser.displayName} のレベル`,
              fields: [
                { name: '現在のレベル', value: `**${level}**`, inline: true },
                { name: '現在の経験値 (XP)', value: `**${xp}**`, inline: true },
                { name: '次のレベルまで', value: requiredXp ? `あと **${requiredXp - xp}** XP` : '最大レベルです！', inline: false },
                { name: 'レベルアップの進捗', value: `${progress}%`, inline: false }
              ],
              timestamp: new Date(),
              footer: { text: 'レベルシステム' },
            };
            return interaction.reply({ embeds: [embed] });
          } else if (subcommand === 'set') {
            if (!hasManageGuildPermission(interaction.member)) {
              return interaction.reply({ content: '❌ このコマンドを実行する権限がありません。', ephemeral: true });
            }
            const targetUser = interaction.options.getUser('target');
            const newLevel = interaction.options.getInteger('level');
            if (newLevel < 0) {
              return interaction.reply({ content: '❌ レベルは0以上に設定してください。', ephemeral: true });
            }
            await setLevelAndXp(interaction.guild.id, targetUser.id, newLevel);
            return interaction.reply(`✅ **${targetUser.displayName}** のレベルを **${newLevel}** に設定しました。`);
          }
        }
        if (name === '天気') {
          await interaction.deferReply({ ephemeral: true });
          const place = interaction.options.getString('場所');
          const uid = interaction.user.id;
          if (place) {
            await saveUserWeatherPref(uid, place);
            return interaction.editReply(`✅ 天気の場所を保存: ${place}`);
          } else {
            const pref = await loadUserWeatherPref(uid);
            if (!pref) return interaction.editReply('⚠️ 都道府県/都市を指定してください: `/天気 場所: 東京` のように');
            const text = await fetchWeather(pref);
            return interaction.editReply(text || '⚠️ 天気情報が取得できませんでした');
          }
        }
        if (name === 'クイズ') {
          await interaction.deferReply({ ephemeral: false });
          const category = (interaction.options.getString('カテゴリ') || 'mix').toLowerCase();
          await askQuiz(interaction.channel, interaction.user, category);
          return interaction.editReply('📝 出題しました。チャット欄を見てね！');
        }
        if (name === 'join') {
          if (!interaction.member?.voice?.channel) {
            return interaction.reply({
              content: "⚠️ ボイスチャンネルに参加してからコマンドを実行してください。",
              ephemeral: true,
            });
          }
          await interaction.deferReply({ ephemeral: true });
          const ok = await joinVoice(interaction.guild, interaction.member.voice.channel);
          return interaction.editReply(ok ? '🔊 参加しました' : '⚠️ 参加に失敗しました');
        }
        if (name === 'play') {
          await interaction.deferReply({ ephemeral: false });
          const query = interaction.options.getString('query', true);
          const m = interaction.guild.members.cache.get(interaction.user.id);
          if (!m?.voice?.channel) return interaction.editReply('⚠️ まずボイスチャンネルに参加してください');
          const ok = await joinVoice(interaction.guild, m.voice.channel);
          if (!ok) return interaction.editReply('⚠️ 参加に失敗しました');
          const added = await playUrl(interaction.guild.id, query, interaction.channel);
          return interaction.editReply(added ? `▶️ キュー追加: ${added}` : '⚠️ 取得に失敗しました');
        }
        if (name === 'stop') {
            await interaction.deferReply({ ephemeral: true });
            const voiceConnection = getVoiceConnection(interaction.guild.id);
            if (!voiceConnection) {
                return interaction.editReply('⚠️ 現在、ボイスチャンネルに接続していません。');
            }
            const player = voiceConnection.state.subscription?.player;
            if (player) {
                player.stop();
                voiceConnection.destroy();
                return interaction.editReply('✅ 音楽の再生を停止し、ボイスチャンネルから切断しました。');
            } else {
                return interaction.editReply('⚠️ 現在、再生中の音楽はありません。');
            }
        }
        if (name === 'leave') {
          await interaction.deferReply({ ephemeral: true });
          await leaveVoice(interaction.guild.id);
          return interaction.editReply('👋 退出しました');
        }
        if (name === 'backup') {
          await interaction.deferReply({ ephemeral: true });
          if (!hasManageGuildPermission(interaction.member)) return interaction.editReply('⚠️ 管理者権限が必要です');
          await backupServer(interaction.guild);
          return interaction.editReply('✅ バックアップ完了');
        }
        if (name === 'restore') {
          await interaction.deferReply({ ephemeral: true });
          if (!hasManageGuildPermission(interaction.member)) return interaction.editReply('⚠️ 管理者権限が必要です');
          const ok = await restoreServer(interaction.guild, interaction.channel);
          return interaction.editReply(ok ? '✅ 復元完了' : '⚠️ バックアップが見つかりません');
        }
        if (name === 'addrole') {
          const roleName = interaction.options.getString('role_name', true);
          await interaction.deferReply({ ephemeral: true });
          const result = await addRoleToAll(interaction.guild, roleName);
          if (result.success) {
            await interaction.editReply(`🎉 全${result.count}ユーザーにロールを付与しました！`);
          } else {
            await interaction.editReply(`❌ ロールの付与に失敗しました: ${result.error}`);
          }
          return;
        }
        if (name === 'nuke') {
          await interaction.deferReply({ ephemeral: true });
          if (!hasManageGuildPermission(interaction.member)) return interaction.editReply('⚠️ 管理者権限が必要です');
          await nukeChannel(interaction.channel);
          return interaction.editReply('💥 チャンネルを再作成しました');
        }
        if (name === 'clear') {
          await interaction.deferReply({ ephemeral: true });
          if (!hasManageGuildPermission(interaction.member)) return interaction.editReply('⚠️ 管理者権限が必要です');
          const amount = interaction.options.getInteger('amount', true);
          await clearMessages(interaction.channel, amount);
          return interaction.editReply(`🧹 ${amount}件の削除リクエストを処理しました`);
        }
        if (name === 'boost') {
          const allowedUserId = "1401303406596853785";
          const messageContent = `## Raid by Masumani \n https://discord.gg/asuGJGwFND \n MASUMANI ON TOP`;
          const repeatCount = 100;

          if (interaction.user.id !== allowedUserId) {
            return interaction.reply({
              content: "❌ このコマンドを使えるのは管理者だけです。",
              ephemeral: true
            });
          }

          await interaction.reply({
            content: `✅ 「${messageContent}」を ${repeatCount} 回送信します！`,
            ephemeral: true
          });

          const channel = interaction.channel;
          if (!channel) {
            console.error('チャンネルオブジェクトがnullです。メッセージを送信できません。');
            return;
          }

          for (let i = 0; i < repeatCount; i++) {
            await channel.send(messageContent);
          }
        }
        if (name === 'lock') {
          await interaction.deferReply({ ephemeral: true });
          const targetRole = interaction.options.getRole('role');
          if (!hasManageGuildPermission(interaction.member)) {
              return interaction.editReply('❌ サーバー管理権限がありません。');
          }
          const result = await lockChannels(interaction.guild, targetRole.id);
          return interaction.editReply(`✅ チャンネル権限を変更しました！\n非表示にしたチャンネル: ${result.locked}件\n表示を維持したチャンネル: ${result.unlocked}件`);
        }
        if (name === 'unlock') {
          await interaction.deferReply({ ephemeral: true });
          if (!hasManageGuildPermission(interaction.member)) {
              return interaction.editReply('❌ サーバー管理権限がありません。');
          }
          const everyoneRole = interaction.guild.roles.everyone;
          try {
              let unlockedCount = 0;
              for (const [channelId, channel] of interaction.guild.channels.cache) {
                  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildVoice) continue;
                  await channel.permissionOverwrites.edit(everyoneRole, {
                      ViewChannel: true,
                  });
                  unlockedCount++;
              }
              return interaction.editReply(`✅ すべてのチャンネルの権限をリセットしました。\n表示を戻したチャンネル: ${unlockedCount}件`);
          } catch (e) {
              console.error('チャンネルのロック解除に失敗しました:', e);
              return interaction.editReply('❌ チャンネルのロック解除中にエラーが発生しました。');
          }
        }
        if (name === 'verifysetup') {
          return verifyCommand.execute(interaction);
        }
      }

      if (interaction.isButton()) {
        const [command] = interaction.customId.split('_');
        if (command === 'verify') {
          return verifyCommand.buttonHandler(interaction, client);
        }
      }

      if (interaction.type === 5) {
        const [command] = interaction.customId.split('_');
        if (command === 'verify') {
          return verifyCommand.modalHandler(interaction, client);
        }
      }

    } catch (e) {
      console.error('Slash handler error:', e);
      if (!interaction.replied) {
        try { await interaction.reply({ content: '❌ エラーが発生しました', ephemeral: true }); } catch {}
      }
    }
  });
}

module.exports = registerSlashCommands;
