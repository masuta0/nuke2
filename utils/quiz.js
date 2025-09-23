// utils/quiz.js
const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require("discord.js");

let quizzes = {};

// JSONファイルを読み込む関数
function preloadQuizzes() {
  try {
    const filePath = path.join(__dirname, "../quizzes.json");
    const data = fs.readFileSync(filePath, "utf-8");
    quizzes = JSON.parse(data);
    console.log("✅ Quiz data loaded successfully.");
  } catch (err) {
    console.error("❌ Failed to load quiz data:", err);
  }
}

// ランダムに問題を取得
function getRandomQuiz(category = null) {
  let categories = Object.keys(quizzes);
  if (categories.length === 0) return null;

  if (category === 'mix') {
    const allQuestions = Object.values(quizzes).flat();
    if (allQuestions.length === 0) return null;
    const randomQuestion = allQuestions[Math.floor(Math.random() * allQuestions.length)];
    return {
      category: 'mix',
      question: randomQuestion.q,
      answer: randomQuestion.a,
      choices: randomQuestion.choices
    };
  }

  if (category && quizzes[category]) {
    categories = [category];
  }

  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const questions = quizzes[randomCategory];
  if (!questions || questions.length === 0) return null;

  const randomQuestion = questions[Math.floor(Math.random() * questions.length)];

  return { 
    category: randomCategory, 
    question: randomQuestion.q, 
    answer: randomQuestion.a, 
    choices: randomQuestion.choices 
  };
}

// クイズを出題する関数（ボタン方式）
async function askQuiz(channel, user, category) {
  // 「雑談」チャンネルでは利用不可
  if (channel.name.includes("雑談")) {
    await channel.send(`❌ このチャンネルではクイズを使えません。`);
    return;
  }

  const quiz = getRandomQuiz(category);
  if (!quiz) {
    await channel.send("⚠️ クイズデータが見つかりません。");
    return;
  }

  // ボタンを作成
  const row = new ActionRowBuilder();
  quiz.choices.forEach((choice, index) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`quiz_${index}`)
        .setLabel(`${index + 1}`)
        .setStyle(ButtonStyle.Primary)
    );
  });

  // クイズメッセージ送信
  const quizMsg = await channel.send({
    content: `📝 **${quiz.category}クイズ**\n${quiz.question}`,
    components: [row],
  });

  try {
    const filter = (interaction) => interaction.user.id === user.id;
    const collected = await quizMsg.awaitMessageComponent({ filter, componentType: ComponentType.Button, time: 30000 });
    const userIndex = parseInt(collected.customId.split("_")[1], 10);
    const correctIndex = quiz.choices.indexOf(quiz.answer);

    const isCorrect = userIndex === correctIndex;

    await collected.update({
      content: isCorrect 
        ? `✅ 正解！ 🎉 (${quiz.answer})` 
        : `❌ 不正解... 正解は **${quiz.answer}** でした。`,
      components: [],
    });

    // 続行用ボタン
    const continueRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("quiz_continue")
        .setLabel("👍 次の問題")
        .setStyle(ButtonStyle.Success)
    );

    const resultMsg = await channel.send({
      content: "次の問題を続けますか？",
      components: [continueRow],
    });

    const contFilter = (interaction) => interaction.user.id === user.id && interaction.customId === "quiz_continue";
    const contCollected = await resultMsg.awaitMessageComponent({ filter: contFilter, componentType: ComponentType.Button, time: 30000 }).catch(() => null);
    if (contCollected) {
      await resultMsg.delete();
      await askQuiz(channel, user, category);
    }

  } catch (err) {
    await quizMsg.edit({ content: `⌛ 時間切れ！ 正解は **${quiz.answer}** でした。`, components: [] });
  }
}

module.exports = { preloadQuizzes, getRandomQuiz, askQuiz };