// utils/storage.js
const fs = require('fs');
const path = require('path');
const { Dropbox } = require('dropbox');

// `node-fetch` v3以降はESM形式のため、動的インポートを使用
// Dropbox SDKに明示的に注入
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const DROPBOX_TOKEN = process.env.DROPBOX_TOKEN;
const QUIZ_PATH = process.env.DROPBOX_QUIZ_PATH || '/quizzes/quizzes.json';
const WEATHER_DIR = process.env.DROPBOX_WEATHER_DIR || '/weather';

let dbx = null;

async function ensureDropboxInit() {
  if (!DROPBOX_TOKEN) {
    console.warn('Dropbox token is not set. Dropbox features will be skipped.');
    return null;
  }
  if (!dbx) dbx = new Dropbox({ accessToken: DROPBOX_TOKEN, fetch });
  return dbx;
}

async function ensureFolder(folderPath) {
  const _dbx = await ensureDropboxInit();
  if (!_dbx) return false;
  try {
    await _dbx.filesCreateFolderV2({ path: folderPath, autorename: false });
  } catch (e) {
    // folder already exists -> ignore
  }
  return true;
}

async function uploadBuffer(dropboxPath, buffer) {
  const _dbx = await ensureDropboxInit();
  if (!_dbx) return false;
  try {
    await _dbx.filesUpload({
      path: dropboxPath,
      contents: buffer,
      mode: { '.tag': 'overwrite' }
    });
    return true;
  } catch (e) {
    console.error('Dropboxアップロード失敗:', e?.message || e);
    return false;
  }
}

async function uploadFile(localPath, dropboxPath) {
  try {
    const buf = fs.readFileSync(localPath);
    return await uploadBuffer(dropboxPath, buf);
  } catch (e) {
    console.error('ローカル読み込み失敗:', localPath, e?.message || e);
    return false;
  }
}

async function downloadToBuffer(dropboxPath) {
  const _dbx = await ensureDropboxInit();
  if (!_dbx) return null;
  try {
    const res = await _dbx.filesDownload({ path: dropboxPath });
    const ab = res?.result?.fileBinary;
    if (!ab) return null;
    return Buffer.from(ab);
  } catch (e) {
    console.warn('Dropbox読み込み失敗:', e?.error || e?.message || e);
    return null;
  }
}

async function downloadToLocal(dropboxPath, localPath) {
  const buf = await downloadToBuffer(dropboxPath);
  if (!buf) return false;
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buf);
  return true;
}

// ★ レベル機能用のアップロード・ダウンロード関数
async function uploadToDropbox(dropboxPath, data) {
  const _dbx = await ensureDropboxInit();
  if (!_dbx) throw new Error('Dropboxが初期化されていません');
  try {
    await _dbx.filesUpload({
      path: dropboxPath,
      contents: data,
      mode: { '.tag': 'overwrite' }
    });
    return true;
  } catch (e) {
    console.error('Dropboxアップロード失敗:', e?.error || e?.message || e);
    throw e;
  }
}

async function downloadFromDropbox(dropboxPath) {
  const _dbx = await ensureDropboxInit();
  if (!_dbx) return null;
  try {
    const res = await _dbx.filesDownload({ path: dropboxPath });
    const ab = res?.result?.fileBinary;
    if (!ab) return null;
    return JSON.parse(Buffer.from(ab).toString('utf-8'));
  } catch (e) {
    console.warn('Dropbox読み込み失敗:', e?.error || e?.message || e);
    return null;
  }
}

module.exports = {
  ensureDropboxInit,
  ensureFolder,
  uploadFile,
  uploadBuffer,
  downloadToBuffer,
  downloadToLocal,
  uploadToDropbox,
  downloadFromDropbox,
  QUIZ_PATH,
  WEATHER_DIR
};
