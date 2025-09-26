// utils/face.js
const faceapi = require("@vladmandic/face-api");
const canvas = require("canvas");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const https = require("https");

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODELS_DIR = path.join(__dirname, "model"); // utils/model ディレクトリを指すように修正

// ensureModels関数は不要になるため削除

// --- 顔認識データ ---
let referenceDescriptor = null;

// 初期化（モデル読み込み）
async function initFaceRecognition() {
  // モデルディレクトリが存在しない場合は作成
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    console.log(`Created models directory: ${MODELS_DIR}`);
  }

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);

  console.log("⚡ 顔認識モデル読み込み完了");
}

// 画像をロードするヘルパー関数 (URLまたはローカルパス)
async function loadImage(imageSource) {
  if (imageSource.startsWith("http")) {
    const res = await fetch(imageSource);
    const buffer = await res.buffer();
    return canvas.loadImage(buffer);
  } else {
    // ローカルファイルパスの場合
    const buffer = fs.readFileSync(imageSource);
    return canvas.loadImage(buffer);
  }
}

// Imgurリンクから顔を登録
async function registerFace(imgSource) {
  const img = await loadImage(imgSource);

  const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
  if (!detection) throw new Error("顔が検出できませんでした");

  referenceDescriptor = detection.descriptor;
  console.log("✅ 顔登録完了");
}

// Imgurリンクから類似顔判定
async function isSimilarFace(imgSource) {
  if (!referenceDescriptor) return false;

  const img = await loadImage(imgSource);

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

