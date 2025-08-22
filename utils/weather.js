// utils/weather.js
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { ensureFolder, downloadToLocal, uploadFile } = require('./storage');
const API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_DIR = process.env.DROPBOX_WEATHER_DIR || './data/weather';

async function fetchWeather(location) {
  // ...
}

async function saveUserWeatherPref(userId, location) {
  const filePath = path.join(WEATHER_DIR, `${userId}.json`);
  const data = { location, savedAt: new Date().toISOString() };
  try {
    await ensureFolder(WEATHER_DIR); // Dropboxのフォルダ確保
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    await uploadFile(filePath, `${process.env.DROPBOX_WEATHER_DIR}/${userId}.json`); // Dropboxにアップロード
  } catch (e) {
    console.error(`天気設定の保存に失敗しました: ${e}`);
  }
}

async function loadUserWeatherPref(userId) {
  const filePath = path.join(WEATHER_DIR, `${userId}.json`);
  try {
    // Dropboxからローカルにダウンロード
    const success = await downloadToLocal(`${process.env.DROPBOX_WEATHER_DIR}/${userId}.json`, filePath);
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
