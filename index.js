require('dotenv').config();
const express = require('express');
const https = require('https');
const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder, ActivityType, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const translateApi = require('@vitalets/google-translate-api');
const simpleGit = require('simple-git');

const clientId = process.env.CLIENT_ID;
const token = process.env.TOKEN;
const git = simpleGit();

// ===== Discord Client =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// ===== Express Keep-Alive =====
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

if (process.env.SELF_URL) {
  setInterval(() => {
    https.get(process.env.SELF_URL, res => console.log(`Keep-Alive ping status: ${res.statusCode}`))
      .on('error', err => console.error('Keep-Alive ping error:', err.message));
  }, 4 * 60 * 1000);
}

// ===== Utilities =====
const delay = ms => new Promise(res => setTimeout(res, ms));
const BACKUP_DIR = process.env.BACKUP_PATH || './backups';
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const msgCooldowns = new Map();
function hasManageGuildPermission(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}
async function translateWithRetry(text, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await translateApi.translate(text, options); }
    catch (e) {
      if (e?.name === 'TooManyRequestsError') await delay(1500 * (i + 1));
      else throw e;
    }
  }
  throw new Error('翻訳APIが多すぎます');
}

// ===== Backup Functions =====
async function collectGuildBackup(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const roles = guild.roles.cache.filter(r => !r.managed)
    .sort((a, b) => a.position - b.position)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      position: r.position,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString()
    }));
  const channels = guild.channels.cache.sort((a, b) => a.rawPosition - b.rawPosition).map(ch => {
    const base = {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      parentId: ch.parentId || null,
      position: ch.rawPosition,
      rateLimitPerUser: ch.rateLimitPerUser || 0,
      nsfw: !!ch.nsfw,
      topic: ch.topic || null,
      bitrate: ch.bitrate || null,
      userLimit: ch.userLimit || null
    };
    const overwrites = [];
    if (ch.permissionOverwrites?.cache?.size) {
      ch.permissionOverwrites.cache.forEach(ow => {
        if (ow.type === 0) overwrites.push({
          id: ow.id,
          allow: ow.allow.bitfield.toString(),
          deny: ow.deny.bitfield.toString(),
          type: 0
        });
      });
    }
    return { ...base, overwrites };
  });
  const meta = { guildId: guild.id, name: guild.name, iconURL: guild.iconURL({ size: 512 }) || null, savedAt: new Date().toISOString() };
  return { meta, roles, channels };
}

function saveGuildBackup(guildId, data) {
  const file = path.join(BACKUP_DIR, `${guildId}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  return file;
}

function loadGuildBackup(guildId) {
  const file = path.join(BACKUP_DIR, `${guildId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// ===== GitHub Push =====
async function pushBackupToGitHub(guildId) {
  const repoUrl = process.env.GITHUB_REPO_URL;
  if (!repoUrl) return console.error('GITHUB_REPO_URL が設定されていません');

  try {
    await git.init();
    await git.addRemote('origin', repoUrl).catch(() => {});
    await git.add('./*');
    await git.commit(`Backup update for guild ${guildId} at ${new Date().toISOString()}`);
    await git.push('origin', 'main');
    console.log('✅ GitHub にバックアップをプッシュしました');
  } catch (err) {
    console.error('❌ GitHub Push失敗:', err.message);
    throw err; // Interaction 側で catch する
  }
}

// ===== Restore Function =====
async function restoreGuildFromBackup(guild, backup, interaction) {
  // ... restore処理は先ほどのコードと同じ
}

// ===== NUKE =====
async function nukeChannel(channel) {
  // ... nuke処理は先ほどのコードと同じ
}

// ===== Slash Commands =====
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('backup').setDescription('サーバーのバックアップを保存'),
    new SlashCommandBuilder().setName('restore').setDescription('バックアップからサーバーを復元'),
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('メッセージ一括削除')
      .addIntegerOption(o => o.setName('amount').setDescription('1〜1000').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('ユーザー指定').setRequired(false)),
    new SlashCommandBuilder().setName('nuke').setDescription('このチャンネルを同設定で再作成（自動バックアップ付き）'),
  ];
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands.map(c => c.toJSON()) });
  console.log('スラッシュコマンド登録完了');
}
registerCommands().catch(console.error);

// ===== Client Events =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== Interaction Handling =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // 先に defer
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }

  const guild = interaction.guild;
  if (!guild) return await interaction.followUp({ content: 'サーバー内で実行してください', ephemeral: true });
  if (!hasManageGuildPermission(interaction.member)) return await interaction.followUp({ content: '管理者権限が必要です', ephemeral: true });

  try {
    if (interaction.commandName === 'backup') {
      const backup = await collectGuildBackup(guild);
      saveGuildBackup(guild.id, backup);
      try {
        await pushBackupToGitHub(guild.id);
        await interaction.followUp({ content: '✅ バックアップ完了・GitHubにプッシュしました', ephemeral: true });
      } catch {
        await interaction.followUp({ content: '⚠️ GitHub Pushに失敗しました', ephemeral: true });
      }
    }

    if (interaction.commandName === 'restore') {
      const backup = loadGuildBackup(guild.id);
      if (!backup) return await interaction.followUp({ content: '⚠️ バックアップが見つかりません', ephemeral: true });
      await restoreGuildFromBackup(guild, backup, interaction);
    }

    if (interaction.commandName === 'nuke') {
      const backup = await collectGuildBackup(guild);
      saveGuildBackup(guild.id, backup);
      await nukeChannel(interaction.channel);
      await interaction.followUp({ content: '💥 チャンネルをNukeしました', ephemeral: true });
    }

    if (interaction.commandName === 'clear') {
      const amount = interaction.options.getInteger('amount');
      const user = interaction.options.getUser('user');
      const msgs = await interaction.channel.messages.fetch({ limit: amount });
      const filtered = user ? msgs.filter(m => m.author.id === user.id) : msgs;
      await interaction.channel.bulkDelete(filtered, true);
      await interaction.followUp({ content: `🧹 ${filtered.size}件のメッセージを削除しました`, ephemeral: true });
    }

  } catch (err) {
    console.error('Interaction error:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ エラーが発生しました', ephemeral: true }).catch(() => {});
    }
  }
});

client.on('error', console.error);
client.login(token);