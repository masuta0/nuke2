const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");

module.exports = function setupDisusoku(client, channelId, url) {
  // すでに送ったURLを記録しておく（重複防止用）
  const sent = new Set();

  // === ディス速からサーバーURL取得 ===
  async function fetchServerUrls() {
    try {
      const { data } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "ja,en;q=0.9",
        },
      });
      const $ = cheerio.load(data);

      const urls = [];
      $("a").each((_, el) => {
        const href = $(el).attr("href");
        if (href && href.startsWith("https://discord.gg/")) {
          urls.push(href);
        }
      });

      return urls;
    } catch (err) {
      console.error("ディス速取得エラー:", err.message);
      return [];
    }
  }

  // === 定期処理（5分ごと） ===
  cron.schedule("*/1 * * * *", async () => {
    const urls = await fetchServerUrls();
    if (urls.length > 0) {
      const channel = await client.channels.fetch(channelId);
      for (const url of urls) {
        if (!sent.has(url)) {
          await channel.send(url);
          sent.add(url);
        }
      }
    }
  });
};