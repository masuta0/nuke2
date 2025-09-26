// utils/face.js
const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const https = require('https');

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const MODEL_FILES = [
    'face_recognition_model-weights_manifest.json',
    'face_landmark_68_model-weights_manifest.json',
    'ssd_mobilenetv1_model-weights_manifest.json'
];

const MODELS_DIR = path.join(__dirname, 'models');
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

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

// — 顔認識データ —
let referenceDescriptor = null;

// 初期化（モデル読み込み）
async function initFaceRecognition() {
    await ensureModels();

    await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_DIR);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);

    console.log('⚡ 顔認識モデル読み込み完了');
}

// 画像を安全に読み込む関数
async function loadImageSafely(imgUrl) {
    try {
        console.log(`🔍 画像を読み込み中: ${imgUrl}`);

        const res = await fetch(imgUrl);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const contentType = res.headers.get('content-type');
        console.log(`📷 Content-Type: ${contentType}`);

        // サポートされている画像形式をチェック
        if (!contentType || !contentType.startsWith('image/')) {
            throw new Error(`サポートされていないコンテンツタイプ: ${contentType}`);
        }

        const buffer = await res.buffer();
        console.log(`📦 画像サイズ: ${buffer.length} bytes`);

        if (buffer.length === 0) {
            throw new Error('空の画像ファイルです');
        }

        // Canvas で画像を読み込み
        const img = await canvas.loadImage(buffer);
        console.log(`🖼️ 画像読み込み成功: ${img.width}x${img.height}`);

        return img;

    } catch (error) {
        console.error(`❌ 画像読み込みエラー: ${error.message}`);
        throw error;
    }
}

// Imgurリンクから顔を登録
async function registerFace(imgUrl) {
    try {
        console.log('🔧 顔登録を開始...');

        const img = await loadImageSafely(imgUrl);

        console.log('🧠 顔検出を実行中...');
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

    } catch (error) {
        console.error('❌ 顔登録エラー:', error.message);
        throw error;
    }
}

// Imgurリンクから類似顔判定
async function isSimilarFace(imgUrl) {
    try {
        if (!referenceDescriptor) {
            console.log('⚠️ 参照顔が登録されていません');
            return false;
        }

        const img = await loadImageSafely(imgUrl);

        const detection = await faceapi
            .detectSingleFace(img)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detection) {
            console.log('👤 顔が検出されませんでした');
            return false;
        }

        const distance = faceapi.euclideanDistance(referenceDescriptor, detection.descriptor);
        console.log(`🔍 顔の距離: ${distance.toFixed(3)} (閾値: 0.6)`);

        return distance < 0.6; // 類似度閾値

    } catch (error) {
        console.error('❌ 顔判定エラー:', error.message);
        return false;
    }
}

module.exports = {
    initFaceRecognition,
    registerFace,
    isSimilarFace
};
