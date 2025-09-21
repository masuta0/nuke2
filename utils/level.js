// utils/level.js
const fs = require('fs');
const path = require('path');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./storage');

const LEVEL_SETTINGS_PATH = path.join(__dirname, '../levels.json');
const LOCAL_LEVEL_DATA_PATH = path.join(__dirname, '../userLevels.json'); // ローカル用
const DROPBOX_LEVEL_DATA_PATH = '/app-data/userLevels.json';

let userLevels = {};
let levelSettings = {};
const xpCooldown = new Set();

// クールダウン時間: 30秒
const COOLDOWN_TIME = 30 * 1000;

// レベルログチャンネル
const LEVEL_LOG_CHANNEL_ID = process.env.LEVEL_LOG_CHANNEL_ID || '1411721928120598739';

// Dropbox リトライ設定
const DROPBOX_RETRY_COUNT = 3;
const DROPBOX_RETRY_INTERVAL = 2000; // ms

// ============================================
// データロード
// ============================================
async function loadData() {
    try {
        await ensureDropboxInit();
        const data = await downloadFromDropbox(DROPBOX_LEVEL_DATA_PATH);
        if (data) {
            userLevels = JSON.parse(data);
            console.log('✅ ユーザーレベルデータをDropboxからロードしました。');
        } else {
            console.warn('⚠️ Dropboxにユーザーレベルデータがありません。ローカルデータをロードします。');
        }
    } catch (err) {
        console.error('❌ Dropboxロード失敗:', err);
    }

    // ローカルデータロード
    try {
        if (fs.existsSync(LOCAL_LEVEL_DATA_PATH)) {
            const localData = fs.readFileSync(LOCAL_LEVEL_DATA_PATH, 'utf-8');
            const parsed = JSON.parse(localData);
            if (!userLevels || Object.keys(userLevels).length === 0) userLevels = parsed;
            console.log('✅ ローカルユーザーレベルデータをロードしました。');
        }
    } catch (err) {
        console.error('❌ ローカルユーザーレベルデータロード失敗:', err);
    }

    if (!userLevels) userLevels = {};

    // レベル設定
    try {
        if (fs.existsSync(LEVEL_SETTINGS_PATH)) {
            levelSettings = JSON.parse(fs.readFileSync(LEVEL_SETTINGS_PATH, 'utf-8'));
            console.log('✅ レベル設定をロードしました。');
        } else {
            console.warn('⚠️ レベル設定が見つかりません。初期作成します。');
            levelSettings = {
                "1": { "xp": 100, "roleId": null, "message": "おめでとう！あなたはレベル1に到達しました！" },
                "2": { "xp": 250, "roleId": null, "message": "すごい！あなたはレベル2に到達しました！" },
                "3": { "xp": 500, "roleId": null, "message": "さらにすごい！あなたはレベル3に到達しました！" },
            };
            fs.writeFileSync(LEVEL_SETTINGS_PATH, JSON.stringify(levelSettings, null, 2));
        }
    } catch (err) {
        console.error('❌ レベル設定ロード失敗:', err);
        levelSettings = {};
    }
}

// ============================================
// Dropbox リトライ付きアップロード
// ============================================
async function uploadWithRetry(content, retries = DROPBOX_RETRY_COUNT) {
    for (let i = 0; i <= retries; i++) {
        try {
            await ensureDropboxInit();
            const success = await uploadToDropbox(DROPBOX_LEVEL_DATA_PATH, content);
            if (success) return true;
            throw new Error('Dropbox upload returned false');
        } catch (err) {
            console.warn(`⚠️ Dropboxアップロード失敗 (${i + 1}/${retries}):`, err.message);
            if (i < retries) await new Promise(res => setTimeout(res, DROPBOX_RETRY_INTERVAL));
            else return false;
        }
    }
}

// ============================================
// データ保存
// ============================================
async function saveData() {
    // ローカル保存
    try {
        fs.writeFileSync(LOCAL_LEVEL_DATA_PATH, JSON.stringify(userLevels, null, 2));
    } catch (err) {
        console.error('❌ ローカルユーザーレベルデータ保存失敗:', err);
    }

    // Dropbox 保存（リトライ付き）
    const dropboxSuccess = await uploadWithRetry(JSON.stringify(userLevels, null, 2));
    if (!dropboxSuccess) console.error('❌ Dropboxへの保存が最終的に失敗しました。');
}

// ============================================
// 経験値付与
// ============================================
async function addXp(member) {
    if (!member || !member.id || !member.guild) return;

    if (xpCooldown.has(member.id)) return;

    const userId = member.id;
    const guildId = member.guild.id;

    if (!userLevels[guildId]) userLevels[guildId] = {};
    if (!userLevels[guildId][userId]) userLevels[guildId][userId] = { level: 0, xp: 0 };

    const userData = userLevels[guildId][userId];
    const oldLevel = userData.level;

    const addedXp = Math.floor(Math.random() * 6) + 5;
    userData.xp += addedXp;

    let newLevel = oldLevel;
    while (levelSettings[newLevel + 1] && userData.xp >= levelSettings[newLevel + 1].xp) {
        newLevel++;
    }

    if (newLevel > oldLevel) {
        userData.level = newLevel;
        await handleLevelUp(member, newLevel);
    }

    await saveData();

    xpCooldown.add(member.id);
    setTimeout(() => xpCooldown.delete(member.id), COOLDOWN_TIME);
}

// ============================================
// レベルアップ処理
// ============================================
async function handleLevelUp(member, newLevel) {
    const levelData = levelSettings[newLevel];
    if (!levelData) return;

    const levelUpMessage = levelData.message.replace("{user}", member.user.tag);

    let logChannel = member.guild.channels.cache.get(LEVEL_LOG_CHANNEL_ID);
    if (!logChannel) logChannel = member.guild.systemChannel;

    if (logChannel) await logChannel.send(`🎉 ${member} ${levelUpMessage}`);

    if (levelData.roleId) {
        const role = member.guild.roles.cache.get(levelData.roleId);
        if (role) {
            try {
                await member.roles.add(role);
                console.log(`✅ ${member.user.tag} にレベル${newLevel}のロールを付与しました。`);
            } catch (err) {
                console.error('❌ ロール付与失敗:', err);
            }
        }
    }
}

// ============================================
// ユーティリティ関数
// ============================================
function getLevelData(guildId, userId) {
    if (!userLevels[guildId] || !userLevels[guildId][userId]) return { level: 0, xp: 0 };
    return userLevels[guildId][userId];
}

async function setLevelAndXp(guildId, userId, newLevel, newXp) {
    if (!userLevels[guildId]) userLevels[guildId] = {};
    userLevels[guildId][userId] = { level: newLevel, xp: newXp };
    await saveData();
}

function calculateRequiredXp(level) {
    const levelData = levelSettings[level];
    return levelData ? levelData.xp : null;
}

module.exports = { loadData, addXp, getLevelData, setLevelAndXp, calculateRequiredXp };