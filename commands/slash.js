// commands/slash.js
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { chat } = require("../utils/ai");
const { joinVoice, playUrl, leaveVoice } = require("../utils/music");
const { getVoiceConnection } = require("@discordjs/voice");
const { askQuiz } = require("../utils/quiz");
const { saveUserWeatherPref, loadUserWeatherPref, fetchWeather } = require("../utils/weather");
const {
  hasManageGuildPermission,
  backupServer,
  restoreServer,
  nukeChannel,
  clearMessages,
  addRoleToAll,
  lockChannels,
} = require("../utils/guild");
const { getLevelData, setLevelAndXp, calculateRequiredXp } = require("../utils/level");
const verifyCommand = require("../utils/verify");
const panelCommand = require("../utils/panel");
const ticketCommand = require("../utils/ticket"); // ✅ ticket用

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// AI クールダウン管理
const aiCooldown = new Map();
const aiCooldownExemptIds = [
  "1401303406596853785",
  "1366740571707801610",
  "1409820488301023257",
];

async function registerSlashCommands(client) {
  // ====== Slashコマンド定義 ======
  const commands = [
    new SlashCommandBuilder()
      .setName("ai")
      .setDescription("AIに質問")
      .addStringOption(o => o.setName("prompt").setDescription("質問内容").setRequired(true)),

    new SlashCommandBuilder()
      .setName("level")
      .setDescription("レベル管理")
      .addSubcommand(sub =>
        sub
          .setName("check")
          .setDescription("レベルを確認")
          .addUserOption(opt =>
            opt.setName("target").setDescription("対象ユーザー").setRequired(false)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName("set")
          .setDescription("レベルを設定")
          .addUserOption(opt =>
            opt.setName("target").setDescription("対象ユーザー").setRequired(true)
          )
          .addIntegerOption(opt =>
            opt.setName("level").setDescription("設定レベル").setRequired(true)
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("天気")
      .setDescription("天気を表示／場所を保存")
      .addStringOption(o =>
        o.setName("場所").setDescription("例: 東京、大阪、札幌...").setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("クイズ")
      .setDescription("クイズを出題")
      .addStringOption(o =>
        o.setName("カテゴリ").setDescription("general / trivia / railway / mix(既定)").setRequired(false)
      ),

    new SlashCommandBuilder().setName("join").setDescription("ボイスチャンネルに参加"),

    new SlashCommandBuilder()
      .setName("play")
      .setDescription("音楽を再生（URLまたは検索語）")
      .addStringOption(o =>
        o.setName("query").setDescription("YouTube/Spotify URLまたは検索語").setRequired(true)
      ),

    new SlashCommandBuilder().setName("stop").setDescription("音楽を停止"),
    new SlashCommandBuilder().setName("leave").setDescription("ボイスチャンネルから退出"),

    new SlashCommandBuilder()
      .setName("backup")
      .setDescription("サーバー構成をバックアップ")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("restore")
      .setDescription("バックアップから復元")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("nuke")
      .setDescription("チャンネルを再作成")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("clear")
      .setDescription("メッセージ一括削除")
      .addIntegerOption(o =>
        o.setName("amount").setDescription("1〜1000").setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName("addrole")
      .setDescription("全ユーザーにロールを付与")
      .addStringOption(o =>
        o.setName("role_name").setDescription("ロール名またはID").setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
      .setName("lock")
      .setDescription("「認証」を含まないチャンネルをロック")
      .addRoleOption(o =>
        o.setName("role").setDescription("表示を許可するロール").setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
      .setName("unlock")
      .setDescription("すべてのチャンネルをアンロック")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    verifyCommand.data,
    ...panelCommand.data,

    new SlashCommandBuilder().setName("ticket").setDescription("チケット作成ボタンを表示"),
  ];

  // ====== Slashコマンド登録 ======
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: commands.map(c => c.toJSON()),
  });
  console.log("✅ Slashコマンド登録完了");

  // ====== interaction処理 ======
  client.on("interactionCreate", async interaction => {
    try {
      // ========= SlashCommand =========
      if (interaction.isChatInputCommand()) {
        const name = interaction.commandName;
        // サーバー内のみ有効なコマンド
        if (!interaction.guild && !["ai", "天気"].includes(name))
          return interaction.reply({
            content: "❌ このコマンドはサーバー内でのみ実行できます。",
            ephemeral: true,
          });

        if (["rolepanel", "rolepaneladd"].includes(name))
          return panelCommand.execute(interaction);
        if (name === "verifysetup") return verifyCommand.execute(interaction);
        if (name === "ticket") return ticketCommand.sendTicketPanel(interaction);

        if (name === "ai") {
          if (!aiCooldownExemptIds.includes(interaction.user.id)) {
            const now = Date.now();
            const last = aiCooldown.get(interaction.user.id) || 0;
            const cooldown = 30 * 1000;
            if (now - last < cooldown)
              return interaction.reply({
                content: `❌ クールタイム中。あと${Math.ceil(
                  (cooldown - (now - last)) / 1000
                )}秒`,
                ephemeral: true,
              });
            aiCooldown.set(interaction.user.id, now);
          }
          const prompt = interaction.options.getString("prompt", true);
          await interaction.deferReply();
          const res = await chat(prompt, interaction.user.id);
          return interaction.editReply(
            `**質問:** ${prompt}\n**回答:**\n${res || "⚠️ 失敗"}`
          );
        }

        if (name === "level") {
          const sub = interaction.options.getSubcommand();
          if (sub === "check") {
            const target = interaction.options.getUser("target") || interaction.user;
            const data = getLevelData(interaction.guild.id, target.id);
            const level = data.level;
            const xp = data.xp;
            const req = calculateRequiredXp(level + 1);
            return interaction.reply({
              embeds: [
                {
                  color: 0x00aaff,
                  title: `${target.username} のレベル`,
                  fields: [
                    { name: "レベル", value: `${level}`, inline: true },
                    { name: "XP", value: `${xp}`, inline: true },
                    {
                      name: "次のレベルまで",
                      value: req ? `${req - xp} XP` : "最大",
                    },
                  ],
                },
              ],
            });
          }
          if (sub === "set") {
            if (!hasManageGuildPermission(interaction.member))
              return interaction.reply({ content: "❌ 権限不足", ephemeral: true });
            const target = interaction.options.getUser("target");
            const lv = interaction.options.getInteger("level");
            await setLevelAndXp(interaction.guild.id, target.id, lv);
            return interaction.reply(
              `✅ ${target.username} のレベルを ${lv} に設定`
            );
          }
        }
        if (command === "ticket") return ticketCommand.modalHandler(interaction); // ✅ 追加
        if (name === "天気") {
          await interaction.deferReply({ ephemeral: true });
          const place = interaction.options.getString("場所");
          if (place) {
            await saveUserWeatherPref(interaction.user.id, place);
            return interaction.editReply(`✅ 保存しました: ${place}`);
          } else {
            const pref = await loadUserWeatherPref(interaction.user.id);
            if (!pref) return interaction.editReply("⚠️ 場所を指定してください");
            const text = await fetchWeather(pref);
            return interaction.editReply(text || "⚠️ 失敗");
          }
        }

        if (name === "クイズ") {
          await interaction.deferReply();
          const cat = interaction.options.getString("カテゴリ") || "mix";
          await askQuiz(interaction.channel, interaction.user, cat);
          return interaction.editReply("📝 出題しました！");
        }

        if (name === "join") {
          if (!interaction.member?.voice?.channel)
            return interaction.reply({ content: "⚠️ VCに入ってください", ephemeral: true });
          await interaction.deferReply();
          const ok = await joinVoice(interaction.guild, interaction.member.voice.channel);
          return interaction.editReply(ok ? "🔊 参加しました" : "⚠️ 失敗");
        }

        if (name === "play") {
          await interaction.deferReply();
          const query = interaction.options.getString("query", true);
          const m = interaction.guild.members.cache.get(interaction.user.id);
          if (!m?.voice?.channel) return interaction.editReply("⚠️ VCに参加してください");
          await joinVoice(interaction.guild, m.voice.channel);
          const added = await playUrl(interaction.guild.id, query, interaction.channel);
          return interaction.editReply(added ? `▶️ ${added}` : "⚠️ 失敗");
        }

        if (name === "stop") {
          await interaction.deferReply();
          const conn = getVoiceConnection(interaction.guild.id);
          if (conn) {
            conn.destroy();
            return interaction.editReply("⏹️ 停止しました");
          }
          return interaction.editReply("⚠️ 再生中なし");
        }

        if (name === "leave") {
          await interaction.deferReply();
          await leaveVoice(interaction.guild.id);
          return interaction.editReply("👋 退出しました");
        }

        if (name === "backup") {
          await interaction.deferReply();
          if (!hasManageGuildPermission(interaction.member))
            return interaction.editReply("⚠️ 権限不足");
          await backupServer(interaction.guild);
          return interaction.editReply("✅ バックアップ完了");
        }

        if (name === "restore") {
          await interaction.deferReply();
          if (!hasManageGuildPermission(interaction.member))
            return interaction.editReply("⚠️ 権限不足");
          const ok = await restoreServer(interaction.guild, interaction.channel);
          return interaction.editReply(ok ? "✅ 復元完了" : "⚠️ バックアップなし");
        }

        if (name === "addrole") {
          await interaction.deferReply();
          if (!hasManageGuildPermission(interaction.member))
            return interaction.editReply("⚠️ 権限不足");
          const roleName = interaction.options.getString("role_name", true);
          const result = await addRoleToAll(interaction.guild, roleName);
          return interaction.editReply(
            result.success
              ? `✅ ${result.count}人に付与`
              : `❌ 失敗: ${result.error}`
          );
        }

        if (name === "nuke") {
          await interaction.deferReply();
          if (!hasManageGuildPermission(interaction.member))
            return interaction.editReply("⚠️ 権限不足");
          await nukeChannel(interaction.channel);
          return interaction.editReply("💥 再作成しました");
        }

        if (name === "clear") {
          await interaction.deferReply();
          if (!hasManageGuildPermission(interaction.member))
            return interaction.editReply("⚠️ 権限不足");
          const amount = interaction.options.getInteger("amount", true);
          await clearMessages(interaction.channel, amount);
          return interaction.editReply(`🧹 ${amount}件削除`);
        }

        if (name === "lock") {
          await interaction.deferReply();
          if (!hasManageGuildPermission(interaction.member))
            return interaction.editReply("⚠️ 権限不足");
          const role = interaction.options.getRole("role");
          const result = await lockChannels(interaction.guild, role.id);
          return interaction.editReply(
            `✅ ロック: ${result.locked}件 / 維持: ${result.unlocked}件`
          );
        }

        if (name === "unlock") {
          await interaction.deferReply();
          if (!hasManageGuildPermission(interaction.member))
            return interaction.editReply("⚠️ 権限不足");
          const everyone = interaction.guild.roles.everyone;
          let count = 0;
          for (const [, ch] of interaction.guild.channels.cache) {
            if (![ChannelType.GuildText, ChannelType.GuildVoice].includes(ch.type)) continue;
            await ch.permissionOverwrites.edit(everyone, { ViewChannel: true });
            count++;
          }
          return interaction.editReply(`✅ アンロック: ${count}件`);
        }
      }

      // ========= ボタン処理 =========
      if (interaction.isButton()) {
        const [command] = interaction.customId.split("_");
        if (command === "verify") return verifyCommand.buttonHandler(interaction, client);
        if (command === "role") return panelCommand.buttonHandler(interaction);
        if (command === "ticket") return ticketCommand.buttonHandler(interaction);
      }

      // ========= モーダル処理 =========
      if (interaction.isModalSubmit()) {
        const [command] = interaction.customId.split("_");
        if (command === "verify") return verifyCommand.modalHandler(interaction, client);
      }
    } catch (e) {
      console.error("Slash handler error:", e);
      if (!interaction.replied) {
        try {
          await interaction.reply({ content: "❌ エラーが発生", ephemeral: true });
        } catch {}
      }
    }
  });
}

module.exports = registerSlashCommands;