// commands/prefix.js
const {
  hasManageGuildPermission,
  backupServer,
  restoreServer,
  nukeChannel,
  clearMessages,
} = require("../utils/guild");
const { translateWithRetry, chat } = require("../utils/ai"); // 翻訳とAIチャットをまとめてインポート
const {
  saveUserWeatherPref,
  loadUserWeatherPref,
  fetchWeather,
} = require("../utils/weather");
const { askQuiz } = require("../utils/quiz");
const { joinVoice, playUrl, leaveVoice } = require("../utils/music");

const cooldown = new Map();
const CMD_PREFIX = "!";

// 指定された秒数だけ待機する関数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ★ ヘルプメッセージの内容を定義
const helpMessage = `
**このボットについて**

このボットは、サーバー管理をサポートし、メンバーのコミュニケーションを豊かにするために開発されました。
以下の主な機能を提供しています：

- 🎶 **音楽再生**: YouTubeの音楽を再生し、ボイスチャットを盛り上げます。
- 📝 **AIチャット**: メンションや\`!ai\`コマンドでAIと会話できます。
- 📚 **クイズ**: 雑学や専門知識のクイズで遊べます。
- 🌤️ **天気情報**: \`!天気\`コマンドで、指定した地域の天気情報を取得します。
- 🔨 **サーバー管理**: 管理者向けの\`!backup\`や\`!clear\`などの機能でサーバーの管理をサポートします。
- 🛡️ **荒らし対策**: 不審な行動を自動で検知・処罰し、サーバーの安全を守ります。

**コマンド一覧**

| コマンド | 説明 |
|---|---|
| \`!help\` | このヘルプをDMで送信します。 |
| \`!ping\` | ボットの応答性を確認します。 |
| \`!uptime\` | ボットの稼働時間を表示します。 |
| \`!天気 [場所]\` | 指定した場所の天気情報を取得します。 |
| \`!クイズ\` | クイズを出題します。 |
| \`!join\` | ボイスチャンネルに参加します。 |
| \`!play [URL/検索]\` | YouTubeの音楽を再生します。 |
| \`!stop\` | 音楽再生を停止します。 |
| \`!leave\` | ボイスチャンネルから退出します。 |
| \`!backup\` | サーバーの構成をバックアップします。 |
| \`!restore\` | バックアップからサーバーを復元します。 |
| \`!clear [数]\` | メッセージを削除します。 |

---
ご質問やご要望があれば、開発者までお問い合わせください。
`;

