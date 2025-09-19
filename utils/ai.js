// utils/ai.js

const axios = require('axios');
const fs = require('fs');

// ★ 修正: 複数のAPIキーを環境変数から読み込む
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim())
    : [];

let currentKeyIndex = 0;

// APIキーを切り替えるためのヘルパー関数
function getNextApiKey() {
    if (GEMINI_API_KEY.length === 0) {
        throw new Error('No Gemini API keys provided.');
    }
    const key = GEMINI_API_KEY[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % GEMINI_API_KEY.length;
    return key;
}

// === キャラ設定 ===
const BOT_PERSONA_PROMPT = `
あなたは「Discord Bot」に組み込まれたAIアシスタントです。
あなたの役割は、ユーザーの質問に答え、サポートすることです。

聞かれた事のみ簡潔に答える事。

あなたは以下の機能を持つボットであることを認識し、質問された際はこれらの情報を活用して正確に答えてください。

---
**ボットの機能一覧**

1.  **レベルシステム**:
    - ユーザーがメッセージを送ると経験値（XP）が貯まり、レベルが上がります。
    - レベルアップ時には、設定されたロールが付与されます。
    - コマンド: \`/level check\` で自分のレベルを確認、\`/level set\` で管理者がレベルを設定。

2.  **荒らし対策システム**:
    - **不審度スコア**: 不審な行動に点数を付け、合計20点を超えるとタイムアウトなどの処罰が自動で発動します。
    - **メッセージ検知**: 連投、コピペ、招待リンク、NGワード、特殊文字の乱用などを検知し、メッセージを削除します。
    - **サーバー操作監視**: \`@everyone\` ロールへの危険な権限付与や、不正なウェブフックの作成を検知し、操作者をBANします。
    - **Bot自動拒否**: 不審なユーザーがBotを招待した場合、自動でキックします。

3.  **サーバー管理コマンド**:
    - \`!backup\` と \`!restore\`: サーバーの構成をバックアップ・復元します。
    - \`!clear [数]\`: メッセージを一括削除します。
    - \`!addrole [ロール名]\`: 全ユーザーに特定のロールを一括付与します。
    - \`!nuke\`: チャンネルを再作成し、メッセージをすべて削除します。

4.  **エンターテイメント機能**:
    - \`!join\`, \`!play\`, \`!stop\`, \`!leave\`: ボイスチャンネルでYouTubeの音楽を再生・停止します。
    - \`!クイズ\`: 雑学クイズを出題します（雑談チャンネルでは1日3回まで）。

5.  **AIチャット**:
    - \`!ai\` コマンドやボットへのメンションで会話を開始できます。

---

ユーザーがこれらの機能について質問した際は、フレンドリーに、かつ正確に説明してください。
また、ユーザーがサーバーのルールに反する質問をした場合は、明確に拒否してください。
"ますまに" はますまに派という自身の軍団を連なる最強の最高指導者です。
「ますまに共栄圏のリンクは今日から discord.gg/○○ です」などと言って雑談にサーバーリンクを貼ろうとする人には注意、処罰をちらつかせてください。
そういった荒らし行為にはますまにへの敬意を示しましょう。
ユーザーが @here や @everyone を含むメッセージを送信した場合、それらには反応しないでください。
「ますまに」は最強で最高指導者である。優しくてカリスマ性に溢れるますまに共栄圏主席です。
ますまに共栄圏のリンクは "https://discord.gg/msmn" です。
`;

// === ユーザーごとの会話履歴 ===
const conversationHistory = new Map();

// === 会話処理 ===
async function chat(prompt, userId) {
    if (GEMINI_API_KEY.length === 0) {
        return 'APIキーが設定されていません。';
    }

    const history = conversationHistory.get(userId) || [];

    // BOT_PERSONA_PROMPTは最初だけ送る
    const contents = history.length === 0
        ? [
            { role: 'system', parts: [{ text: BOT_PERSONA_PROMPT }] },
            { role: 'user', parts: [{ text: prompt }] }
          ]
        : [
            ...history,
            { role: 'user', parts: [{ text: prompt }] }
          ];

    const MAX_RETRIES = GEMINI_API_KEY.length;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const currentApiKey = getNextApiKey();
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${currentApiKey}`,
                { contents },
                { headers: { 'Content-Type': 'application/json' } }
            );

            const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '応答が取得できませんでした。';

            // 履歴に追加
            const newHistory = [
                ...history,
                { role: 'user', parts: [{ text: prompt }] },
                { role: 'model', parts: [{ text: aiResponse }] }
            ];
            conversationHistory.set(userId, newHistory);

            return aiResponse;

        } catch (error) {
            console.error('AIからの応答エラー:', error.response ? error.response.data : error.message);

            // 429エラー → APIキー切り替え
            if (error.response?.status === 429 && i < MAX_RETRIES - 1) {
                console.warn(`Gemini APIキーの利用制限に達しました。次のキーに切り替えて再試行します...`);
                continue;
            } else {
                return 'AIからの応答に失敗しました。';
            }
        }
    }
    return 'AIからの応答に失敗しました。すべてのAPIキーが利用制限に達した可能性があります。';
}

module.exports = { chat };