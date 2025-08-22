// utils/weather.js
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { ensureFolder, downloadToLocal, uploadFile } = require('./storage');
const API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_DIR = process.env.DROPBOX_WEATHER_DIR || './data/weather';

async function fetchWeather(location) {
  // ... (既存の fetchWeather 関数は変更なし)
  try {
    const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${location}&appid=${API_KEY}&units=metric&lang=ja`);
    const data = response.data;
    const weather = data.weather[0].description;
    const temp = data.main.temp;
    return `**${data.name}**の天気: ${weather}, 気温: ${temp}°C`;
  } catch (e) {
    console.error(`天気情報取得失敗: ${e}`);
    return null;
  }
}

async function saveUserWeatherPref(userId, location) {
  const filePath = path.join(WEATHER_DIR, `${userId}.json`);
  const data = { location, savedAt: new Date().toISOString() };
  try {
    // ★ 修正: ローカルフォルダが存在しない場合に作成
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));

    // ★ 修正: Dropboxフォルダが存在しない場合に作成
    const dropboxFolderPath = process.env.DROPBOX_WEATHER_DIR || '/weather';
    await ensureFolder(dropboxFolderPath);

    await uploadFile(filePath, `${dropboxFolderPath}/${userId}.json`);
  } catch (e) {
    console.error(`天気設定の保存に失敗しました: ${e}`);
  }
}

async function loadUserWeatherPref(userId) {
  const filePath = path.join(WEATHER_DIR, `${userId}.json`);
  try {
    const dropboxFolderPath = process.env.DROPBOX_WEATHER_DIR || '/weather';
    const success = await downloadToLocal(`${dropboxFolderPath}/${userId}.json`, filePath);
    if (success) {
      const data = await fs.readFile(filePath, 'utf-8');
      const pref = JSON.parse(data);
      return pref.location;
    }
  } catch (e) {
    console.error(`天気設定の読み込みに失敗しました: ${e}`);
  }
  return null;
}

module.exports = { fetchWeather, saveUserWeatherPref, loadUserWeatherPref };
