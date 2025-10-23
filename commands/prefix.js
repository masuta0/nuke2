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
// music モジュールはエクスポート名が複数ある可能性があるため後で require する
const translate = require('@iamtraction/google-translate');

const { autoDeleteMessage } = require('../utils/messaging'); // 20秒で削除する共通ユーティリティ

const CMD_PREFIX = "!";
const cooldowns = new Map();
const COOLDOWN_TIME = 10;

// サーバー全体のコマンドクールダウン（秒）
const SERVER_COOLDOWN_TIME = 2;
const serverCooldowns = new Map();

// 自動削除するコマンド（prefixコマンドの返信を自動削除対象に）
const AUTO_DELETE_COMMANDS = [
  "help", "ping", "ai", "クイズ", "英語", "天気"
];

// 自動削除までの固定秒数（20秒）
const AUTO_DELETE_SECONDS = 20;

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
  if (!msg.guild) return;

  const content = (msg.content || "").trim();
  if (!content.startsWith(CMD_PREFIX)) return;

  // --- 実行メッセージも自動削除 ---
  autoDeleteMessage(msg, AUTO_DELETE_SECONDS);

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

  // 音楽モジュールをここで require（エクスポート名差分対応用）
  const music = require("../utils/music");
  // play 関数候補を柔軟に選ぶ
  const playCandidates = [music.playUrl, music.playMusic, music.play, music.play_track, music.playTrack].filter(Boolean);
  const playFn = playCandidates[0]; // 最初に見つかったものを使用

  async function safeReplyAndDelete(text) {
    const r = await msg.reply(text).catch(() => null);
    if (r) autoDeleteMessage(r, AUTO_DELETE_SECONDS);
    return r;
  }

  async function safeReplyErrorAndDelete(text) {
    const r = await msg.reply(text).catch(() => null);
    if (r) autoDeleteMessage(r, AUTO_DELETE_SECONDS);
    return r;
  }

  switch (cmd) {
    case "help": {
      await msg.author.send(helpMessage).catch(() => {});
      const reply = await msg.reply("ヘルプをDMに送信しました。");
      if (reply) autoDeleteMessage(reply, AUTO_DELETE_SECONDS);
      break;
    }
    case "ping": {
      await safeReplyAndDelete("Pong!");
      break;
    }
    case "uptime": {
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const s = Math.floor(uptime % 60);
      await safeReplyAndDelete(`稼働時間: ${h}時間${m}分${s}秒`);
      break;
    }
    case "天気": {
      const place = args[0] || "東京";
      const weather = await fetchWeather(place);
      await safeReplyAndDelete(`${place}の天気: ${weather}`);
      break;
    }
    case "クイズ": {
      const question = await quizManager.getQuestion();
      const reply = await msg.reply(`クイズ: ${question.text}`);
      if (reply) autoDeleteMessage(reply, AUTO_DELETE_SECONDS);
      break;
    }
    case "ai": {
      const input = args.join(" ");
      if (!input) {
        await safeReplyErrorAndDelete("AIに聞きたいことを入力してください。");
        return;
      }
      if (checkAiCooldown(msg.author.id)) {
        await safeReplyErrorAndDelete("AIはクールダウン中です。");
        return;
      }
      setAiCooldown(msg.author.id);
      const aiReply = await chat(input, msg.author.id);
      const reply = await msg.reply(aiReply).catch(() => null);
      if (reply) autoDeleteMessage(reply, AUTO_DELETE_SECONDS);
      break;
    }
    case "英語": {
      const input = args.join(" ");
      if (!input) {
        await safeReplyErrorAndDelete("翻訳する内容を入力してください。");
        return;
      }
      const result = await translate(input, { to: "en" });
      const reply = await msg.reply(result.text).catch(() => null);
      if (reply) autoDeleteMessage(reply, AUTO_DELETE_SECONDS);
      break;
    }
    case "nuke": {
      if (!hasManageGuildPermission(msg.member)) {
        await safeReplyErrorAndDelete("権限がありません。");
        return;
      }
      await nukeChannel(msg.channel);
      break;
    }
    case "join": {
      if (!msg.member?.voice?.channel) {
        await safeReplyErrorAndDelete("VCに参加してください。");
        return;
      }
      await music.joinVoice ? music.joinVoice(msg.member.voice.channel) : require("../utils/music").joinVoice(msg.member.voice.channel);
      break;
    }
    case "play": {
      if (!msg.member?.voice?.channel) {
        await safeReplyErrorAndDelete("VCに参加してください。");
        return;
      }
      const url = args.join(" ");
      if (!url) {
        await safeReplyErrorAndDelete("再生するURLまたは検索ワードを指定してください。");
        return;
      }

      try {
        if (!playFn) {
          // play 関数が見つからない場合はエラーを返す
          throw new Error("音楽再生関数が見つかりません (utils/music の export を確認してください)。");
        }
        // playFn のシグネチャが (channel, url) か (msg, url) か不明なので両方試す
        let called = false;
        try {
          // (channel, url) を試す
          await playFn(msg.member.voice.channel, url);
          called = true;
        } catch (e1) {
          try {
            // (msg, url) を試す
            await playFn(msg, url);
            called = true;
          } catch (e2) {
            // どちらもダメならスロー
            throw e2;
          }
        }
        if (called) {
          // 成功メッセージは不要かもしれないが一応短く通知して削除
          const r = await msg.reply("再生を開始しました。").catch(() => null);
          if (r) autoDeleteMessage(r, AUTO_DELETE_SECONDS);
        }
      } catch (err) {
        console.error("play command error:", err);
        await safeReplyErrorAndDelete(`再生に失敗しました: ${err.message || String(err)}`);
      }
      break;
    }
    case "stop": {
      try {
        if (music.stopMusic) await music.stopMusic(msg.guild);
        else if (music.stop) await music.stop(msg.guild);
        else await safeReplyErrorAndDelete("停止機能が見つかりません。");
      } catch (e) {
        console.error("stop error:", e);
        await safeReplyErrorAndDelete("停止処理でエラーが発生しました。");
      }
      break;
    }
    case "leave": {
      if (!msg.member?.voice?.channel) {
        await safeReplyErrorAndDelete("VCに参加してください。");
        return;
      }
      try {
        if (music.leaveVoice) await music.leaveVoice(msg.member.voice.channel);
        else if (music.disconnect) await music.disconnect(msg.member.voice.channel);
        else await safeReplyErrorAndDelete("VC退出処理が見つかりません。");
      } catch (e) {
        console.error("leave error:", e);
        await safeReplyErrorAndDelete("VC退出処理でエラーが発生しました。");
      }
      break;
    }
    case "backup": {
      if (!hasManageGuildPermission(msg.member)) {
        await safeReplyErrorAndDelete("権限がありません。");
        return;
      }
      await backupServer(msg.guild);
      const reply = await msg.reply("サーバーバックアップが完了しました。");
      if (reply) autoDeleteMessage(reply, AUTO_DELETE_SECONDS);
      break;
    }
    case "restore": {
      if (!hasManageGuildPermission(msg.member)) {
        await safeReplyErrorAndDelete("権限がありません。");
        return;
      }
      const filename = args[0];
      await restoreServer(msg.guild, msg.channel, filename);
      const reply = await msg.reply("サーバー復元が完了しました。");
      if (reply) autoDeleteMessage(reply, AUTO_DELETE_SECONDS);
      break;
    }
    case "addrole": {
      if (!hasManageGuildPermission(msg.member)) {
        await safeReplyErrorAndDelete("権限がありません。");
        return;
      }
      const roleName = args.join(" ");
      if (!roleName) {
        await safeReplyErrorAndDelete("ロール名を指定してください。");
        return;
      }
      await addRoleToAll(msg.guild, roleName);
      const reply = await msg.reply(`全ユーザーにロール「${roleName}」を付与しました。`);
      if (reply) autoDeleteMessage(reply, AUTO_DELETE_SECONDS);
      break;
    }
    case "clear": {
      if (!msg.member.permissions.has("MANAGE_MESSAGES")) {
        await safeReplyErrorAndDelete("権限がありません。");
        return;
      }
      const amount = parseInt(args[0]);
      if (isNaN(amount) || amount < 1) {
        await safeReplyErrorAndDelete("削除数を指定してください。");
        return;
      }
      const targetMember = msg.mentions.members.first() || null;
      await msg.delete().catch(() => {});
      await clearMessages(msg.channel, amount, msg.channel, targetMember);
      break;
    }
    case "ranking": {
      const ranking = await getRanking(msg.guild);
      if (!ranking.length) {
        await safeReplyErrorAndDelete("今月のランキングデータはありません。");
        return;
      }
      const rankingStr = ranking.map((u, i) => `${i + 1}位 <@${u.userId}>: ${u.count}回`).join("\n");
      const reply = await msg.reply(`**月間アクティブユーザーランキング**\n${rankingStr}`);
      if (reply) autoDeleteMessage(reply, AUTO_DELETE_SECONDS);
      break;
    }
    case "reset": {
      if (!hasManageGuildPermission(msg.member)) {
        await safeReplyErrorAndDelete("権限がありません。");
        return;
      }
      await resetServerChannels(msg.guild, msg.channel);
      const reply = await msg.reply("サーバーのチャンネルをリセットしました。");
      if (reply) autoDeleteMessage(reply, AUTO_DELETE_SECONDS);
      break;
    }
    default:
      // 未定義コマンドは無視
      break;
  }
};