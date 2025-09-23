// utils/quiz.js
const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

// --- クイズデータ ---
let quizzes = {};
const blockedChannelIds = ["1415189080861315112", "1416773830537642115","1409520151749070880","1410891781846994956"]; // クイズ禁止チャンネル

// --- クイズデータロード ---
function preloadQuizzes() {
  try {
    const data = fs.readFileSync(path.join(__dirname, "../quizzes.json"), "utf-8");
    quizzes = JSON.parse(data);
    console.log("✅ Quiz data loaded successfully.");
  } catch (err) {
    console.error("❌ Failed to load quiz data:", err);
  }
}

// --- ランダムにクイズ取得 ---
function getRandomQuiz(category = null) {
  const categories = Object.keys(quizzes);
  if (categories.length === 0) return null;

  if (category && quizzes[category]) {
    const questions = quizzes[category];
    if (!questions || questions.length === 0) return null;
    const q = questions[Math.floor(Math.random() * questions.length)];
    return { category, ...q };
  }

  // ランダムカテゴリ
  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const questions = quizzes[randomCategory];
  if (!questions || questions.length === 0) return null;
  const q = questions[Math.floor(Math.random() * questions.length)];
  return { category: randomCategory, ...q };
}

// --- 注意メッセージ削除用ヘルパー ---
async function warnAndDelete(interaction, content, deleteAfter = 5000) {
  try {
    // 注意メッセージ送信
    const warnMsg = await interaction.reply({ content, ephemeral: false });
    // 5秒後に削除
    setTimeout(() => {
      warnMsg.delete().catch(() => {});
    }, deleteAfter);

    // コマンドメッセージ自体を削除
    try {
      if (interaction.deferred || interaction.replied) {
        interaction.deleteReply().catch(() => {});
      }
    } catch {}
  } catch (err) {
    console.error("❌ warnAndDelete error:", err);
  }
}

// --- クイズマネージャ ---
async function quizManager(interaction) {
  const { channel, user } = interaction;

  // 禁止チャンネル判定
  if (blockedChannelIds.includes(channel.id) || channel.name.includes("雑談")) {
    await warnAndDelete(interaction, "❌ このチャンネルではクイズは使えません");
    return;
  }

  const quiz = getRandomQuiz();
  if (!quiz || !quiz.choices || quiz.choices.length === 0) {
    await interaction.reply({ content: "⚠️ クイズデータが不十分です。", ephemeral: true });
    return;
  }

  // --- 選択肢ボタン作成 ---
  const buttons = new ActionRowBuilder();
  quiz.choices.forEach((choice, idx) => {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`quiz_${idx}`)
        .setLabel(choice)
        .setStyle(ButtonStyle.Primary)
    );
  });

  // クイズ問題を送信
  await interaction.reply({ content: `📝 **${quiz.category}クイズ**\n${quiz.question}`, components: [buttons] });

  // --- 回答ボタンのコレクター ---
  const filter = (i) => i.user.id === user.id;
  const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000 });

  collector.on("collect", async (i) => {
    if (!i.isButton()) return;
    const selectedIndex = parseInt(i.customId.split("_")[1], 10);
    const isCorrect = quiz.choices[selectedIndex] === quiz.answer;

    // 回答結果メッセージと次の問題ボタン
    await i.update({
      content: isCorrect
        ? `✅ 正解！ (${quiz.answer})`
        : `❌ 不正解... 正解は **${quiz.answer}** でした。`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("quiz_next")
            .setLabel("👍 次の問題")
            .setStyle(ButtonStyle.Success)
        ),
      ],
    });
  });

  collector.on("end", (collected, reason) => {
    if (reason === "time") {
      channel.send(`⌛ 時間切れ！ 正解は **${quiz.answer}** でした。`);
    }
  });

  // --- 次の問題ボタンのコレクター ---
  const nextCollector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });
  nextCollector.on("collect", async (i) => {
    if (i.customId === "quiz_next") {
      await i.deferUpdate();
      await quizManager(interaction); // 再帰的に次の問題
    }
  });
}

module.exports = {
  preloadQuizzes,
  getRandomQuiz,
  quizManager,
  blockedChannelIds,
};