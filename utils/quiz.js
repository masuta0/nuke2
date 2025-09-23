// utils/quiz.js
const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

let quizzes = {};
const blockedChannelIds = [
  "1415189080861315112",
  "1416773830537642115",
  "1409520151749070880",
  "1410891781846994956",
]; // クイズ禁止チャンネル

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

// ---------------- ランダムクイズ取得 ----------------
function getRandomQuiz(category = null) {
  const categories = Object.keys(quizzes);
  if (categories.length === 0) return null;

  let selectedCategory = category && quizzes[category] ? category : categories[Math.floor(Math.random() * categories.length)];
  const questions = quizzes[selectedCategory];
  if (!questions || questions.length === 0) return null;

  const q = questions[Math.floor(Math.random() * questions.length)];

  return {
    category: selectedCategory,
    question: q.q,      // JSONの q
    choices: q.choices,
    answer: q.a,        // JSONの a
  };
}

// ---------------- クイズマネージャ ----------------
// interaction がある場合は slash コマンド
// channel / user が渡された場合は prefix コマンド
async function quizManager(arg1, arg2 = null, category = null) {
  let channel, user;

  if (arg1.channel && arg1.isChatInputCommand) {
    // Slash
    channel = arg1.channel;
    user = arg1.user;
    category = category || null;
  } else {
    // Prefix
    channel = arg1;
    user = arg2;
  }

  // クイズ禁止チャンネル判定
  if (blockedChannelIds.includes(channel.id) || channel.name?.includes("雑談")) {
    const warningMsg = await channel.send(`❌ このチャンネルではクイズは使えません`);
    setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
    return;
  }

  const quiz = getRandomQuiz(category);
  if (!quiz || !quiz.choices || quiz.choices.length === 0) {
    await channel.send("⚠️ クイズデータが不十分です。");
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
  const msg = await channel.send({
    content: `📝 **${quiz.category}クイズ**\n${quiz.question}`,
    components: [buttons],
  });

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

  collector.on("end", (collected, reason) => {
    if (reason === "time") {
      channel.send(`⌛ 時間切れ！ 正解は **${quiz.answer}** でした。`);
    }
  });

  // 次の問題ボタン
  const nextCollector = channel.createMessageComponentCollector({ filter, time: 60000 });
  nextCollector.on("collect", async (i) => {
    if (i.customId === "quiz_next") {
      await i.deferUpdate();
      await quizManager(channel, user, category); // 再帰的に次の問題
    }
  });
}

module.exports = { preloadQuizzes, getRandomQuiz, quizManager, blockedChannelIds };