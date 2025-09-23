// utils/quiz.js
const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

let quizzes = {};
const blockedChannelIds = [
  "1415189080861315112",
  "1416773830537642115",
  "1409520151749070880",
  "1410891781846994956"
];

// ---------------- クイズデータロード ----------------
function preloadQuizzes() {
  try {
    const data = fs.readFileSync(path.join(__dirname, "../quizzes.json"), "utf-8");
    quizzes = JSON.parse(data);
    console.log("✅ Quiz data loaded successfully.");
  } catch (err) {
    console.error("❌ Failed to load quiz data:", err);
  }
}

// ---------------- ランダムに問題取得 ----------------
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

// ---------------- クイズマネージャ ----------------
async function quizManager({ interaction = null, message = null }) {
  const channel = interaction?.channel || message?.channel;
  const user = interaction?.user || message?.author;

  if (!channel || !user) return;

  // 禁止チャンネル・雑談チャンネル
  if (blockedChannelIds.includes(channel.id) || channel.name.includes("雑談")) {
    const reply = interaction
      ? await interaction.reply({ content: "❌ このチャンネルではクイズは使えません", ephemeral: true })
      : await channel.send("❌ このチャンネルではクイズは使えません");

    if (message) {
      setTimeout(() => {
        reply.delete().catch(() => {});
        message.delete().catch(() => {});
      }, 5000);
    }
    return;
  }

  const quiz = getRandomQuiz();
  if (!quiz || !quiz.choices || quiz.choices.length === 0) {
    const msg = interaction
      ? await interaction.reply({ content: "⚠️ クイズデータが不十分です。", ephemeral: true })
      : await channel.send("⚠️ クイズデータが不十分です。");
    return;
  }

  // ボタン作成
  const buttons = new ActionRowBuilder();
  quiz.choices.forEach((choice, idx) => {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`quiz_${idx}`)
        .setLabel(choice)
        .setStyle(ButtonStyle.Primary)
    );
  });

  if (interaction) await interaction.reply({ content: `📝 **${quiz.category}クイズ**\n${quiz.question}`, components: [buttons] });
  else await channel.send({ content: `📝 **${quiz.category}クイズ**\n${quiz.question}`, components: [buttons] });

  // Collector
  const filter = (i) => i.user.id === user.id;
  const collector = channel.createMessageComponentCollector({ filter, time: 30000 });

  collector.on("collect", async (i) => {
    if (!i.isButton()) return;
    const selectedIndex = parseInt(i.customId.split("_")[1], 10);
    const isCorrect = quiz.choices[selectedIndex] === quiz.answer;

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

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      channel.send(`⌛ 時間切れ！ 正解は **${quiz.answer}** でした。`);
    }
  });

  // 次の問題ボタン
  const nextCollector = channel.createMessageComponentCollector({ filter, time: 60000 });
  nextCollector.on("collect", async (i) => {
    if (i.customId === "quiz_next") {
      await i.deferUpdate();
      await quizManager({ interaction, message }); // 再帰的に次の問題
    }
  });
}

module.exports = {
  preloadQuizzes,
  getRandomQuiz,
  quizManager,
  blockedChannelIds
};