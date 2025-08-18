// utils/ai.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const translateApi = require('@vitalets/google-translate-api');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

let genAI = null;
function getModel() {
  if (!GEMINI_API_KEY) return null;
  if (!genAI) genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: GEMINI_MODEL });
}

async function chat(prompt, userId) {
  const model = getModel();
  if (!model) return '⚠️ GEMINI_API_KEY が未設定です';
  try {
    const res = await model.generateContent(prompt);
    const txt = res?.response?.text();
    return txt || '（空の返答）';
  } catch (e) {
    console.error('Gemini error:', e?.message || e);
    return `⚠️ Gemini APIエラー`;
  }
}

async function translateWithRetry(text, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await translateApi.translate(text, options);
      return r?.text;
    } catch (e) {
      if (e?.name === 'TooManyRequestsError') await new Promise(r => setTimeout(r, 1500 * (i + 1)));
      else break;
    }
  }
  return null;
}

function hasManageGuildPermission(member) {
  return member?.permissions?.has?.('ManageGuild') || member?.permissions?.has?.(0x20);
}

module.exports = {
  chat,
  translateWithRetry,
  hasManageGuildPermission
};