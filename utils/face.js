// utils/face.js
const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const fetch = require('node-fetch');

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let referenceDescriptor = null;

// ここに自分の顔画像のURLを設定
const FACE_IMAGE_URL = 'https://i.imgur.com/VtQrphk.png';

async function initFaceRecognition() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk('./models');
  await faceapi.nets.faceRecognitionNet.loadFromDisk('./models');
  await faceapi.nets.faceLandmark68Net.loadFromDisk('./models');

  try {
    const res = await fetch(FACE_IMAGE_URL);
    const buffer = await res.buffer();
    const img = await canvas.loadImage(buffer);
    const detection = await faceapi.detectSingleFace(img)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      console.warn('⚠️ 顔画像が認識できませんでした');
      return;
    }

    referenceDescriptor = detection.descriptor;
    console.log('✅ 顔画像を登録しました');
  } catch (err) {
    console.error('⚠️ 顔画像の読み込みに失敗しました', err);
  }
}

async function isSimilarFace(imageUrl) {
  if (!referenceDescriptor) return false;

  try {
    const res = await fetch(imageUrl);
    const buffer = await res.buffer();
    const img = await canvas.loadImage(buffer);
    const detection = await faceapi.detectSingleFace(img)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) return false;

    const distance = faceapi.euclideanDistance(referenceDescriptor, detection.descriptor);
    return distance < 0.6;
  } catch (err) {
    console.error('⚠️ 比較画像の読み込みに失敗しました', err);
    return false;
  }
}

module.exports = { initFaceRecognition, isSimilarFace };
