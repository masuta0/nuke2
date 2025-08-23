// utils/weather.js

const axios = require('axios');
const translate = require('@iamtraction/google-translate');
const fs = require('fs').promises;
const path = require('path');
const { ensureFolder, uploadToDropbox, downloadFromDropbox } = require('./storage');
const API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_DIR = process.env.DROPBOX_WEATHER_DIR || '/weather';

/**
 * 日本語の地名から不要な接尾辞（区、市など）を削除します。
 * @param {string} location - ユーザーが入力した地名
 * @returns {string} 接尾辞が削除された地名
 */
function removeSuffixes(location) {
  const suffixes = ['市', '区', '郡', '町', '村'];
  let newLocation = location;
  for (const suffix of suffixes) {
    if (newLocation.endsWith(suffix)) {
      newLocation = newLocation.slice(0, -suffix.length);
    }
  }
  return newLocation;
}

async function fetchWeather(location) {
  // まず、地名から「区」「市」などの接尾辞を削除
  const cleanedLocation = removeSuffixes(location);

  let englishLocation = cleanedLocation;

  // 日本語が含まれているかチェック
  if (/[一-龠ぁ-んァ-ヶ]/.test(cleanedLocation)) {
    try {
      const res = await translate(cleanedLocation, { from: 'ja', to: 'en' });
      englishLocation = res.text;
      console.log(`✅ 地名「${cleanedLocation}」を「${englishLocation}」に翻訳しました。`);
    } catch (e) {
      console.error('❌ 地名翻訳に失敗しました:', e);
      // 翻訳失敗時は元の地名をそのまま使用
      englishLocation = cleanedLocation;
    }
  }

  try {
    const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${englishLocation}&appid=${API_KEY}&units=metric&lang=ja`);
    const data = response.data;
    const weather = data.weather[0].description;
    const temp = data.main.temp;
    return `**${data.name}**の天気: ${weather}, 気温: ${temp}°C`;
  } catch (e) {
    if (e.response && e.response.status === 404) {
      console.error(`天気情報取得失敗: 地名が見つかりません: ${location} (${englishLocation})`);
      return `「${location}」の天気情報は見つかりませんでした。\n主要な都市名やアルファベット名でお試しください。`;
    }
    console.error(`天気情報取得失敗: ${e}`);
    return null;
  }
}

async function saveUserWeatherPref(userId, location) {
  const data = { location, savedAt: new Date().toISOString() };
  try {
    const dropboxFolderPath = WEATHER_DIR;
    await ensureFolder(dropboxFolderPath);
    const success = await uploadToDropbox(`${dropboxFolderPath}/${userId}.json`, JSON.stringify(data, null, 2));
    return success;
  } catch (e) {
    console.error(`天気設定の保存に失敗しました: ${e}`);
    return false;
  }
}

async function loadUserWeatherPref(userId) {
  try {
    const dropboxFolderPath = WEATHER_DIR;
    const data = await downloadFromDropbox(`${dropboxFolderPath}/${userId}.json`);
    if (data) {
      const pref = JSON.parse(data);
      return pref.location;
    }
  } catch (e) {
    console.error(`天気設定の読み込みに失敗しました: ${e}`);
  }
  return null;
}

module.exports = { fetchWeather, saveUserWeatherPref, loadUserWeatherPref };
