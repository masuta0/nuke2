const {
  hasManageGuildPermission,
  backupServer,
  restoreServer,
  nukeChannel,
  clearMessages,
  addRoleToAll,
  resetServerChannels,
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

const CMD_PREFIX = "!";
const cooldowns = new Map();
const COOLDOWN_TIME = 10;

// サーバー全体のコマンドクールダウン（秒）
const SERVER_COOLDOWN_TIME = 2;
const serverCooldowns = new Map();

// 自動削除するコマンド
const AUTO_DELETE_COMMANDS = [
  "help", "ping", "ai", "クイズ", "英語", "天気"
];

// 自動削除の秒数範囲
const AUTO_DELETE_MIN = 10;
const AUTO_DELETE_MAX = 30;

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

function randomDeleteSecs() {
  return AUTO_DELETE_MIN + Math.floor(Math.random() * (AUTO_DELETE_MAX - AUTO_DELETE_MIN + 1));
}

async function autoDeleteMsg(msg) {
  const secs = randomDeleteSecs();
  setTimeout(() => msg.delete().catch(() => {}), secs * 1000);
}

module.exports = async function handlePrefixMessage(client, msg) {
  if (msg.author.bot) return;
  if (!msg.guild) return;

  const content = (msg.content || "").trim();
  if (!content.startsWith(CMD_PREFIX)) return;

  // --- 実行メッセージも自動削除 ---
  autoDeleteMsg(msg);

  const args = content.slice(CMD_PREFIX.length).split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  // サーバー全体クールダウン
  const lastServerUsed = serverCooldowns.get(msg.guild.id) || 0;
  if (Date.now() - lastServerUsed < SERVER_COOLDOWN_TIME * 1000) {
    return;
  }
  serverCooldowns.set(msg.guild.id, Date.now());

  // ユーザー個別クールダウン
  if (cooldowns.has(msg.author.id)) {
    const lastUsed = cooldowns.get(msg.author.id);
    if (Date.now() - lastUsed < COOLDOWN_TIME * 1000) return;
  }
  cooldowns.set(msg.author.id, Date.now());

  switch (cmd) {
    case "help": {
      await msg.author.send(helpMessage).catch(() => {});
      const reply = await msg.reply("ヘルプをDMに送信しました。");
      autoDeleteMsg(reply);
      break;
    }
    case "ping": {
      const reply = await msg.reply("Pong!");
      autoDeleteMsg(reply);
      break;
    }
    case "uptime": {
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const s = Math.floor(uptime % 60);
      const reply = await msg.reply(`稼働時間: ${h}時間${m}分${s}秒`);
      autoDeleteMsg(reply);
      break;
    }
    case "天気": {
      const place = args[0] || "東京";
      const weather = await fetchWeather(place);
      const reply = await msg.reply(`${place}の天気: ${weather}`);
      autoDeleteMsg(reply);
      break;
    }
    case "クイズ": {
      const question = await quizManager.getQuestion();
      const reply = await msg.reply(`クイズ: ${question.text}`);
      autoDeleteMsg(reply);
      break;
    }
    case "ai": {
      const input = args.join(" ");
      if (!input) return msg.reply("AIに聞きたいことを入力してください。");
      if (checkAiCooldown(msg.author.id)) return msg.reply("AIはクールダウン中です。");
      setAiCooldown(msg.author.id);
      const aiReply = await chat(input, msg.author.id);
      const reply = await msg.reply(aiReply);
      autoDeleteMsg(reply);
      break;
    }
    case "英語": {
      const input = args.join(" ");
      if (!input) return msg.reply("翻訳する内容を入力してください。");
      const result = await translate(input, { to: "en" });
      const reply = await msg.reply(result.text);
      autoDeleteMsg(reply);
      break;
    }
    case "nuke": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      await nukeChannel(msg.channel);
      break;
    }
    case "join": {
      if (!msg.member?.voice?.channel) return msg.reply("VCに参加してください。");
      await joinVoice(msg.member.voice.channel);
      break;
    }
    case "play": {
      if (!msg.member?.voice?.channel) return msg.reply("VCに参加してください。");
      const url = args.join(" ");
      await playUrl(msg.member.voice.channel, url);
      break;
    }
    case "stop": {
      await stopMusic(msg.guild);
      break;
    }
    case "leave": {
      if (!msg.member?.voice?.channel) return msg.reply("VCに参加してください。");
      await leaveVoice(msg.member.voice.channel);
      break;
    }
    case "backup": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      await backupServer(msg.guild);
      const reply = await msg.reply("サーバーバックアップが完了しました。");
      autoDeleteMsg(reply);
      break;
    }
    case "restore": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      const filename = args[0];
      await restoreServer(msg.guild, msg.channel, filename);
      const reply = await msg.reply("サーバー復元が完了しました。");
      autoDeleteMsg(reply);
      break;
    }
    case "addrole": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      const roleName = args.join(" ");
      if (!roleName) return msg.reply("ロール名を指定してください。");
      await addRoleToAll(msg.guild, roleName);
      const reply = await msg.reply(`全ユーザーにロール「${roleName}」を付与しました。`);
      autoDeleteMsg(reply);
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
      const reply = await msg.reply(`**月間アクティブユーザーランキング**\n${rankingStr}`);
      autoDeleteMsg(reply);
      break;
    }
    case "reset": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      await resetServerChannels(msg.guild, msg.channel);
      const reply = await msg.reply("サーバーのチャンネルをリセットしました。");
      autoDeleteMsg(reply);
      break;
    }
    default:
      // 未定義コマンドは無視
      break;
  }
};
