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

const activeUsers = new Set(); // 同時参加防止

function preloadQuizzes() {
  try {
    const data = fs.readFileSync(path.join(__dirname, "../quizzes.json"), "utf-8");
    quizzes = JSON.parse(data);
    console.log("✅ Quiz data loaded successfully.");
  } catch (err) {
    console.error("❌ Failed to load quiz data:", err);
  }
}

function getRandomQuiz(category = null) {
  const categories = Object.keys(quizzes);
  if (categories.length === 0) return null;

  if (category && quizzes[category]) {
    const questions = quizzes[category];
    if (!questions || questions.length === 0) return null;
    const q = questions[Math.floor(Math.random() * questions.length)];
    return { category, question: q.q, answer: q.a, choices: q.choices };
  }

  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const questions = quizzes[randomCategory];
  if (!questions || questions.length === 0) return null;
  const q = questions[Math.floor(Math.random() * questions.length)];
  return { category: randomCategory, question: q.q, answer: q.a, choices: q.choices };
}

async function quizManager(target, user = null, category = null) {
  let channel, isSlash = false;

  if (target.channel && target.isChatInputCommand) {
    isSlash = true;
    channel = target.channel;
    user = target.user;
  } else {
    channel = target;
  }

  if (activeUsers.has(user?.id)) return;
  if (user) activeUsers.add(user.id);

  if (blockedChannelIds.includes(channel.id) || channel.name?.includes("雑談")) {
    const warningMsg = await channel.send(`❌ このチャンネルではクイズは使えません`);
    setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
    activeUsers.delete(user?.id);
    return;
  }

  const quiz = getRandomQuiz(category);
  if (!quiz || !quiz.choices || quiz.choices.length === 0) {
    await channel.send("⚠️ クイズデータが不十分です。");
    activeUsers.delete(user?.id);
    return;
  }

  const buttons = new ActionRowBuilder();
  quiz.choices.forEach((choice, idx) => {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`quiz_${idx}`)
        .setLabel(choice)
        .setStyle(ButtonStyle.Primary)
    );
  });

  let msg;
  if (isSlash) {
    msg = await target.reply({
      content: `📝 **${quiz.category}クイズ**\n${quiz.question}`,
      components: [buttons],
      fetchReply: true,
    });
  } else {
    msg = await channel.send({
      content: `📝 **${quiz.category}クイズ**\n${quiz.question}`,
      components: [buttons],
    });
  }

  const filter = (i) => i.user.id === user.id;
  const collector = msg.createMessageComponentCollector({ filter, time: 30000 });

  collector.on("collect", async (i) => {
    if (!i.isButton()) return;
    const selectedIndex = parseInt(i.customId.split("_")[1], 10);
    const isCorrect = quiz.choices[selectedIndex] === quiz.answer;

    const content = isCorrect
      ? `✅ 正解！ (${quiz.answer})`
      : `❌ 不正解... 正解は **${quiz.answer}** でした。`;

    const nextButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("quiz_next")
        .setLabel("クイズを続ける")
        .setStyle(ButtonStyle.Success)
    );

    try {
      await i.update({ content, components: [nextButton] });
    } catch {
      await channel.send({ content, components: [nextButton] });
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason === "time") {
      await channel.send(`⌛ 時間切れ！ 正解は **${quiz.answer}** でした。`);
      activeUsers.delete(user?.id);
    }
  });

  const nextCollector = msg.createMessageComponentCollector({ filter, time: 60000 });
  nextCollector.on("collect", async (i) => {
    if (i.customId === "quiz_next") {
      await i.deferUpdate();
      collector.stop("next"); // 前回の collector を終了
      nextCollector.stop();   // この collector も終了
      if (isSlash) await quizManager(target, user, category);
      else await quizManager(channel, user, category);
    }
  });
}

module.exports = { preloadQuizzes, getRandomQuiz, quizManager, blockedChannelIds };