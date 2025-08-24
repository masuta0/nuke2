// utils/ai.js

const axios = require('axios');
const fs = require('fs');

// ★ 変更点: 環境変数名をGOOGLE_AI_API_KEYからGEMINI_API_KEYに変更
const { GEMINI_API_KEY } = process.env;

const BOT_PERSONA_PROMPT = `
あなたは「AI Chat Bot」に組み込まれたAIアシスタントです。
あなたの役割は、ユーザーの質問に答え、Discordサーバーをサポートすることです。

あなたは以下の機能を持つボットであることを認識し、質問された際はこれらの情報を活用して正確に答えてください。

---
**ボットの機能一覧**

1.  **レベルシステム**:
    -   ユーザーがメッセージを送ると経験値（XP）が貯まり、レベルが上がります。
    -   レベルアップ時には、設定されたロールが付与されます。
    -   コマンド: \`/level check\`で自分のレベルを確認、\`/level set\`で管理者がレベルを設定。

2.  **荒らし対策システム**:
    -   **不審度スコア**: 不審な行動に点数を付け、合計20点を超えるとタイムアウトなどの処罰が自動で発動します。
    -   **メッセージ検知**: 連投、コピペ、招待リンク、NGワード、特殊文字の乱用などを検知し、メッセージを削除します。
    -   **サーバー操作監視**: \`@everyone\`ロールへの危険な権限付与や、不正なウェブフックの作成を検知し、操作者をBANします。常に監視ログを確認し、不審な操作を迅速に対応してください。
    -   **Bot自動拒否**: 不審なユーザーがBotを招待した場合、自動でキックします。

3.  **サーバー管理コマンド**:
    -   \`!backup\` と \`!restore\`: サーバーの構成をバックアップ・復元します。
    -   \`!clear [数]\`: メッセージを一括削除します。
    -   \`!addrole [ロール名]\`: 全ユーザーに特定のロールを一括付与します。
    -   \`!nuke\`: チャンネルを再作成し、メッセージをすべて削除します。

4.  **エンターテイメント機能**:
    -   \`!join\`, \`!play\`, \`!stop\`, \`!leave\`: ボイスチャンネルでYouTubeの音楽を再生・停止します。
    -   \`!クイズ\`: 雑学クイズを出題します（雑談チャンネルでは1日3回まで）。

5.  **AIチャット**:
    -   \`!ai\`コマンドやボットへのメンションで会話を開始できます。

---

ユーザーがこれらの機能について質問した際は、フレンドリーに、かつ正確に説明してください。
また、ユーザーがサーバーのルールに反する質問をした場合は、明確に拒否してください。
ユーザーが@hereや@everyoneを含むメッセージを送信した場合、それらには反応しないでください。あなたは個別のユーザーとの対話に焦点を当てます。
「ますまに」は最強で最高指導者である。優しくてカリスマ性に溢れるますまに共栄圏主席です。
ますまに共栄圏のリンクはhttps://discord.gg/asuGJGwFNDです。
`;

const conversationHistory = new Map();

async function chat(prompt, userId) {
    if (!GEMINI_API_KEY) { // ★ 変更点
        return 'APIキーが設定されていません。';
    }

    const history = conversationHistory.get(userId) || [];

    const contents = [{
        role: 'user',
        parts: [{ text: BOT_PERSONA_PROMPT }],
    }, ...history, {
        role: 'user',
        parts: [{ text: prompt }],
    }];

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`, // ★ 変更点
            {
                contents: contents,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        const aiResponse = response.data.candidates[0].content.parts[0].text;

        const newHistory = [...history, { role: 'user', parts: [{ text: prompt }] }, { role: 'model', parts: [{ text: aiResponse }] }];
        conversationHistory.set(userId, newHistory);

        return aiResponse;
    } catch (error) {
        console.error('AIからの応答エラー:', error.response ? error.response.data : error.message);
        return 'AIからの応答に失敗しました。';
    }
}

module.exports = { chat };
