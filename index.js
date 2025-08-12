const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const token = process.env.TOKEN;
const { clientId } = require('./config.json');

const translateApi = require('@vitalets/google-translate-api');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const backupDir = './backups';
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir);
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

function hasManageGuildPermission(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

// 翻訳のリトライ関数（TooManyRequestsErrorに対応）
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function translateWithRetry(text, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await translateApi.translate(text, options);
    } catch (error) {
      if (error.name === 'TooManyRequestsError') {
        console.warn(`翻訳APIのリクエスト過多。リトライします (${i + 1}/${retries})...`);
        await delay(2000 * (i + 1)); // 待機時間は2秒、4秒、6秒...
      } else {
        throw error;
      }
    }
  }
  throw new Error('翻訳APIのリクエストが多すぎて失敗しました。');
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply('このコマンドはサーバー内でのみ使えます。');
    return;
  }

  if (!hasManageGuildPermission(interaction.member)) {
    await interaction.reply({ content: 'このコマンドを使うには管理権限が必要です。', ephemeral: true });
    return;
  }

  if (interaction.commandName === 'backup') {
    const roles = guild.roles.cache
      .filter(r => !r.managed)
      .map(r => ({
        name: r.name,
        color: r.color,
        hoist: r.hoist,
        permissions: r.permissions.bitfield.toString(),
        position: r.position,
        mentionable: r.mentionable,
      }));

    const channels = guild.channels.cache
      .filter(ch => [0, 2, 4].includes(ch.type))
      .map(ch => ({
        name: ch.name,
        type: ch.type,
        parentName: ch.parent ? ch.parent.name : null,
        position: ch.position,
        topic: ch.topic || null,
        nsfw: ch.nsfw || false,
        bitrate: ch.bitrate || null,
        userLimit: ch.userLimit || null,
      }));

    const backupData = {
      roles,
      channels,
      timestamp: new Date().toISOString(),
    };

    const filePath = path.join(backupDir, `${guild.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));

    await interaction.reply('サーバーのバックアップに成功しました');
  }
  else if (interaction.commandName === 'restore') {
    const filePath = path.join(backupDir, `${guild.id}.json`);

    if (!fs.existsSync(filePath)) {
      await interaction.reply('バックアップファイルが見つかりません。 /backup を実行してください。');
      return;
    }

    await interaction.reply('バックアップの復元を実行します。');

    const backup = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const categoryMap = {};
    for (const ch of backup.channels.filter(c => c.type === 4)) {
      try {
        const category = await guild.channels.create({
          name: ch.name,
          type: 4,
          position: ch.position,
        });
        categoryMap[ch.name] = category;
      } catch (e) {
        console.error(e);
      }
    }

    for (const ch of backup.channels.filter(c => c.type !== 4)) {
      try {
        await guild.channels.create({
          name: ch.name,
          type: ch.type,
          topic: ch.topic,
          nsfw: ch.nsfw,
          bitrate: ch.bitrate,
          userLimit: ch.userLimit,
          parent: ch.parentName ? categoryMap[ch.parentName] : null,
          position: ch.position,
        });
      } catch (e) {
        console.error(e);
      }
    }

    await interaction.followUp('バックアップの復元が完了しました。');
  }
  else if (interaction.commandName === 'clear') {
    const amount = interaction.options.getInteger('amount');
    const user = interaction.options.getUser('user');

    if (amount < 1 || amount > 1000) {
      await interaction.reply({ content: '削除するメッセージの数は1から1000の間で指定してください。', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const channel = interaction.channel;
      const fetchedMessages = await channel.messages.fetch({ limit: 100 });

      let messagesToDelete = user
        ? fetchedMessages.filter(msg => msg.author.id === user.id).first(amount)
        : fetchedMessages.first(amount);

      if (!messagesToDelete || messagesToDelete.length === 0) {
        await interaction.editReply({ content: '条件に一致するメッセージがありません。' });
        return;
      }

      await channel.bulkDelete(messagesToDelete, true);
      await interaction.editReply({ content: `メッセージを${messagesToDelete.length}件削除しました。` });
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: '削除中にエラーが発生しました。' });
    }
  }
  else if (interaction.commandName === 'nuke') {
    const channel = interaction.channel;

    await interaction.reply(`💣 チャンネル「${channel.name}」をリセットします...`);

    try {
      const newChannel = await channel.guild.channels.create({
        name: channel.name,
        type: channel.type,
        topic: channel.topic,
        nsfw: channel.nsfw,
        parent: channel.parent,
        rateLimitPerUser: channel.rateLimitPerUser,
        position: channel.position,
        permissionOverwrites: channel.permissionOverwrites.cache.map(overwrite => ({
          id: overwrite.id,
          allow: overwrite.allow.bitfield,
          deny: overwrite.deny.bitfield,
        })),
      });

      await channel.delete();
      await newChannel.send(`✅ チャンネル「${newChannel.name}」をリセットしました！`);
    } catch (error) {
      console.error(error);
    }
  }
});

// メッセージコマンドで翻訳機能
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const targetLang = args.shift();
  const text = args.join(' ');

  if (!text) {
    message.reply('翻訳したい文章を入力してください。');
    return;
  }

  const langMap = {
    '英語': 'en',
    'えいご': 'en',
    '日本語': 'ja',
    'にほんご': 'ja',
    '中国語': 'zh-CN',
    'ちゅうごくご': 'zh-CN',
    '韓国語': 'ko',
    'かんこくご': 'ko',
    'フランス語': 'fr',
    'スペイン語': 'es',
    'ドイツ語': 'de',
  };

  const to = langMap[targetLang];
  if (!to) {
    message.reply('対応していない言語です。対応例: 英語, 日本語, 中国語, 韓国語, フランス語, スペイン語, ドイツ語');
    return;
  }

  try {
    const res = await translateWithRetry(text, { to });
    message.reply(res.text);
  } catch (error) {
    console.error(error);
    message.reply('翻訳中にエラーが発生しました。');
  }
});

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('backup')
      .setDescription('サーバーのバックアップをします'),
    new SlashCommandBuilder()
      .setName('restore')
      .setDescription('バックアップを復元します'),
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('一括でメッセージを削除します')
      .addIntegerOption(option =>
        option.setName('amount')
          .setDescription('削除するメッセージ数 (1〜1000)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(1000))
      .addUserOption(option =>
        option.setName('user')
          .setDescription('ユーザーを指定')
          .setRequired(false)),
    new SlashCommandBuilder()
      .setName('nuke')
      .setDescription('チャンネルをリセットします'),
  ];

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands.map(cmd => cmd.toJSON()) });
  console.log('スラッシュコマンド登録完了');
}

registerCommands();

client.login(token);