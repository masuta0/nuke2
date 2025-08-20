// commands/slash.js
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { hasManageGuildPermission, backupServer, restoreServer, nukeChannel, clearMessages } = require('../utils/guild');
const { chat } = require('../utils/ai');
const { saveUserWeatherPref, loadUserWeatherPref, fetchWeather } = require('../utils/weather');
const { joinVoice, playUrl, leaveVoice } = require('../utils/music');
const { getVoiceConnection } = require('@discordjs/voice');
const { askQuiz } = require('../utils/quiz');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ★ AI専用のクールダウンマップを定義
const aiCooldown = new Map();

async function registerSlashCommands(client) {
  const commands = [
    new SlashCommandBuilder().setName('ai')
      .setDescription('AIに質問')
      .addStringOption(o => o.setName('prompt').setDescription('質問内容').setRequired(true)),

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
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands.map(c => c.toJSON()) }
  );

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      const name = interaction.commandName;

      if (name === 'ai') {
        // ★ AIチャットのクールダウンチェック
        const now = Date.now();
        const lastAiUse = aiCooldown.get(interaction.user.id) || 0;
        const cooldownTime = 30 * 1000; // 30秒

        if (now - lastAiUse < cooldownTime) {
          const remaining = (cooldownTime - (now - lastAiUse)) / 1000;
          return interaction.reply({
            content: `❌ AIはクールタイム中です。あと${Math.ceil(remaining)}秒お待ちください。`,
            ephemeral: true,
          });
        }

        const prompt = interaction.options.getString('prompt', true);
        await interaction.deferReply({ ephemeral: true });

        // ★ クールタイムを更新
        aiCooldown.set(interaction.user.id, now);

        const res = await chat(prompt, interaction.user.id);
        return interaction.editReply(res || '⚠️ 返答に失敗しました');
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
        await interaction.deferReply({ ephemeral: true });
        const m = interaction.guild.members.cache.get(interaction.user.id);
        if (!m?.voice?.channel) return interaction.editReply('⚠️ まずボイスチャンネルに参加してください');
        const ok = await joinVoice(interaction.guild, m.voice.channel);
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

    } catch (e) {
      console.error('Slash handler error:', e);
      if (!interaction.replied) {
        try { await interaction.reply({ content: '❌ エラーが発生しました', ephemeral: true }); } catch {}
      }
    }
  });
}

module.exports = registerSlashCommands;
