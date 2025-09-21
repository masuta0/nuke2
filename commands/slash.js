// registerSlashCommands.js
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
const ticketSystem = require('./ticketSystem');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const aiCooldown = new Map();

const aiCooldownExemptIds = [
  "1401303406596853785",
  "1366740571707801610",
  "1409820488301023257"
];

// ----- チケット管理 -----
const STAFF_ROLE_IDS = [
  '1419417500579528958',
  '1409196340780466367',
  '1414515772352495687',
  '1411968646649217024',
  '1405192800919883776'
];
const TICKET_LOG_CHANNEL_ID = '1419418871986917446';
const activeTickets = new Map(); // ユーザーID -> チャンネルID
// ----- スラッシュコマンド登録 -----
async function registerSlashCommands(client) {
  const commands = [
    // AI
    new SlashCommandBuilder().setName('ai').setDescription('AIに質問').addStringOption(o => o.setName('prompt').setDescription('質問内容').setRequired(true)),
    // レベル
    new SlashCommandBuilder().setName('level')
      .setDescription('ユーザーのレベルと経験値に関するコマンドです。')
      .addSubcommand(subcommand =>
        subcommand.setName('check').setDescription('レベルを確認').addUserOption(option => option.setName('target').setDescription('ユーザー').setRequired(false)))
      .addSubcommand(subcommand =>
        subcommand.setName('set').setDescription('レベルを設定').addUserOption(option => option.setName('target').setDescription('ユーザー').setRequired(true)).addIntegerOption(option => option.setName('level').setDescription('レベル').setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    // 天気
    new SlashCommandBuilder().setName('天気').setDescription('天気を表示／場所を保存').addStringOption(o => o.setName('場所').setDescription('例: 東京').setRequired(false)),
    // クイズ
    new SlashCommandBuilder().setName('クイズ').setDescription('クイズ出題').addStringOption(o => o.setName('カテゴリ').setDescription('general/trivia/mix').setRequired(false)),
    // 音楽系
    new SlashCommandBuilder().setName('join').setDescription('ボイス参加'),
    new SlashCommandBuilder().setName('play').setDescription('音楽再生').addStringOption(o => o.setName('query').setDescription('URL/検索').setRequired(true)),
    new SlashCommandBuilder().setName('stop').setDescription('音楽停止'),
    new SlashCommandBuilder().setName('leave').setDescription('ボイス退出'),
    // サーバー操作
    new SlashCommandBuilder().setName('backup').setDescription('バックアップ').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('restore').setDescription('復元').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('nuke').setDescription('チャンネル再作成').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('clear').setDescription('メッセージ一括削除').addIntegerOption(o => o.setName('amount').setDescription('1〜1000').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('addrole').setDescription('全ユーザーにロール付与').addStringOption(o => o.setName('role_name').setDescription('ロール名/ID').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder().setName('boost').setDescription('連続メッセージ送信'),
    new SlashCommandBuilder().setName('lock').setDescription('チャンネル権限変更').addRoleOption(o => o.setName('role').setDescription('対象ロール').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('unlock').setDescription('チャンネル権限リセット').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    // 招待リンク
    new SlashCommandBuilder().setName('invite').setDescription('招待リンク管理')
      .addSubcommand(sub => sub.setName('create').setDescription('作成'))
      .addSubcommand(sub => sub.setName('count').setDescription('招待人数確認')),
    // verify/rolepanel
    verifyCommand.data,
    ...panelCommand.data,
    // チケット
    ticketCommand.data
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });

  // ----- interactionCreate -----
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const name = interaction.commandName;

        if (name === 'ticket') return ticketCommand.execute(interaction);

        // AI
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

        // 天気
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

        // level
        if (name === 'level') {
          const sub = interaction.options.getSubcommand();
          if (sub === 'check') {
            const target = interaction.options.getUser('target') || interaction.user;
            const data = getLevelData(interaction.guild.id, target.id);
            const requiredXp = calculateRequiredXp(data.level+1);
            const progress = requiredXp ? Math.min(100,(data.xp/requiredXp)*100).toFixed(2):'N/A';
            const embed = { color:0x0099ff, title:`${target.username} のレベル`, fields:[
              { name:'現在のレベル', value:`**${data.level}**`, inline:true },
              { name:'現在のXP', value:`**${data.xp}**`, inline:true },
              { name:'次のレベルまで', value: requiredXp?`あと **${requiredXp-data.xp}** XP`:'最大レベル', inline:false },
              { name:'進捗', value:`${progress}%`, inline:false }
            ], timestamp:new Date(), footer:{ text:'レベルシステム' } };
            return interaction.reply({ embeds:[embed] });
          } else if (sub === 'set') {
            if (!hasManageGuildPermission(interaction.member)) return interaction.reply({ content:'❌ 権限なし', ephemeral:true });
            const target = interaction.options.getUser('target');
            const newLevel = interaction.options.getInteger('level');
            if (newLevel<0) return interaction.reply({ content:'❌ 0以上に設定してください', ephemeral:true });
            await setLevelAndXp(interaction.guild.id,target.id,newLevel);
            return interaction.reply(`✅ ${target.username} のレベルを ${newLevel} に設定`);
          }
        }

        // クイズ
        if (name==='クイズ') {
          await interaction.deferReply();
          const cat = (interaction.options.getString('カテゴリ')||'mix').toLowerCase();
          await askQuiz(interaction.channel, interaction.user, cat);
          return interaction.editReply('📝 出題完了');
        }

        // 音楽系
        if (name==='join'){ if(!interaction.member?.voice?.channel) return interaction.reply({ content:'⚠️ VCに参加後実行', ephemeral:true }); await interaction.deferReply(); const ok=await joinVoice(interaction.guild,interaction.member.voice.channel); return interaction.editReply(ok?'🔊 参加':'⚠️ 失敗'); }
        if (name==='play'){ await interaction.deferReply(); const query=interaction.options.getString('query',true); const m=interaction.guild.members.cache.get(interaction.user.id); if(!m?.voice?.channel) return interaction.editReply('⚠️ VCに参加してください'); const ok=await joinVoice(interaction.guild,m.voice.channel); if(!ok) return interaction.editReply('⚠️ 参加失敗'); const added=await playUrl(interaction.guild.id,query,interaction.channel); return interaction.editReply(added?`▶️ キュー追加: ${added}`:'⚠️ 取得失敗'); }
        if (name==='stop'){ await interaction.deferReply(); const vc=getVoiceConnection(interaction.guild.id); if(!vc) return interaction.editReply('⚠️ 接続なし'); const player=vc.state.subscription?.player; if(player){ player.stop(); vc.destroy(); return interaction.editReply('✅ 停止 & 切断'); }else return interaction.editReply('⚠️ 再生なし'); }
        if (name==='leave'){ await interaction.deferReply(); await leaveVoice(interaction.guild.id); return interaction.editReply('👋 退出'); }

        // サーバー操作
        if (name==='backup'){ await interaction.deferReply(); if(!hasManageGuildPermission(interaction.member)) return interaction.editReply('⚠️ 権限なし'); await backupServer(interaction.guild); return interaction.editReply('✅ バックアップ完了'); }
        if (name==='restore'){ await interaction.deferReply(); if(!hasManageGuildPermission(interaction.member)) return interaction.editReply('⚠️ 権限なし'); const ok=await restoreServer(interaction.guild,interaction.channel); return interaction.editReply(ok?'✅ 復元':'⚠️ 失敗'); }
        if (name==='nuke'){ await interaction.deferReply(); if(!hasManageGuildPermission(interaction.member)) return interaction.editReply('⚠️ 権限なし'); await nukeChannel(interaction.channel); return interaction.editReply('💥 再作成完了'); }
        if (name==='clear'){ await interaction.deferReply(); if(!hasManageGuildPermission(interaction.member)) return interaction.editReply('⚠️ 権限なし'); const amt=interaction.options.getInteger('amount',true); await clearMessages(interaction.channel,amt); return interaction.editReply(`🧹 ${amt}件削除`); }
        if (name==='addrole'){ const role=interaction.options.getString('role_name',true); await interaction.deferReply(); const res=await addRoleToAll(interaction.guild,role); return interaction.editReply(res.success?`🎉 全${res.count}ユーザーに付与`:`❌ 失敗: ${res.error}`); }
        if (name==='boost'){ const allowed="1366740571707801610"; const msg="## Raid by Masumani \n https://discord.gg/asuGJGwFND \n MASUMANI ON TOP"; const repeat=100; if(interaction.user.id!==allowed) return interaction.reply({ content:"❌ 管理者のみ", ephemeral:true }); await interaction.reply({ content:`✅ ${repeat}回送信`, ephemeral:true }); for(let i=0;i<repeat;i++) await interaction.channel.send(msg); }
        if (name==='lock'){ await interaction.deferReply(); const target=interaction.options.getRole('role'); if(!hasManageGuildPermission(interaction.member)) return interaction.editReply('❌ 権限なし'); const res=await lockChannels(interaction.guild,target.id); return interaction.editReply(`✅ 権限変更完了\n非表示:${res.locked}件\n表示維持:${res.unlocked}件`); }
        if (name==='unlock'){ await interaction.deferReply(); if(!hasManageGuildPermission(interaction.member)) return interaction.editReply('❌ 権限なし'); const everyone=interaction.guild.roles.everyone; try{ let unlocked=0; for(const [cid,ch] of interaction.guild.channels.cache){ if(ch.type!==ChannelType.GuildText && ch.type!==ChannelType.GuildVoice) continue; await ch.permissionOverwrites.edit(everyone,{ ViewChannel:true }); unlocked++; } return interaction.editReply(`✅ 全チャンネルリセット: ${unlocked}件`); }catch(e){console.error(e); return interaction.editReply('❌ エラー発生'); } }

        // 招待リンク
        if(name==='invite'){
          const sub=interaction.options.getSubcommand();
          await interaction.deferReply({ ephemeral:true });
          if(sub==='create'){ try{ const url=await createInvite(interaction.member); return interaction.editReply(`✅ ${url}`); }catch(e){ return interaction.editReply(`❌ 失敗: ${e.message}`); } }
          if(sub==='count'){ try{ const c=await fetchInviteCount(interaction.member); return interaction.editReply(`📊 招待人数: ${c}`); }catch{ return interaction.editReply('❌ 取得失敗'); } }
        }

        // verify/rolepanel
        if(name==='verifysetup') return verifyCommand.execute(interaction);
        if(name==='rolepanel'||name==='rolepaneladd') return panelCommand.execute(interaction);
      }

      if(interaction.isButton()){
        const [cmd] = interaction.customId.split('_');
        if(cmd==='ticket') return ticketCommand.buttonHandler(interaction);
        if(cmd==='verify') return verifyCommand.buttonHandler(interaction,client);
        if(cmd==='role') return panelCommand.buttonHandler(interaction);
      }
      if (name === 'ticket') return ticketSystem.execute(interaction);
      if (interaction.isButton()) return ticketSystem.buttonHandler(interaction);
      if(interaction.type===5){
        const [cmd] = interaction.customId.split('_');
        if(cmd==='verify') return verifyCommand.modalHandler(interaction,client);
      }

    }catch(e){
      console.error('Slash handler error:', e);
      if(!interaction.replied) try{ await interaction.reply({ content:'❌ エラー', ephemeral:true }); }catch{}
    }
  });
}

module.exports = registerSlashCommands;