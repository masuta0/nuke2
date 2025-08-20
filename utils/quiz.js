// utils/quiz.js

const fs = require("fs");
const path = require("path");

let quizzes = {};
const userQuizCounts = new Map();
const QUIZ_LIMIT = 3;

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

  // 'mix'カテゴリに対応
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

// ユーザーのクイズ利用回数をチェック＆更新
function checkAndIncrementQuizCount(userId) {
  const today = new Date().toISOString().slice(0, 10);
  let userStats = userQuizCounts.get(userId) || { count: 0, date: today };

  if (userStats.date !== today) {
    userStats.count = 0;
    userStats.date = today;
  }

  if (userStats.count >= QUIZ_LIMIT) {
    return { canPlay: false, remaining: 0 };
  }

  userStats.count++;
  userQuizCounts.set(userId, userStats);
  return { canPlay: true, remaining: QUIZ_LIMIT - userStats.count };
}

// クイズを出題する関数
async function askQuiz(channel, user, category) {
  const isChatChannel = channel.name.includes('雑談');

  let canPlay = true;
  let remaining = QUIZ_LIMIT;

  if (isChatChannel) {
    const checkResult = checkAndIncrementQuizCount(user.id);
    canPlay = checkResult.canPlay;
    remaining = checkResult.remaining;

    if (!canPlay) {
      await channel.send(`❌ ${user}さん、このチャンネルでの今日のクイズは上限の3回に達しました。明日また挑戦してね！`);
      return;
    }
  }

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

  try {
    const collected = await channel.awaitMessages({
      filter: (m) => m.author.id === user.id,
      max: 1,
      time: 30000,
      errors: ["time"],
    });

    const answer = collected.first().content.trim();

    const isCorrectByText = answer.toLowerCase() === quiz.answer.toLowerCase();

    const normalizedAnswer = answer.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    const answerNumber = parseInt(normalizedAnswer, 10);
    const answerIndex = quiz.choices.findIndex(c => c === quiz.answer);
    const isCorrectByNumber = !isNaN(answerNumber) && (answerNumber - 1) === answerIndex;

    if (isCorrectByText || isCorrectByNumber) {
      await channel.send(`✅ 正解！ 🎉 (${quiz.answer})${isChatChannel ? `\n**${user}さん、残りクイズ回数は ${remaining} 回です。**` : ''}`);
    } else {
      await channel.send(`❌ 不正解... 正解は **${quiz.answer}** でした。${isChatChannel ? `\n**${user}さん、残りクイズ回数は ${remaining} 回です。**` : ''}`);
    }
  } catch (err) {
    await channel.send(`⌛ 時間切れ！ 正解は **${quiz.answer}** でした。${isChatChannel ? `\n**${user}さん、残りクイズ回数は ${remaining} 回です。**` : ''}`);
  }

  const followMsg = await channel.send(
    "📝 クイズを続けますか？ 👍 を押すと次の問題を出します"
  );
  await followMsg.react("👍");
}

module.exports = { preloadQuizzes, getRandomQuiz, askQuiz };
