// commands/prefix.js
const {
  hasManageGuildPermission,
  backupServer,
  restoreServer,
  nukeChannel,
  clearMessages,
  addRoleToAll,
} = require("../utils/guild");
// ★ 修正: chat, checkAiCooldown, setAiCooldownをインポート
const { chat, checkAiCooldown, setAiCooldown } = require("../utils/ai"); 
const {
  saveUserWeatherPref,
  loadUserWeatherPref,
  fetchWeather,
} = require("../utils/weather");
const { askQuiz } = require("../utils/quiz");
const { joinVoice, playUrl, leaveVoice } = require("../utils/music");
const translate = require('@iamtraction/google-translate');

// クールダウン設定
const cooldowns = new Map();
const COOLDOWN_TIME = 10; // 10秒

const CMD_PREFIX = "!";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
| \`!ai [内容]\` | AIとチャットします。 |
| \`!英語(例)ほとんどの言語に対応\` | 翻訳します。 |
| \`!nuke\` | チャンネルをNukeします。 |
| \`!join\` | ボイスチャンネルに参加します。 |
| \`!play [URL/検索]\` | YouTubeの音楽を再生します。 |
| \`!stop\` | 音楽再生を停止します。 |
| \`!leave\` | ボイスチャンネルから退出します。 |
| \`!backup\` | サーバーの構成をバックアップします。 |
| \`!restore\` | バックアップからサーバーを復元します。 |
| \`!addrole [ロール名]\` | 全ユーザーにロールを付与します。 |
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

      // クールダウンチェック
      if (cooldowns.has(msg.author.id)) {
        const lastUsed = cooldowns.get(msg.author.id);
        const now = Date.now();
        const remaining = (lastUsed + COOLDOWN_TIME * 1000) - now;
        if (remaining > 0) {
          const seconds = Math.ceil(remaining / 1000);
          const warnMsg = await msg.reply(`⚠️ コマンドはクールダウン中です。あと${seconds}秒お待ちください。`);
          // 5秒後に削除
          setTimeout(() => {
            warnMsg.delete().catch(() => {});
          }, 5000);
          return;
        }
      cooldowns.set(msg.author.id, Date.now());
    }
  cooldowns.set(msg.author.id, Date.now());

  try {
    switch (cmd) {
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
      case "クイズ": {
        const category = args[0]?.toLowerCase() || "mix";
        await askQuiz(msg.channel, msg.author, category);
        break;
      }
      case "ai": {
        const remainingCooldown = checkAiCooldown(msg.author.id);
        if (remainingCooldown > 0) {
          return msg.reply(`❌ AIはクールタイム中です。あと${remainingCooldown}秒お待ちください。`);
        }
        setAiCooldown(msg.author.id);

        const prompt = args.join(" ").trim();
        if (!prompt) return msg.reply("使い方: `!ai 相談したい内容`");

        const thinkingMsg = await msg.channel.send("AIが考え中です...");
        const res = await chat(prompt, msg.author.id);

        if (res) {
          await thinkingMsg.delete().catch(() => {});
          await msg.reply(res);
        } else {
          await thinkingMsg.edit("⚠️ 返答に失敗しました");
        }
        break;
      }
      case "join": {
        if (!msg.member?.voice?.channel)
          return msg.reply("⚠️ ボイスチャンネルに参加してください");
        const ok = await joinVoice(msg.guild, msg.member.voice.channel);
        if (!ok) return msg.reply("⚠️ 接続に失敗しました");
        await msg.reply("🔊 参加しました");
        break;
      }
          // プレフィックスコマンド部分の play 修正
        case 'play': {
          const allowedChannelId = '1419041571944403046';
          if (msg.channel.id !== allowedChannelId) {
            await msg.delete().catch(() => {});
            return msg.channel.send(`❌ このチャンネルでは !play は使用できません`)
              .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
          }

          const query = args.join(' ');
          if (!query) return msg.reply('❌ 曲名またはURLを入力してください');

          if (!msg.member?.voice?.channel)
            return msg.reply('❌ ボイスチャンネルに参加してください');

          await joinVoice(msg.guild, msg.member.voice.channel);

          // 曲再生
          const musicTitle = await playUrl(msg.guild.id, query, msg.channel, msg.member.voice.channel);

          // 再生中の場合のみ「キューに追加」を送信
          const player = require('../utils/music').players.get(msg.guild.id);
          if (player?.state.status === AudioPlayerStatus.Playing) {
            await msg.channel.send(`▶️ キューに追加: **${musicTitle}**`);
          }

          break;
        }
      case "leave": {
        await leaveVoice(msg.guild.id);
        await msg.reply("👋 退出しました");
        break;
      }
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
      case "addrole": {
        if (!hasManageGuildPermission(msg.member))
          return msg.reply("⚠️ 管理者権限が必要です");
        const roleName = args.join(" ");
        if (!roleName)
          return msg.reply("使い方: `!addrole <ロール名>`");
        await msg.reply(`✅ **${roleName}** を全ユーザーに付与します。完了までお待ちください...`);
        const result = await addRoleToAll(msg.guild, roleName);
        if (result.success) {
          await msg.channel.send(`🎉 全${result.count}ユーザーにロールを付与しました！`);
        } else {
          await msg.channel.send(`❌ ロールの付与に失敗しました: ${result.error}`);
        }
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

          if (args.length === 0)
            return msg.channel.send("使い方: `!clear <数> [@ユーザー]`");

          const amount = parseInt(args[0], 10);
          if (!amount || amount < 1 || amount > 1000)
            return msg.channel.send("⚠️ 削除件数は1〜1000の範囲で指定してください");

          // ユーザー指定がある場合
          let targetUser = null;
          if (msg.mentions.members.size > 0) {
            targetUser = msg.mentions.members.first();
          }

          // メッセージをフェッチ
          const fetched = await msg.channel.messages.fetch({ limit: amount + 1 }); // +1 でコマンド自身を含める
          let messagesToDelete;

          if (targetUser) {
            // 指定ユーザーのみに絞る
            messagesToDelete = fetched.filter(m => m.author.id === targetUser.id);
          } else {
            messagesToDelete = fetched;
          }

          // 削除
          const deleted = await msg.channel.bulkDelete(messagesToDelete, true);

          // 件数はユーザー指定数をそのまま表示（コマンド自身は内部的に含まれている）
          const notice = await msg.channel.send(
            `🧹 ${deleted.size}件のメッセージを削除しました。`
          );
          setTimeout(() => notice.delete().catch(() => {}), 5000);

          break;
        }
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
        const res = await translate(text, { to });
        await msg.reply(res.text || "翻訳できませんでした");
      }
    }
  } catch (e) {
    console.error("Prefix command error:", e);
  }
};
