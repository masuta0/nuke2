// utils/quiz.js
const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

// --- クイズデータ ---
let quizzes = {};
const blockedChannelIds = [
  "1415189080861315112",
  "1416773830537642115",
  "1409520151749070880",
  "1410891781846994956",
];

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

// --- ランダム問題取得 ---
function getRandomQuiz(category = null) {
  const categories = Object.keys(quizzes);
  if (categories.length === 0) return null;

  if (category && quizzes[category]) {
    const questions = quizzes[category];
    if (!questions || questions.length === 0) return null;
    const q = questions[Math.floor(Math.random() * questions.length)];
    return { category, ...q };
  }

  // ランダム
  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const questions = quizzes[randomCategory];
  if (!questions || questions.length === 0) return null;
  const q = questions[Math.floor(Math.random() * questions.length)];
  return { category: randomCategory, ...q };
}

// --- クイズ本体 ---
async function quizManager({ interaction = null, message = null }) {
  const channel = interaction?.channel || message?.channel;
  const user = interaction?.user || message?.author;

  if (!channel || !user) return;

  // 使用禁止チャンネルチェック
  if (blockedChannelIds.includes(channel.id) || channel.name.includes("雑談")) {
    const replyTarget = interaction || message;
    const sent = await (interaction
      ? replyTarget.reply({ content: "❌ このチャンネルではクイズは使えません", ephemeral: true })
      : replyTarget.channel.send("❌ このチャンネルではクイズは使えません"));

    if (!interaction && message) {
      setTimeout(() => {
        sent.delete().catch(() => {});
        message.delete().catch(() => {});
      }, 5000);
    }
    return;
  }

  // クイズ取得
  const quiz = getRandomQuiz();
  if (!quiz || !quiz.choices || quiz.choices.length === 0) {
    const replyTarget = interaction || message;
    await (interaction
      ? replyTarget.reply({ content: "⚠️ クイズデータが不十分です。", ephemeral: true })
      : replyTarget.channel.send("⚠️ クイズデータが不十分です。"));
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

  // メッセージ送信
  const sentMessage = await (interaction
    ? interaction.reply({ content: `📝 **${quiz.category}クイズ**\n${quiz.question}`, components: [buttons], fetchReply: true })
    : channel.send({ content: `📝 **${quiz.category}クイズ**\n${quiz.question}`, components: [buttons] }));

  // 回答ボタンの収集
  const filter = (i) => i.user.id === user.id;
  const collector = sentMessage.createMessageComponentCollector({ filter, time: 30000 });

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

  collector.on("end", (collected, reason) => {
    if (reason === "time") {
      channel.send(`⌛ 時間切れ！ 正解は **${quiz.answer}** でした。`);
    }
  });

  // 次の問題ボタン
  const nextCollector = sentMessage.createMessageComponentCollector({ filter, time: 60000 });
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
  blockedChannelIds,
};