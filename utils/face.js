// utils/face.js
const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const https = require('https');

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODELS_DIR = path.join(__dirname, 'models');
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

// GitHubからモデルを自動ダウンロード
const MODEL_FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1'
];

async function downloadModelFile(file) {
  const url = `https://raw.githubusercontent.com/vladmandic/face-api/master/weights/${file}`;
  const dest = path.join(MODELS_DIR, file);
  if (fs.existsSync(dest)) return;

  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(dest);
    https.get(url, (res) => {
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(resolve);
      });
    }).on('error', reject);
  });
}

async function ensureModels() {
  for (const file of MODEL_FILES) {
    await downloadModelFile(file);
  }
}

// --- 顔認識データ ---
let referenceDescriptor = null;

// 初期化（モデル読み込み）
async function initFaceRecognition() {
  await ensureModels();

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);

  console.log('⚡ 顔認識モデル読み込み完了');
}

// Imgurリンクから顔を登録
async function registerFace(imgUrl) {
  const res = await fetch(imgUrl);
  const buffer = await res.buffer();
  const img = await canvas.loadImage(buffer);

  const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
  if (!detection) throw new Error('顔が検出できませんでした');

  referenceDescriptor = detection.descriptor;
  console.log('✅ 顔登録完了');
}

// Imgurリンクから類似顔判定
async function isSimilarFace(imgUrl) {
  if (!referenceDescriptor) return false;

  const res = await fetch(imgUrl);
  const buffer = await res.buffer();
  const img = await canvas.loadImage(buffer);

  const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
  if (!detection) return false;

  const distance = faceapi.euclideanDistance(referenceDescriptor, detection.descriptor);
  return distance < 0.6; // 類似度閾値
}

module.exports = {
  initFaceRecognition,
  registerFace,
  isSimilarFace
};
