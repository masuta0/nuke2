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
]; // クイズ禁止チャンネル

// クイズデータロード
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

  let chosenCategory = category && quizzes[category] ? category : categories[Math.floor(Math.random() * categories.length)];
  const questions = quizzes[chosenCategory];
  if (!questions || questions.length === 0) return null;
  const q = questions[Math.floor(Math.random() * questions.length)];
  return { category: chosenCategory, question: q.q, answer: q.a, choices: q.choices };
}

// クイズ開始
async function startQuiz(target, user, category = null) {
  const channel = target.channel || target; // Slashの場合は interaction.channel
  if (blockedChannelIds.includes(channel.id) || channel.name?.includes("雑談")) {
    const warningMsg = await channel.send("❌ このチャンネルではクイズは使えません");
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
        .setCustomId(`quiz_${idx}_${user.id}`)
        .setLabel(choice)
        .setStyle(ButtonStyle.Primary)
    );
  });

  // メッセージ送信
  let msg;
  if (target.isChatInputCommand) {
    msg = await target.reply({ content: `📝 **${quiz.category}クイズ**\n${quiz.question}`, components: [buttons], fetchReply: true });
  } else {
    msg = await channel.send({ content: `📝 **${quiz.category}クイズ**\n${quiz.question}`, components: [buttons] });
  }

  // 30秒後にタイムアウト
  setTimeout(async () => {
    try {
      await msg.edit({ components: [] });
      await channel.send(`⌛ 時間切れ！ 正解は **${quiz.answer}** でした。`);
    } catch {}
  }, 30000);

  return { quiz, msg };
}

// Interactionでの回答処理
async function handleQuizInteraction(interaction) {
  if (!interaction.isButton()) return;
  const [prefix, idxStr, authorId] = interaction.customId.split("_");
  if (prefix !== "quiz") return;

  // ボタン押したのがクイズ実行者本人か確認
  if (interaction.user.id !== authorId) {
    return interaction.reply({ content: "⚠️ このクイズはあなたのものではありません", ephemeral: true });
  }

  const selectedIndex = parseInt(idxStr, 10);
  const content = interaction.message.content;
  const quizAnswerMatch = content.match(/正解は \*\*(.+)\*\*/);
  // 正解は埋め込まれてない場合のみ
  let answer = quizAnswerMatch ? quizAnswerMatch[1] : null;

  // 一度回答したらボタン無効化
  const newRow = new ActionRowBuilder();
  interaction.message.components[0].components.forEach((btn) => {
    btn.setDisabled(true);
    newRow.addComponents(btn);
  });

  // 正解チェック
  const selectedText = interaction.component.label;
  const correct = selectedText === answer;

  await interaction.update({ content: correct ? `✅ 正解！ (${selectedText})` : `❌ 不正解... 正解は **${answer || "不明"}**`, components: [newRow] });
}

module.exports = { preloadQuizzes, startQuiz, handleQuizInteraction, blockedChannelIds };