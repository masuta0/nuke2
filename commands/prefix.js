const {
  hasManageGuildPermission,
  backupServer,
  restoreServer,
  nukeChannel,
  clearMessages,
  addRoleToAll,
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
| !restore | サーバー復元 |
| !addrole [ロール名] | 全ユーザーロール付与 |
| !clear [数] [@ユーザー] | メッセージ削除 |
| !ranking | 月間アクティブランキング |
`;

module.exports = async function handlePrefixMessage(client, msg) {
  if (msg.author.bot) return;
  const content = (msg.content || "").trim();
  if (!content.startsWith(CMD_PREFIX)) return;

  const args = content.slice(CMD_PREFIX.length).split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  // クールダウン
  if (cooldowns.has(msg.author.id)) {
    const lastUsed = cooldowns.get(msg.author.id);
    const remaining = (lastUsed + COOLDOWN_TIME * 1000) - Date.now();
    if (remaining > 0) {
      const warnMsg = await msg.reply(`⚠️ コマンドはクールダウン中です。あと${Math.ceil(remaining/1000)}秒`);
      setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      return;
    }
  }
  cooldowns.set(msg.author.id, Date.now());

  // 月間アクティブカウント
  addMessage(msg.author.id, msg.guild?.id, msg.content);

  try {
    switch (cmd) {
      case "help":
        await msg.author.send(helpMessage)
          .then(() => msg.reply("✅ DMでヘルプを送信しました"))
          .catch(() => msg.reply("❌ DM送信不可"));
        break;

      case "ping":
        await msg.reply("Pong!");
        break;

      case "uptime":
        await msg.reply("ステータス欄に稼働時間を表示しています");
        break;

      case "天気": {
        const maybePref = args.join(" ");
        if (maybePref) {
          await saveUserWeatherPref(msg.author.id, maybePref);
          await msg.reply(`✅ 天気の場所を保存: ${maybePref}`);
        } else {
          const pref = await loadUserWeatherPref(msg.author.id);
          if (!pref) return msg.reply("⚠️ 都道府県/都市を指定してください");
          const text = await fetchWeather(pref);
          await msg.reply(text || "⚠️ 天気情報が取得できませんでした");
        }
        break;
      }

        case "クイズ": {
          if (activeUsers.has(msg.author.id)) {
            return msg.reply("⚠️ あなたはすでにクイズに参加中です");
          }

          // クイズ開始
          const category = args[0] || null; // 引数からカテゴリ指定
          await quizManager(msg.channel, msg.author, category);
          break;
        }
      case "ai": {
        const remainingCooldown = checkAiCooldown(msg.author.id);
        if (remainingCooldown > 0) return msg.reply(`❌ AIはクールタイム中です。あと${remainingCooldown}秒`);
        setAiCooldown(msg.author.id);
        const prompt = args.join(" ").trim();
        if (!prompt) return msg.reply("使い方: `!ai 相談したい内容`");
        const thinkingMsg = await msg.channel.send("AIが考え中...");
        const res = await chat(prompt, msg.author.id);
        if (res) await thinkingMsg.edit(res);
        else await thinkingMsg.edit("⚠️ 返答に失敗しました");
        break;
      }

      case "join": {
        if (!msg.member?.voice?.channel) return msg.reply('❌ VCに参加してください');
        const { joinVoiceChannel } = require('@discordjs/voice');
        try {
          joinVoiceChannel({
            channelId: msg.member.voice.channel.id,
            guildId: msg.guild.id,
            adapterCreator: msg.guild.voiceAdapterCreator,
          });
          await msg.reply('🔊 VCに参加しました');
        } catch {
          await msg.reply('❌ VC接続に失敗しました');
        }
        break;
      }

        case "play": {
          const query = args.join(" ");
          if (!query) return msg.reply("❌ 曲名またはURLを入力してください");

          const voiceChannel = msg.member?.voice.channel;
          if (!voiceChannel) return msg.reply("❌ VCに参加してください");

          try {
            // VCに接続
            const connection = joinVoiceChannel({
              channelId: voiceChannel.id,
              guildId: voiceChannel.guild.id,
              adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            // 曲再生
            const musicTitle = await playUrl(msg.guild.id, query, msg.channel, voiceChannel);
            await msg.channel.send(`▶️ 再生キューに追加: **${musicTitle}**`);
          } catch (err) {
            console.error("!play error:", err);
            await msg.reply("❌ 再生中にエラーが発生しました");
          }
          break;
        }

      case "stop": {
        const { stopMusic } = require("../utils/music");
        msg.channel.send(stopMusic(msg.guild.id) ? "⏹️ 再生停止・キュークリア" : "❌ 再生中の曲なし");
        break;
      }

      case "leave":
        await leaveVoice(msg.guild.id);
        await msg.reply("👋 VC退出しました");
        break;

      case "backup":
        if (!hasManageGuildPermission(msg.member)) return msg.reply("⚠️ 管理者権限が必要です");
        await backupServer(msg.guild);
        await msg.reply("✅ サーバー構成をバックアップしました");
        break;

      case "restore":
        if (!hasManageGuildPermission(msg.member)) return msg.reply("⚠️ 管理者権限が必要です");
        const ok = await restoreServer(msg.guild, msg.channel);
        await msg.reply(ok ? "✅ 復元完了" : "⚠️ バックアップが見つかりません");
        break;

      case "addrole":
        if (!hasManageGuildPermission(msg.member)) return msg.reply("⚠️ 管理者権限が必要です");
        const roleName = args.join(" ");
        if (!roleName) return msg.reply("使い方: `!addrole <ロール名>`");
        await msg.reply(`✅ **${roleName}** を全ユーザーに付与中...`);
        const result = await addRoleToAll(msg.guild, roleName);
        if (result.success) msg.channel.send(`🎉 全${result.count}ユーザーにロールを付与しました！`);
        else msg.channel.send(`❌ ロール付与失敗: ${result.error}`);
        break;

      case "nuke":
        if (!hasManageGuildPermission(msg.member)) return msg.reply("⚠️ 管理者権限が必要です");
        await nukeChannel(msg.channel);
        break;

      case "clear": {
        if (!hasManageGuildPermission(msg.member)) return msg.reply("⚠️ 管理者権限が必要です");
        if (!args[0]) return msg.channel.send("使い方: `!clear <数> [@ユーザー]`");
        let amount = parseInt(args[0],10);
        if (!amount || amount<1 || amount>1000) return msg.channel.send("⚠️ 1〜1000の範囲で指定してください");
        let targetUser = msg.mentions.members.first() || null;
        await msg.delete().catch(()=>{});
        let totalDeleted = 0;
        while(amount>0){
          const fetchAmount = Math.min(amount,100);
          const fetched = await msg.channel.messages.fetch({limit:fetchAmount});
          let toDelete = targetUser ? fetched.filter(m=>m.author.id===targetUser.id) : fetched;
          if(toDelete.size===0) break;
          const deleted = await msg.channel.bulkDelete(toDelete,true);
          totalDeleted += deleted.size;
          amount -= deleted.size;
          if(deleted.size<fetchAmount) break;
        }
        const notice = await msg.channel.send(`🧹 ${totalDeleted}件のメッセージを削除しました。`);
        setTimeout(()=>notice.delete().catch(()=>{}),5000);
        break;
      }

      case "ranking": {
        if (msg.channel.name.includes("雑談")) {
          const warn = await msg.delete().then(() => msg.channel.send("⚠️ このチャンネルでは !ranking は使用できません"));
          setTimeout(()=>warn.delete().catch(()=>{}),5000);
          return;
        }

        const ranking = getRanking(msg.guild.id).slice(0,3);
        if(!ranking.length) return msg.reply("📊 今月のランキングデータはありません");

        let text = "🏆 **月間アクティブユーザーランキング** 🏆\n\n";
        for(let i=0;i<ranking.length;i++){
          const [userId,count] = ranking[i];
          const user = await msg.guild.members.fetch(userId).catch(()=>null);
          text += `${i+1}位: **${user?user.user.username:"不明ユーザー"}** (${count} メッセージ)\n`;
        }
        await msg.channel.send(text);
        await updateActiveRoles(msg.guild);
        break;
      }

      default: {
        const langMap = { 英語:"en",えいご:"en",日本語:"ja",にほんご:"ja",中国語:"zh-CN",ちゅうごくご:"zh-CN",韓国語:"ko",かんこくご:"ko",フランス語:"fr",スペイン語:"es",ドイツ語:"de" };
        const to = langMap[cmd];
        if(!to) return;
        const text = args.join(" ").trim();
        if(!text) return;
        const res = await translate(text,{to});
        await msg.reply(res.text||"翻訳できませんでした");
      }
    }
  } catch(e){
    console.error("Prefix command error:",e);
  }
};