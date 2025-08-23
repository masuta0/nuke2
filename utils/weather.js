// utils/weather.js

const axios = require('axios');
const fs = require('fs').promises; // ファイルシステムは未使用ですが、元のコードに倣い残します。
const path = require('path');
const { ensureFolder, uploadToDropbox, downloadFromDropbox } = require('./storage');

// 環境変数からAPIキーとDropboxのディレクトリを読み込みます
const API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_DIR = process.env.DROPBOX_WEATHER_DIR || '/weather';

/**
 * 指定された地名の天気情報をOpenWeatherMap APIから取得します。
 * @param {string} location - 取得したい地名（例: "Tokyo"）
 * @returns {Promise<string|null>} 天気情報を含む文字列、または取得に失敗した場合はnull
 */
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

/**
 * ユーザーの天気設定をDropboxに保存します。
 * @param {string} userId - DiscordのユーザーID
 * @param {string} location - 保存する地名
 * @returns {Promise<boolean>} 保存に成功した場合はtrue、失敗した場合はfalse
 */
async function saveUserWeatherPref(userId, location) {
  const data = { location, savedAt: new Date().toISOString() };
  try {
    const dropboxFolderPath = WEATHER_DIR;
    await ensureFolder(dropboxFolderPath);

    // ユーザーIDをファイル名としてJSONデータをDropboxにアップロード
    const success = await uploadToDropbox(`${dropboxFolderPath}/${userId}.json`, JSON.stringify(data, null, 2));
    if (success) {
      console.log(`ユーザー ${userId} の天気設定をDropboxに保存しました。`);
    } else {
      console.error(`ユーザー ${userId} の天気設定の保存に失敗しました。`);
    }
    return success;
  } catch (e) {
    console.error(`天気設定の保存に失敗しました: ${e}`);
    return false;
  }
}

/**
 * ユーザーの天気設定をDropboxから読み込みます。
 * @param {string} userId - DiscordのユーザーID
 * @returns {Promise<string|null>} 保存された地名、または読み込みに失敗した場合はnull
 */
async function loadUserWeatherPref(userId) {
  try {
    const dropboxFolderPath = WEATHER_DIR;
    // ユーザーIDに対応するJSONファイルをDropboxからダウンロード
    const data = await downloadFromDropbox(`${dropboxFolderPath}/${userId}.json`);
    if (data) {
      const pref = JSON.parse(data);
      console.log(`ユーザー ${userId} の天気設定をDropboxから読み込みました。`);
      return pref.location;
    }
  } catch (e) {
    console.error(`天気設定の読み込みに失敗しました: ${e}`);
  }
  return null;
}

module.exports = { fetchWeather, saveUserWeatherPref, loadUserWeatherPref };
