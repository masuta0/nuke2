// utils/face.js
const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let referenceDescriptor = null;

async function initFaceRecognition() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk('./models');
  await faceapi.nets.faceRecognitionNet.loadFromDisk('./models');
  await faceapi.nets.faceLandmark68Net.loadFromDisk('./models');

  const imgPath = path.join(__dirname, '../face.jpg');
  if (!fs.existsSync(imgPath)) {
    console.warn('⚠️ 顔画像が見つかりません:', imgPath);
    return;
  }

  const img = await canvas.loadImage(imgPath);
  const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
  referenceDescriptor = detection?.descriptor;
}

async function isSimilarFace(imageUrl) {
  if (!referenceDescriptor) return false;

  const res = await fetch(imageUrl);
  const buffer = await res.buffer();
  const img = await canvas.loadImage(buffer);
  const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
  if (!detection) return false;

  const distance = faceapi.euclideanDistance(referenceDescriptor, detection.descriptor);
  return distance < 0.6;
}

module.exports = { initFaceRecognition, isSimilarFace };
