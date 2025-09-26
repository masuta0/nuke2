// utils/face.js
const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const https = require('https');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let referenceDescriptor = null;

const MODEL_URL = 'https://github.com/vladmandic/face-api/raw/master/model/'; // 例：GitHub raw のモデルURL
const MODELS = ['ssd_mobilenetv1_model-weights_manifest.json', 'face_landmark_68_model-weights_manifest.json', 'face_recognition_model-weights_manifest.json'];

async function downloadModel(modelName, modelDir) {
  const url = MODEL_URL + modelName;
  const dest = path.join(modelDir, modelName);
  if (fs.existsSync(dest)) return;
  console.log('⬇️ モデルをダウンロード中:', modelName);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`モデルのダウンロードに失敗: ${modelName}`);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buffer));
  console.log('✅ ダウンロード完了:', modelName);
}

async function ensureModels(modelDir) {
  if (!fs.existsSync(modelDir)) fs.mkdirSync(modelDir, { recursive: true });
  for (const model of MODELS) {
    await downloadModel(model, modelDir);
  }
}

async function initFaceRecognition() {
  try {
    const modelDir = path.join(__dirname, '../models');
    await ensureModels(modelDir);

    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);

    const imgPath = path.join(__dirname, '../face.jpg');
    if (!fs.existsSync(imgPath)) {
      console.warn('⚠️ 顔画像が見つかりません:', imgPath);
      return;
    }

    const img = await canvas.loadImage(imgPath);
    const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
    if (!detection) {
      console.warn('⚠️ 顔を検出できませんでした:', imgPath);
      return;
    }

    referenceDescriptor = detection.descriptor;
    console.log('✅ 顔認識用データを初期化しました');
  } catch (err) {
    console.error('⚠️ 顔認識の初期化中にエラー:', err.message);
  }
}

async function isSimilarFace(imageUrl) {
  if (!referenceDescriptor) {
    console.warn('⚠️ 基準となる顔データがありません');
    return false;
  }

  try {
    const res = await fetch(imageUrl);
    const buffer = await res.buffer();
    const img = await canvas.loadImage(buffer);
    const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
    if (!detection) return false;

    const distance = faceapi.euclideanDistance(referenceDescriptor, detection.descriptor);
    return distance < 0.6;
  } catch (err) {
    console.error('⚠️ 顔比較中にエラー:', err.message);
    return false;
  }
}

module.exports = { initFaceRecognition, isSimilarFace };
