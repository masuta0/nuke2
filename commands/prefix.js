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
| !ranking | 月間アクティブユーザーランキング |
`;

const RANKING_BANNED_CHANNELS = [
  '雑談', // チャンネル名に"雑談"を含む場合禁止
  // 追加でチャンネルIDで指定も可能: '123456789012345678'
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
    const remaining = (lastUsed + COOLDOWN_TIME * 1000) - Date.now();
    if (remaining > 0) {
      const warn = await msg.reply(`⏳ クールダウン中です。${Math.ceil(remaining/1000)}秒後に再度お試しください。`);
      setTimeout(()=>warn.delete().catch(()=>{}),5000);
      return;
    }
  }
  cooldowns.set(msg.author.id, Date.now());

  switch (cmd) {
    case "help": {
      await msg.author.send(helpMessage).catch(() => {});
      await msg.reply("📩 DMを確認してください！");
      break;
    }
    case "ping": {
      await msg.reply("🏓 Pong!");
      break;
    }
    case "uptime": {
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);
      await msg.reply(`⏱️ 稼働時間: ${hours}時間${minutes}分${seconds}秒`);
      break;
    }
    case "ranking": {
      if (RANKING_BANNED_CHANNELS.some(name => msg.channel.name.includes(name) || msg.channel.id === name)) {
        const warn = await msg.channel.send("⚠️ このチャンネルでは !ranking は使用できません");
        setTimeout(() => warn.delete().catch(() => {}), 5000);
        msg.delete().catch(() => {});
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
      // await updateActiveRoles(msg.guild, /* roleId */); // 必要ならロールID指定
      break;
    }
    case "天気": {
      const location = args.join(' ') || "Tokyo";
      const weatherRes = await fetchWeather(location);
      await msg.reply(weatherRes);
      break;
    }
    case "ai": {
      const prompt = args.join(' ');
      if (!prompt) return msg.reply("質問内容を入力してください。");
      if (await checkAiCooldown(msg.author.id)) {
        return msg.reply("⏳ AIのクールダウン中です。少し待ってから再度お試しください。");
      }
      setAiCooldown(msg.author.id);
      const aiRes = await chat(prompt);
      await msg.reply(aiRes);
      break;
    }
    case "クイズ": {
      const quiz = quizManager.getQuiz();
      if (!quiz) return msg.reply("現在クイズがありません。");
      await msg.reply(`問題: ${quiz.question}`);
      // ...解答受付処理等
      break;
    }
    case "addrole": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      const roleName = args.join(' ');
      if (!roleName) return msg.reply("ロール名を指定してください。");
      await addRoleToAll(msg.guild, roleName);
      await msg.reply(`ロール: ${roleName} を全員に付与しました。`);
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
    case "nuke": {
      if (!hasManageGuildPermission(msg.member)) return msg.reply("権限がありません。");
      await nukeChannel(msg.channel);
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
      await restoreServer(msg.guild);
      await msg.reply("サーバー復元が完了しました。");
      break;
    }
    default: {
      // 存在しないコマンドの場合の処理
      break;
    }
  }
};