// utils/weather.js
const fs = require('fs');
const path = require('path');
// `node-fetch` v3以降はESM形式のため、動的インポートを使用
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { ensureFolder, uploadBuffer, downloadToLocal, WEATHER_DIR } = require('./storage');
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;
const BACKUP_DIR = process.env.BACKUP_PATH || './backups';

const localWeatherDir = path.join(BACKUP_DIR, 'weather');
fs.mkdirSync(localWeatherDir, { recursive: true });

// ユーザー毎の保存/読み込み（ローカル + Dropbox）
async function saveUserWeatherPref(userId, place) {
  const obj = { userId, place };
  const localPath = path.join(localWeatherDir, `weather_${userId}.json`);
  fs.writeFileSync(localPath, JSON.stringify(obj, null, 2), 'utf-8');

  // Dropboxへも保存（あれば）
  await ensureFolder(WEATHER_DIR);
  await uploadBuffer(`${WEATHER_DIR}/weather_${userId}.json`, Buffer.from(JSON.stringify(obj)));
}

async function loadUserWeatherPref(userId) {
  const localPath = path.join(localWeatherDir, `weather_${userId}.json`);
  if (fs.existsSync(localPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
      return data.place;
    } catch {}
  }
  // ローカルに無ければDropboxから引っ張る
  const ok = await downloadToLocal(`${WEATHER_DIR}/weather_${userId}.json`, localPath);
  if (ok) {
    try {
      const data = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
      return data.place;
    } catch {}
  }
  return null;
}

// 任意：起動時にローカルだけスキャン
async function loadAllLocalWeatherPrefsIfAny() {
  try {
    const files = fs.readdirSync(localWeatherDir).filter(f => f.startsWith('weather_') && f.endsWith('.json'));
    // 触る必要なし（ローカル読み込み時に都度読むため）
    return files.length;
  } catch { return 0; }
}

// OpenWeatherMapで取得（都市/都道府県名をそのまま検索）
async function fetchWeather(place) {
  if (!OPENWEATHER_KEY) return null;
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(place)},JP&appid=${OPENWEATHER_KEY}&units=metric&lang=ja`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const w = data.weather?.[0]?.description ?? '不明';
    const t = data.main?.temp ?? '?';
    const h = data.main?.humidity ?? '?';
    const feels = data.main?.feels_like ?? '?';
    return `🌤 **${data.name}** の天気\n・状況: ${w}\n・気温: ${t}°C (体感 ${feels}°C)\n・湿度: ${h}%`;
  } catch (e) {
    console.error('天気取得失敗:', e?.message || e);
    return null;
  }
}

module.exports = {
  saveUserWeatherPref,
  loadUserWeatherPref,
  loadAllLocalWeatherPrefsIfAny,
  fetchWeather
};
