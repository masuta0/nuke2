// utils/level.js

const fs = require('fs');
const path = require('path');
const { uploadToDropbox, downloadFromDropbox, ensureDropboxInit } = require('./storage');

const USER_LEVELS_PATH = 'userLevels.json';
const LEVEL_SETTINGS_PATH = path.join(__dirname, '../data/levels.json');
const DROPBOX_LEVEL_DATA_PATH = '/app-data/userLevels.json';

let userLevels = {};
let levelSettings = {};
const xpCooldown = new Set();
const COOLDOWN_TIME = 60 * 1000;

async function loadData() {
    try {
        await ensureDropboxInit();
        const data = await downloadFromDropbox(DROPBOX_LEVEL_DATA_PATH);
        userLevels = data || {};
    } catch (err) {
        console.error('❌ Failed to load user levels data from Dropbox:', err);
        userLevels = {};
    }
    try {
        levelSettings = JSON.parse(fs.readFileSync(LEVEL_SETTINGS_PATH, 'utf-8'));
    } catch (err) {
        console.error('❌ Failed to load level settings data:', err);
        levelSettings = {
            "1": { "xp": 100, "roleId": null, "message": "おめでとう！あなたはレベル1に到達しました！" },
            "2": { "xp": 250, "roleId": null, "message": "すごい！あなたはレベル2に到達しました！" },
            "3": { "xp": 500, "roleId": null, "message": "さらにすごい！あなたはレベル3に到達しました！" },
        };
    }
}

async function saveData() {
    try {
        await uploadToDropbox(DROPBOX_LEVEL_DATA_PATH, JSON.stringify(userLevels));
    } catch (err) {
        console.error('❌ Failed to save user levels data to Dropbox:', err);
    }
}

async function addXp(member) {
    if (xpCooldown.has(member.id)) {
        return;
    }

    const userId = member.id;
    const guildId = member.guild.id;

    if (!userLevels[guildId]) userLevels[guildId] = {};
    if (!userLevels[guildId][userId]) {
        userLevels[guildId][userId] = { level: 0, xp: 0 };
    }

    const userData = userLevels[guildId][userId];
    const oldLevel = userData.level;

    const addedXp = Math.floor(Math.random() * 11) + 15;
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
    setTimeout(() => {
        xpCooldown.delete(member.id);
    }, COOLDOWN_TIME);
}

async function handleLevelUp(member, newLevel) {
    const levelData = levelSettings[newLevel];
    if (!levelData) {
        console.warn(`Level up data for level ${newLevel} not found.`);
        return;
    }

    const levelUpMessage = levelData.message.replace("{user}", member.user.tag);
    await member.guild.systemChannel?.send(`🎉 ${member} ${levelUpMessage}`);

    if (levelData.roleId) {
        const role = member.guild.roles.cache.get(levelData.roleId);
        if (role) {
            try {
                await member.roles.add(role);
                console.log(`✅ ${member.user.tag} にレベル${newLevel}のロールを付与しました。`);
            } catch (err) {
                console.error(`❌ ロール付与に失敗しました: ${err}`);
            }
        }
    }
}

module.exports = { loadData, addXp };

if (!fs.existsSync(LEVEL_SETTINGS_PATH)) {
    fs.mkdirSync(path.dirname(LEVEL_SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(LEVEL_SETTINGS_PATH, JSON.stringify({
        "1": { "xp": 100, "roleId": null, "message": "おめでとう！あなたはレベル1に到達しました！" },
        "2": { "xp": 250, "roleId": null, "message": "すごい！あなたはレベル2に到達しました！" },
        "3": { "xp": 500, "roleId": null, "message": "さらにすごい！あなたはレベル3に到達しました！" },
    }, null, 2));
}
