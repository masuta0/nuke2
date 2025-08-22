// utils/storage.js

const fs = require('fs');
const path = require('path');
const { Dropbox } = require('dropbox');

// `node-fetch` v3以降はESM形式のため、動的インポートを使用
// Dropbox SDKに明示的に注入
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// 環境変数から読み込む
const APP_KEY = process.env.DROPBOX_APP_KEY;
const APP_SECRET = process.env.DROPBOX_APP_SECRET;
const REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;

let dbx = null;

// Dropboxを初期化し、アクセストークンを自動更新する
async function ensureDropboxInit() {
  if (!APP_KEY || !APP_SECRET || !REFRESH_TOKEN) {
    console.warn('Dropbox環境変数が設定されていません。Dropbox機能はスキップされます。');
    return null;
  }
  if (!dbx) {
    dbx = new Dropbox({
      clientId: APP_KEY,
      clientSecret: APP_SECRET,
      refreshToken: REFRESH_TOKEN,
      fetch,
    });
    // アクセストークンの自動更新を有効にする
    dbx.auth.refreshAccessToken();
    console.log("✅ Dropboxクライアントを初期化しました。");
  }
  return dbx;
}

// ★ 新規: フォルダの存在を確認し、なければ作成する関数
async function ensureFolder(folderPath) {
  const client = await ensureDropboxInit();
  if (!client) return false;
  try {
    await client.filesCreateFolderV2({ path: folderPath, autorename: false });
  } catch (e) {
    // フォルダが既に存在する場合、エラーを無視
    if (e.error?.error?.path?.['.tag'] === 'conflict') {
      return true;
    }
    console.error('Dropbox ensureFolder失敗:', e?.error || e?.message || e);
    return false;
  }
  return true;
}

// ファイルをDropboxにアップロードする
async function uploadToDropbox(dropboxPath, contents) {
  const client = await ensureDropboxInit();
  if (!client) return false;
  try {
    await client.filesUpload({
      path: dropboxPath,
      contents,
      mode: { '.tag': 'overwrite' },
    });
    console.log(`✅ Dropboxにアップロード成功: ${dropboxPath}`);
    return true;
  } catch (err) {
    console.error(`❌ Dropboxアップロード失敗:`, err?.error || err?.message || err);
    return false;
  }
}

// ファイルをDropboxからダウンロードする
async function downloadFromDropbox(dropboxPath) {
  const client = await ensureDropboxInit();
  if (!client) return null;
  try {
    const response = await client.filesDownload({ path: dropboxPath });
    const buffer = response.result.fileBinary;
    if (buffer) {
      console.log(`✅ Dropboxからダウンロード成功: ${dropboxPath}`);
      return JSON.parse(Buffer.from(buffer).toString('utf-8'));
    }
    return null;
  } catch (err) {
    if (err.status === 409 && err.error?.error?.['.tag'] === 'path' && err.error.error.path['.tag'] === 'not_found') {
      // ファイルが見つからない場合、nullを返す
      console.warn(`Dropbox読み込み失敗: ファイルが見つかりません: ${dropboxPath}`);
      return null;
    }
    console.error(`❌ Dropboxダウンロード失敗:`, err?.error || err?.message || err);
    return null;
  }
}

// モジュールとして関数をエクスポート
module.exports = {
  ensureDropboxInit,
  ensureFolder, // ★追記
  uploadToDropbox,
  downloadFromDropbox,
};
