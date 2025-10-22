// commands/slash.js
const {
  SlashCommandBuilder,
  Routes,
  REST,
  PermissionFlagsBits,
} = require("discord.js");

const { chat } = require("../utils/ai");
const { fetchWeather, loadUserWeatherPref } = require("../utils/weather");
const verifySetup = require("../utils/verify");
const { getLevelData, setLevelAndXp, calculateRequiredXp } = require("../utils/level");
const { quizManager } = require("../utils/quiz");
const { playMusic, skipMusic, stopMusic, pauseMusic, resumeMusic } = require("../utils/music");
const { backupServer, restoreServer, nukeChannel, clearMessages, addRoleToAll, lockChannels } = require("../utils/guild");
// const { panelCommand } = require("../utils/panel"); // ★ 削除
const ticket = require("../utils/ticket"); 
// const rolePanel = require("../utils/panel"); // ★ 削除

// ★ 新しいロールパネルコマンドをインポート
const rolePanelCommands = require("./rolepanel"); 

// ---------------- コマンド定義 ----------------
const commands = [
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("AIと対話します")
    .addStringOption(opt => opt.setName("prompt").setDescription("AIへの質問").setRequired(true)),

  new SlashCommandBuilder()
    .setName("weather")
    .setDescription("天気を取得します")
    .addStringOption(opt => opt.setName("location").setDescription("場所").setRequired(false)),

  new SlashCommandBuilder()
    .setName("level")
    .setDescription("自分または指定ユーザーのレベルを確認します")
    .addUserOption(opt => opt.setName("user").setDescription("確認するユーザー").setRequired(false)),

  new SlashCommandBuilder()
    .setName("setlevel")
    .setDescription("ユーザーのレベルとXPを設定します（管理者専用）")
    .addUserOption(opt => opt.setName("user").setDescription("対象ユーザー").setRequired(true))
    .addIntegerOption(opt => opt.setName("level").setDescription("設定するレベル").setRequired(true))
    .addIntegerOption(opt => opt.setName("xp").setDescription("設定するXP").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder().setName("quiz").setDescription("クイズを開始します"),

  // 音楽
  new SlashCommandBuilder().setName("mplay").setDescription("音楽を再生します")
    .addStringOption(opt => opt.setName("url").setDescription("YouTube URL").setRequired(true)),
  new SlashCommandBuilder().setName("mskip").setDescription("曲をスキップします"),
  new SlashCommandBuilder().setName("mstop").setDescription("音楽を停止します"),
  new SlashCommandBuilder().setName("mpause").setDescription("音楽を一時停止します"),
  new SlashCommandBuilder().setName("mresume").setDescription("音楽を再開します"),

  // サーバー管理
  new SlashCommandBuilder().setName("backup").setDescription("サーバーをバックアップします（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("restore").setDescription("サーバーをリストアします（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("nuke").setDescription("チャンネルを爆破します（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("clear").setDescription("メッセージを一括削除します（管理者専用）")
    .addIntegerOption(opt => opt.setName("amount").setDescription("削除する数").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName("addroleall").setDescription("全員にロールを付与します（管理者専用）")
    .addRoleOption(opt => opt.setName("role").setDescription("付与するロール").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("lock").setDescription("全チャンネルをロックします（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // 認証パネル設置
  new SlashCommandBuilder()
    .setName("verifysetup")
    .setDescription("認証メッセージを設置します（管理者専用）")
    .addRoleOption(opt => opt.setName("role").setDescription("認証後に付与するロール").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // ★ ロールパネル: 新しい rolepanel.js からコマンド定義を展開
  ...rolePanelCommands.data,

  // チケットパネル設置
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("チケット作成用パネルを設置します（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // 招待リンク作成
  new SlashCommandBuilder().setName("invite").setDescription("自分専用の招待リンクを作成します"),

  // 招待数確認
  new SlashCommandBuilder().setName("invitecount").setDescription("自分の招待数を確認します"),
];

// ---------------- コマンド登録 ----------------
async function registerSlashCommands(client) {
  if (!client.user) throw new Error("client.user がまだ存在しません。Botは ready ですか？");

  const rest = new REST({ version: "10" }).setToken(client.token);

  try {
    console.log("📌 スラッシュコマンド登録開始");
    // 新しいコマンドを登録するために、Bot起動時に実行してください
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands.map(c => c.toJSON()),
    });
    console.log("✅ スラッシュコマンド登録完了");
  } catch (err) {
    console.error("❌ スラッシュコマンド登録失敗:", err);
  }
}

// ---------------- サーバークールダウン ----------------
const SERVER_COOLDOWN_TIME = 2; // 秒
const serverCooldowns = new Map();

// ---------------- コマンド実行処理 ----------------
async function handleSlashCommand(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  // サーバー全体クールダウン判定
  const lastServerUsed = serverCooldowns.get(interaction.guild.id) || 0;
  if (Date.now() - lastServerUsed < SERVER_COOLDOWN_TIME * 1000) {
    await interaction.reply({ content: "コマンドは少し待ってから実行してください。", ephemeral: true });
    return;
  }
  serverCooldowns.set(interaction.guild.id, Date.now());

  const { commandName, channel, user } = interaction;

  try {
    if (commandName === "ai") {
      const prompt = interaction.options.getString("prompt");
      await interaction.deferReply({ ephemeral: true });
      const res = await chat(prompt);
      await interaction.editReply(res);
    }

    else if (commandName === "weather") {
      let location = interaction.options.getString("location");
      if (!location) {
        const userPref = await loadUserWeatherPref(user.id);
        location = userPref || "Tokyo";
      }
      await interaction.deferReply({ ephemeral: true });
      const res = await fetchWeather(location);
      await interaction.editReply(res);
    }

    else if (commandName === "level") {
      const targetUser = interaction.options.getUser("user") || user;
      const data = getLevelData(channel.guild.id, targetUser.id);
      const nextXp = calculateRequiredXp(data.level + 1);
      const xpDisplay = nextXp ?? "MAX";
      await interaction.reply({
        content: `📊 ${targetUser.tag} のレベル: ${data.level}, XP: ${data.xp}/${xpDisplay}`,
        ephemeral: true,
      });
    }

    else if (commandName === "setlevel") {
      const targetUser = interaction.options.getUser("user");
      const level = interaction.options.getInteger("level");
      const xp = interaction.options.getInteger("xp");
      await setLevelAndXp(channel.guild.id, targetUser.id, level, xp);
      await interaction.reply({ content: `✅ ${targetUser.tag} のレベルを ${level}, XPを ${xp} に設定しました`, ephemeral: true });
    }

    else if (commandName === "quiz") {
      await quizManager(interaction, interaction.user);
    }

    else if (commandName === "mplay") {
      const url = interaction.options.getString("url");
      await playMusic(interaction, url);
    } else if (commandName === "mskip") await skipMusic(interaction);
    else if (commandName === "mstop") await stopMusic(interaction);
    else if (commandName === "mpause") await pauseMusic(interaction);
    else if (commandName === "mresume") await resumeMusic(interaction);

    else if (commandName === "backup") await backupServer(interaction);
    else if (commandName === "restore") await restoreServer(interaction);
    else if (commandName === "nuke") await nukeChannel(interaction);
    else if (commandName === "clear") {
      const amount = interaction.options.getInteger("amount");
      await clearMessages(interaction, amount);
    } 
      else if (commandName === "addroleall") {
        const role = interaction.options.getRole("role");
        if (!role) {
          return interaction.reply({ content: '❌ ロールが指定されていません。', ephemeral: true });
        }
        const result = await addRoleToAll(interaction.guild, role.id);
        if (!result || !result.success) {
          return interaction.reply({ content: `❌ 付与に失敗しました: ${result?.error || '不明なエラー'}`, ephemeral: true });
        }
        return interaction.reply({ content: `✅ 全ユーザーにロール「${role.name}」を付与しました。（付与数: ${result.count}）`, ephemeral: true });
      }
    else if (commandName === "lock") await lockChannels(interaction);

    else if (commandName === "verifysetup") {
      await verifySetup.execute(interaction);
    }

    // else if (commandName === "panel") await panelCommand(interaction); // ★ 削除

    // ★ 新しいロールパネルコマンドの実行処理
    else if (commandName === "rolepanel" || commandName === "rolepaneladd") {
      await rolePanelCommands.execute(interaction);
    }

    else if (commandName === "ticket") {
      await ticket.sendTicketPanel(interaction);
    }

    else if (commandName === "invite") {
      const url = await createInvite(interaction.member);
      await interaction.reply({ content: `🔗 あなた専用の招待リンク: ${url}`, ephemeral: true });
    }

    else if (commandName === "invitecount") {
      const count = await fetchInviteCount(interaction.member);
      await interaction.reply({ content: `📊 あなたの招待数は **${count}** 人です`, ephemeral: true });
    }
  } catch (err) {
    console.error("❌ SlashCommand Error:", err);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: "❌ コマンド実行中にエラーが発生しました", ephemeral: true });
    } else {
      await interaction.reply({ content: "❌ コマンド実行中にエラーが発生しました", ephemeral: true });
    }
  }
}

// ---------------- ボタン実行処理 ----------------
// メインファイルで role_button_XXX のボタンが押されたときに呼び出されることを想定
async function handleButtonInteraction(interaction) {
  if (!interaction.isButton()) return;
  // role_button_XXX のカスタムIDを持つボタンを rolepanel.js のハンドラに渡す
  if (interaction.customId.startsWith("role_button_")) {
    await rolePanelCommands.buttonHandler(interaction);
  }
  // 他のカスタムIDのボタン処理はここに続く
}

module.exports = {
  registerSlashCommands,
  handleSlashCommand,
  handleButtonInteraction, // メインファイルで interactionCreate イベントから呼び出す
};
