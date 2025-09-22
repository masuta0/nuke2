// slash.js
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const verifyCommand = require('../utils/verify');
const panelCommand = require('../utils/panel');
const ticketCommand = require('../utils/ticket');
const { chat } = require('../utils/ai');
const { saveUserWeatherPref, loadUserWeatherPref, fetchWeather } = require('../utils/weather');
const { joinVoice, playUrl, leaveVoice } = require('../utils/music');
const { getVoiceConnection } = require('@discordjs/voice');
const { askQuiz } = require('../utils/quiz');
const { getLevelData, setLevelAndXp, calculateRequiredXp } = require('../utils/level');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const aiCooldown = new Map();
const aiCooldownExemptIds = [
  "1401303406596853785",
  "1366740571707801610",
  "1409820488301023257"
];

async function registerSlashCommands(client) {
  // コマンドリスト
  const commands = [
    new SlashCommandBuilder().setName('ai').setDescription('AIに質問').addStringOption(o => o.setName('prompt').setDescription('質問内容').setRequired(true)),
    new SlashCommandBuilder().setName('天気').setDescription('天気を表示／場所を保存').addStringOption(o => o.setName('場所').setDescription('例: 東京').setRequired(false)),
    new SlashCommandBuilder().setName('クイズ').setDescription('クイズ出題').addStringOption(o => o.setName('カテゴリ').setDescription('general/trivia/mix').setRequired(false)),
    new SlashCommandBuilder().setName('join').setDescription('ボイス参加'),
    new SlashCommandBuilder().setName('play').setDescription('音楽再生').addStringOption(o => o.setName('query').setDescription('URL/検索').setRequired(true)),
    new SlashCommandBuilder().setName('stop').setDescription('音楽停止'),
    new SlashCommandBuilder().setName('leave').setDescription('ボイス退出'),
    new SlashCommandBuilder().setName('level')
      .setDescription('レベル確認/設定')
      .addSubcommand(sub => sub.setName('check').setDescription('レベル確認').addUserOption(o => o.setName('target').setDescription('ユーザー').setRequired(false)))
      .addSubcommand(sub => sub.setName('set').setDescription('レベル設定').addUserOption(o => o.setName('target').setDescription('ユーザー').setRequired(true)).addIntegerOption(o => o.setName('level').setDescription('レベル').setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    // verify/panel/ticketを安全に追加
    ...(Array.isArray(verifyCommand.data) ? verifyCommand.data : [verifyCommand.data] || []),
    ...(Array.isArray(panelCommand.data) ? panelCommand.data : [panelCommand.data] || []),
    ...(Array.isArray(ticketCommand.data) ? ticketCommand.data : [ticketCommand.data] || []),
  ].filter(Boolean); // undefined を除外

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });

  // interactionCreate
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const name = interaction.commandName;

        if (name === 'ai') {
          if (!aiCooldownExemptIds.includes(interaction.user.id)) {
            const now = Date.now();
            const last = aiCooldown.get(interaction.user.id) || 0;
            const cooldownTime = 30*1000;
            if (now - last < cooldownTime) return interaction.reply({ content: `AIはクールタイム中。あと${Math.ceil((cooldownTime-(now-last))/1000)}秒`, ephemeral: true });
            aiCooldown.set(interaction.user.id, now);
          }
          const prompt = interaction.options.getString('prompt', true);
          await interaction.deferReply();
          const res = await chat(prompt, interaction.user.id);
          return interaction.editReply(`**${interaction.user.username}**さんの質問:\n> ${prompt}\n\n**AIの返答:**\n${res}`);
        }

        if (name === '天気') {
          await interaction.deferReply({ ephemeral: true });
          const place = interaction.options.getString('場所');
          const uid = interaction.user.id;
          if (place) { await saveUserWeatherPref(uid, place); return interaction.editReply(`✅ 天気保存: ${place}`); }
          const pref = await loadUserWeatherPref(uid);
          if (!pref) return interaction.editReply('⚠️ 都道府県/都市を指定してください');
          const text = await fetchWeather(pref);
          return interaction.editReply(text || '⚠️ 天気情報取得失敗');
        }

        if (name === 'クイズ') {
          await interaction.deferReply();
          const cat = (interaction.options.getString('カテゴリ') || 'mix').toLowerCase();
          await askQuiz(interaction.channel, interaction.user, cat);
          return interaction.editReply('📝 出題完了');
        }

        if (name === 'join'){ if(!interaction.member?.voice?.channel) return interaction.reply({ content:'⚠️ VCに参加後実行', ephemeral:true }); await interaction.deferReply(); const ok=await joinVoice(interaction.guild,interaction.member.voice.channel); return interaction.editReply(ok?'🔊 参加':'⚠️ 失敗'); }
        if (name === 'play'){ await interaction.deferReply(); const query=interaction.options.getString('query',true); const m=interaction.guild.members.cache.get(interaction.user.id); if(!m?.voice?.channel) return interaction.editReply('⚠️ VCに参加してください'); const ok=await joinVoice(interaction.guild,m.voice.channel); if(!ok) return interaction.editReply('⚠️ 参加失敗'); const added=await playUrl(interaction.guild.id,query,interaction.channel); return interaction.editReply(added?`▶️ キュー追加: ${added}`:'⚠️ 取得失敗'); }
        if (name === 'stop'){ const vc=getVoiceConnection(interaction.guild.id); if(!vc) return interaction.editReply('⚠️ 接続なし'); const player=vc.state.subscription?.player; if(player){ player.stop(); vc.destroy(); return interaction.editReply('✅ 停止 & 切断'); }else return interaction.editReply('⚠️ 再生なし'); }
        if (name === 'leave'){ await leaveVoice(interaction.guild.id); return interaction.editReply('👋 退出'); }

        // verify/panel/ticket
        if (interaction.isButton()) {
          const [cmd] = interaction.customId.split('_');
          if (cmd==='verify') return verifyCommand.buttonHandler(interaction, client);
          if (cmd==='role') return panelCommand.buttonHandler(interaction);
          if (cmd==='ticket') return ticketCommand.buttonHandler(interaction);
        }

        if (name.startsWith('ticket')) return ticketCommand.execute(interaction);
        if (name.startsWith('verify')) return verifyCommand.execute(interaction);
        if (name.startsWith('rolepanel')) return panelCommand.execute(interaction);

      }
    } catch (e) {
      console.error('Slash handler error:', e);
      if (!interaction.replied) try { await interaction.reply({ content:'❌ エラー', ephemeral:true }); } catch {}
    }
  });
}

module.exports = registerSlashCommands;