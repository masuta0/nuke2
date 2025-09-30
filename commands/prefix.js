const {
  hasManageGuildPermission,
  backupServer,
  restoreServer,
  nukeChannel,
  clearMessages,
  addRoleToAll,
  resetServerChannels, // 追加
} = require("../utils/guild");
const {
  addMessage,
  getRanking,
  updateActiveRoles,
} = require("../utils/activity");
const { chat, checkAiCooldown, setAiCooldown } = require("../utils/ai");
const {
  saveUserWeatherPref,
  loadUserWeatherPref,
  fetchWeather,
} = require("../utils/weather");
const { quizManager, activeUsers } = require("../utils/quiz");
const { joinVoice, playUrl, leaveVoice } = require("../utils/music");
const translate = require('@iamtraction/google-translate');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');

const CMD_PREFIX = "!";
const cooldowns = new Map();
const COOLDOWN_TIME = 10;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const helpMessage = `
**このボットについて**

- 🎶 音楽再生
- 📝 AIチャット
- 📚 クイズ
- 🌤️ 天気情報
- 🔨 サーバー管理
- 🛡️ 荒らし対策

**コマンド一覧**
| コマンド | 説明 |
|---|---|
| !help | ヘルプをDMで送信 |
| !ping | 応答確認 |
| !uptime | 稼働時間表示 |
| !天気 [場所] | 天気取得 |
| !クイズ | クイズ出題 |
| !ai [内容] | AIチャット |
| !英語(他言語) | 翻訳 |
| !nuke | チャンネルNuke |
| !join | VC参加 |
| !play [URL/検索] | 音楽再生 |
| !stop | 再生停止 |
| !leave | VC退出 |
| !backup | サーバーバックアップ |
| !restore [ファイル名] | サーバー復元（ファイル名省略時はサーバーID） |
| !addrole [ロール名] | 全ユーザーロール付与 |
| !clear [数] [@ユーザー] | メッセージ削除 |
| !ranking | 月間アクティブユーザーランキング |
| !reset | サーバーのチャンネルをリセット（管理者限定） |
`;

const RANKING_BANNED_CHANNELS = [
  '雑談',
];

module.exports = async function handlePrefixMessage(client, msg) {
  if (msg.author.bot) return;
  const content = (msg.content || "").trim();
  if (!content.startsWith(CMD_PREFIX)) return;

  const args = content.slice(CMD_PREFIX.length).split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  // クールダウン
  if (cooldowns.has(msg.author.id)) {
    const lastUsed = cooldowns.get(msg.author.id);
    if (Date.now() - lastUsed < COOLDOWN_TIME * 1000) {
      return;
    }
  }
  cooldowns.set(msg.author.id, Date.now());

  switch (cmd) {
    case "help": {
      await msg.author.send(helpMessage).catch(() => {});
      await msg.reply("ヘルプをDMに送信しました。");
      break;
    }
    case "ping": {
      await msg.reply("Pong!");
      break;
    }
    case "uptime": {
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const s = Math.floor(uptime % 60);
      await msg.reply(`稼働時間: ${h}時間${m}分${s}秒`);
      break;
    }
    case "天気": {
      const place = args[0] || "東京";
      const weather = await fetchWeather(place);
      await msg.reply(`${place}の天気: ${weather}`);
      break;
    }
    case "クイズ": {
      const question = await quizManager.getQuestion();
      await msg.reply(`クイズ: ${question.text}`);
      break;
    }
    case "ai": {
      const input = args.join(" ");
      if (!input) return msg.reply("AIに聞きたいことを入力してください。");
      if (checkAiCooldown(msg.author.id)) return msg.reply("AIはクールダウン中です。");
      setAiCooldown(msg.author.id);
      const aiReply = await chat(input, msg.author.id);
      await msg.reply(aiReply);
      break;
    }
    case "英語": {
      const input = args.join(" ");
      if (!input) return msg.reply("翻訳する内容を入力してください。");
      const result = await translate(input, { to: "en" });
      await msg.reply(result.text);
      break;
    }
    case "nuke": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      await nukeChannel(msg.channel);
      break;
    }
    case "join": {
      await joinVoice(msg.member.voice.channel);
      break;
    }
    case "play": {
      const url = args.join(" ");
      await playUrl(msg.member.voice.channel, url);
      break;
    }
    case "stop": {
      await stopMusic(msg.guild);
      break;
    }
    case "leave": {
      await leaveVoice(msg.member.voice.channel);
      break;
    }
    case "backup": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      await backupServer(msg.guild);
      await msg.reply("サーバーバックアップが完了しました。");
      break;
    }
    case "restore": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      const filename = args[0];
      await restoreServer(msg.guild, msg.channel, filename);
      await msg.reply("サーバー復元が完了しました。");
      break;
    }
    case "addrole": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      const roleName = args.join(" ");
      if (!roleName) return msg.reply("ロール名を指定してください。");
      await addRoleToAll(msg.guild, roleName);
      await msg.reply(`全ユーザーにロール「${roleName}」を付与しました。`);
      break;
    }
    case "clear": {
      if (!msg.member.permissions.has("MANAGE_MESSAGES")) return msg.reply("権限がありません。");
      const amount = parseInt(args[0]);
      if (isNaN(amount) || amount < 1) return msg.reply("削除数を指定してください。");
      const user = msg.mentions.users.first();
      await clearMessages(msg.channel, amount, user);
      break;
    }
    case "ranking": {
      const ranking = await getRanking(msg.guild);
      if (!ranking.length) return msg.reply("今月のランキングデータはありません。");
      const rankingStr = ranking.map((u, i) => `${i + 1}位 <@${u.userId}>: ${u.count}回`).join("\n");
      await msg.reply(`**月間アクティブユーザーランキング**\n${rankingStr}`);
      break;
    }
    case "reset": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      await resetServerChannels(msg.guild, msg.channel);
      await msg.reply("サーバーのチャンネルをリセットしました。");
      break;
    }
    default: {
      // 未定義コマンド
      break;
    }
  }
};