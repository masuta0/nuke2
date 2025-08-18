// utils/quiz.js
const fs = require("fs");
const path = require("path");

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

  if (category && quizzes[category]) {
    categories = [category];
  }

  const randomCategory =
    categories[Math.floor(Math.random() * categories.length)];
  const questions = quizzes[randomCategory];
  if (!questions || questions.length === 0) return null;

  const randomQuestion =
    questions[Math.floor(Math.random() * questions.length)];

  return { 
    category: randomCategory, 
    question: randomQuestion.q, 
    answer: randomQuestion.a, 
    choices: randomQuestion.choices 
  };
}

// クイズを出題する関数
async function askQuiz(channel, user, category) {
  const quiz = getRandomQuiz(category);
  if (!quiz) {
    await channel.send("⚠️ クイズデータが見つかりません。");
    return;
  }

  // 選択肢を番号付きリストに整形
  const choicesText = quiz.choices
    .map((choice, index) => `${index + 1}. ${choice}`)
    .join("\n");

  const questionMsg = await channel.send(
    `📝 **${quiz.category}クイズ**\n${quiz.question}\n\n${choicesText}\n(答えを30秒以内に入力してください)`
  );

  // 答えを待つ
  try {
    const collected = await channel.awaitMessages({
      filter: (m) => m.author.id === user.id,
      max: 1,
      time: 30000,
      errors: ["time"],
    });

    const answer = collected.first().content.trim();

    // ユーザーの回答が「答えの文字そのもの」または「答えの番号」かを確認
    const isCorrectByText = answer.toLowerCase() === quiz.answer.toLowerCase();

    // 全角・半角の数字を統一して判定
    const normalizedAnswer = answer.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    const answerNumber = parseInt(normalizedAnswer, 10);
    const answerIndex = quiz.choices.findIndex(c => c === quiz.answer);
    const isCorrectByNumber = !isNaN(answerNumber) && (answerNumber - 1) === answerIndex;

    if (isCorrectByText || isCorrectByNumber) {
      await channel.send(`✅ 正解！ 🎉 (${quiz.answer})`);
    } else {
      await channel.send(`❌ 不正解... 正解は **${quiz.answer}** でした。`);
    }
  } catch (err) {
    await channel.send(`⌛ 時間切れ！ 正解は **${quiz.answer}** でした。`);
  }

  // 正解発表のあとに続行確認
  const followMsg = await channel.send(
    "📝 クイズを続けますか？ 👍 を押すと次の問題を出します"
  );
  await followMsg.react("👍");
}

module.exports = { preloadQuizzes, getRandomQuiz, askQuiz };
