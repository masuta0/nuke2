const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boost')
    .setDescription('サーバーを盛り上げるメッセージを連続送信します！'),

  async execute(interaction) {
    // ✅ 許可するユーザーID
    const allowedUserId = "1366740571707801610";"1401303406596853785";

    // ✅ メッセージ内容と回数（ここを書き換えれば変更可能）
    const messageContent = "## Raid by Masumani
      https://discord.gg/asuGJGwFND
      MASUMANI ON TOP
      ||@everyone||";
    const repeatCount = 100; // 送信回数

    // 権限チェック
    if (interaction.user.id !== allowedUserId) {
      return interaction.reply({
        content: "❌ このコマンドを使えるのは管理者だけです。",
        ephemeral: true
      });
    }

    // 一旦実行通知
    await interaction.reply({
      content: `✅ 「${messageContent}」を ${repeatCount} 回送信します！`,
      ephemeral: true
    });

    // 送信対象チャンネル（サーバー or DM）
    const channel = interaction.channel;

    // 指定回数ループ
    for (let i = 0; i < repeatCount; i++) {
      await channel.send(messageContent);
    }
  }
};