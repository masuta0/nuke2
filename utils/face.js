// utils/face.js
const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODELS_DIR = path.join(__dirname, 'models');

let referenceDescriptor = null;

// 初期化（モデル読み込み）
async function initFaceRecognition() {
  if (!fs.existsSync(MODELS_DIR)) {
    throw new Error(`モデルフォルダが存在しません: ${MODELS_DIR}`);
  }

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);

  console.log('⚡ 顔認識モデル読み込み完了');
}

// 顔登録（基準画像を読み込む）
async function registerFace(localPath) {
  const img = await canvas.loadImage(localPath);
  const detection = await faceapi
    .detectSingleFace(img)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    throw new Error('顔が検出できませんでした。別の画像を試してください。');
  }

  referenceDescriptor = detection.descriptor;
  console.log('✅ 顔登録完了');
  return true;
}

// 類似顔判定
async function isSimilarFace(imgUrl) {
  if (!referenceDescriptor) {
    console.log('⚠️ 参照顔が登録されていません');
    return false;
  }

  const res = await fetch(imgUrl);
  const buffer = await res.buffer();
  const img = await canvas.loadImage(buffer);

  const detection = await faceapi
    .detectSingleFace(img)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    console.log('👤 顔が検出されませんでした');
    return false;
  }

  const distance = faceapi.euclideanDistance(referenceDescriptor, detection.descriptor);
  console.log(`🔍 顔の距離: ${distance.toFixed(3)} (閾値: 0.2)`);

  return distance < 0.2;
}

module.exports = {
  initFaceRecognition,
  registerFace,
  isSimilarFace
};