module.exports = async function handlePrefixMessage(client, msg) {
  if (msg.author.bot) return;
  const content = (msg.content || "").trim();
  if (!content.startsWith(CMD_PREFIX)) return;

  const args = content.slice(CMD_PREFIX.length).split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  // 軽いクールダウン（ユーザー別）
  const now = Date.now();
  const last = cooldown.get(msg.author.id) || 0;
  if (now - last < 1000) return;
  cooldown.set(msg.author.id, now);

  try {
    switch (cmd) {
      // ★ help コマンドの追加
      case "help": {
        await msg.author.send(helpMessage)
          .then(() => msg.reply("✅ DMでヘルプを送信しました。"))
          .catch(() => msg.reply("❌ DMを送信できませんでした。DM設定をご確認ください。"));
        break;
      }
      case "ping": {
        await msg.reply("Pong!");
        break;
      }
      case "uptime": {
        await msg.reply("ステータス欄に稼働時間を表示しています（5秒更新）");
        break;
      }

      // ====== 天気 ======
      case "天気": {
        const maybePref = args.join(" ");
        if (maybePref) {
          await saveUserWeatherPref(msg.author.id, maybePref);
          await msg.reply(`✅ 天気の場所を保存: ${maybePref}`);
        } else {
          const pref = await loadUserWeatherPref(msg.author.id);
          if (!pref)
            return msg.reply(
              "⚠️ 都道府県/都市を指定してください: `!天気 東京` のように"
            );
          const text = await fetchWeather(pref);
          if (!text) return msg.reply("⚠️ 天気情報が取得できませんでした");
          await msg.reply(text);
        }
        break;
      }

      // ====== クイズ ======
      case "クイズ": {
        // 例: !クイズ / !クイズ 一般 / !クイズ 鉄道
        const category = args[0]?.toLowerCase() || "mix"; // general+trivia混在が既定
        await askQuiz(msg.channel, msg.author, category);
        break;
      }

      // ====== AI ======
      case "ai": {
        const prompt = args.join(" ").trim();
        if (!prompt) return msg.reply("使い方: `!ai 相談したい内容`");
        const res = await chat(prompt, msg.author.id);
        await msg.reply(res || "⚠️ 返答に失敗しました");
        break;
      }

      // ====== 音楽機能 ======
      case "join": {
        if (!msg.member?.voice?.channel)
          return msg.reply("⚠️ まずボイスチャンネルに参加してください");
        const ok = await joinVoice(msg.guild, msg.member.voice.channel);
        if (!ok) return msg.reply("⚠️ 接続に失敗しました");
        await msg.reply("🔊 参加しました");
        break;
      }
      case "play": {
        const url = args[0];
        if (!url)
          return msg.reply(
            "使い方: `!play <YouTube/SpotifyのURLまたは検索ワード>`"
          );
        if (!msg.member?.voice?.channel)
          return msg.reply("⚠️ まずボイスチャンネルに参加してください");
        const ok = await joinVoice(msg.guild, msg.member.voice.channel);
        if (!ok) return msg.reply("⚠️ 接続に失敗しました");
        const added = await playUrl(msg.guild.id, url, msg.channel);
        await msg.reply(
          added ? `▶️ 再生キューに追加: ${added}` : "⚠️ 取得に失敗しました"
        );
        break;
      }
      case "leave": {
        await leaveVoice(msg.guild.id);
        await msg.reply("👋 退出しました");
        break;
      }

      // ====== 管理系（要権限） ======
      case "backup": {
        if (!hasManageGuildPermission(msg.member))
          return msg.reply("⚠️ 管理者権限が必要です");
        await backupServer(msg.guild);
        await msg.reply("✅ サーバー構成をバックアップしました");
        break;
      }
      case "restore": {
        if (!hasManageGuildPermission(msg.member))
          return msg.reply("⚠️ 管理者権限が必要です");
        const ok = await restoreServer(msg.guild, msg.channel);
        await msg.reply(ok ? "✅ 復元完了" : "⚠️ バックアップが見つかりません");
        break;
      }
      case "nuke": {
        if (!hasManageGuildPermission(msg.member))
          return msg.reply("⚠️ 管理者権限が必要です");
        await nukeChannel(msg.channel);
        break;
      }
      case "clear": {
        if (!hasManageGuildPermission(msg.member))
          return msg.reply("⚠️ 管理者権限が必要です");

        const amount = parseInt(args[0] || "0", 10);
        if (!amount || amount < 1 || amount > 1000)
          return msg.reply("使い方: `!clear 1〜1000`");

        const chunks = Math.ceil(amount / 100);
        let deletedCount = 0;

        const waitingMsg = await msg.reply(
          `🧹 ${amount}件のメッセージを削除します。数回に分けて実行するため、少し時間がかかります...`
        );

        for (let i = 0; i < chunks; i++) {
          const limit = Math.min(amount - (i * 100), 100);
          const messages = await msg.channel.messages.fetch({ limit });

          if (messages.size === 0) break;

          await msg.channel.bulkDelete(messages, true)
            .then(deleted => {
              deletedCount += deleted.size;
            })
            .catch(e => {
              console.error(`Bulk delete failed: ${e}`);
              waitingMsg.edit(`⚠️ メッセージの削除中にエラーが発生しました。`);
              return;
            });

          if (i < chunks - 1) {
            await sleep(1000); // APIレートリミットを回避するために1秒待機
          }
        }

        await waitingMsg.edit(`🧹 ${deletedCount}件のメッセージを削除しました。`);
        break;
      }

      // ====== 簡易 翻訳 ======
      default: {
        const langMap = {
          英語: "en",
          えいご: "en",
          日本語: "ja",
          にほんご: "ja",
          中国語: "zh-CN",
          ちゅうごくご: "zh-CN",
          韓国語: "ko",
          かんこくご: "ko",
          フランス語: "fr",
          スペイン語: "es",
          ドイツ語: "de",
        };
        const to = langMap[cmd];
        if (!to) return;
        const text = args.join(" ").trim();
        if (!text) return;
        const res = await translateWithRetry(text, { to });
        await msg.reply(res || "翻訳できませんでした");
      }
    }
  } catch (e) {
    console.error("Prefix command error:", e);
  }
};
