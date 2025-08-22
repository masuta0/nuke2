// utils/weather.js
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { ensureFolder, uploadToDropbox, downloadFromDropbox } = require('./storage');
const API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_DIR = process.env.DROPBOX_WEATHER_DIR || '/weather';

async function fetchWeather(location) {
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
  const data = { location, savedAt: new Date().toISOString() };
  try {
    const dropboxFolderPath = WEATHER_DIR;
    await ensureFolder(dropboxFolderPath);

    // ★ 修正: uploadFileの代わりにuploadToDropboxを使用
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
    // ★ 修正: downloadToLocalの代わりにdownloadFromDropboxを使用
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
