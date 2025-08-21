// utils/storage.js
const fs = require('fs');
const { Dropbox } = require('dropbox');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
if (!global.fetch) global.fetch = fetch;

const APP_KEY = process.env.DROPBOX_APP_KEY?.trim();
const APP_SECRET = process.env.DROPBOX_APP_SECRET?.trim();
const REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN?.trim();

let dbx = null;

async function ensureDropboxInit() {
  if (!APP_KEY || !APP_SECRET || !REFRESH_TOKEN) {
    console.warn('⚠️ Dropbox環境変数が設定されていません。Dropbox機能は無効化されます。');
    return null;
  }
  if (!dbx) {
    dbx = new Dropbox({
      clientId: APP_KEY,
      clientSecret: APP_SECRET,
      refreshToken: REFRESH_TOKEN,
      fetch,
    });
    try {
      await dbx.auth.refreshAccessToken();
      console.log("✅ Dropboxクライアントを初期化しました。");
    } catch (err) {
      console.error("❌ Dropbox初期化エラー:", err);
      dbx = null;
    }
  }
  return dbx;
}

async function uploadToDropbox(dropboxPath, contents) {
  const client = await ensureDropboxInit();
  if (!client) return false;
  try {
    const response = await client.filesUpload({
      path: dropboxPath,
      contents,
      mode: { '.tag': 'overwrite' },
    });
    console.log(`✅ Dropboxにアップロード成功: ${response.result.path_lower}`);
    return true;
  } catch (err) {
    console.error('❌ Dropboxアップロード失敗:', err?.error || err?.message || err);
    return false;
  }
}

async function downloadFromDropbox(dropboxPath) {
  const client = await ensureDropboxInit();
  if (!client) return null;
  try {
    const response = await client.filesDownload({ path: dropboxPath });
    const buffer = response.result.fileBinary;
    if (buffer) {
      console.log(`✅ Dropboxからダウンロード成功: ${response.result.path_lower}`);
      return JSON.parse(Buffer.from(buffer).toString('utf-8'));
    }
    return null;
  } catch (err) {
    console.error('❌ Dropboxダウンロード失敗:', err?.error || err?.message || err);
    return null;
  }
}

module.exports = {
  ensureDropboxInit,
  uploadToDropbox,
  downloadFromDropbox,
};