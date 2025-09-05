const { TwitterApi } = require('twitter-api-v2');
const cron = require('node-cron');

module.exports = function setupTwitterDiscord(client, channelId, twitterConfig) {
  const sent = new Set(); // 送信済みリンクを保存

  const twitterClient = new TwitterApi({
    appKey: twitterConfig.appKey,
    appSecret: twitterConfig.appSecret,
    accessToken: twitterConfig.accessToken,
    accessSecret: twitterConfig.accessSecret,
  });

  async function fetchDiscordLinks() {
    try {
      // Discord招待リンクを含むツイートを検索
      const query = 'discord.gg/ -is:retweet';
      const response = await twitterClient.v2.search(query, { max_results: 10 });

      if (!response.data) return [];

      // ツイートから discord.gg/ を抽出
      const links = response.data
        .map(t => t.text.match(/https:\/\/discord\.gg\/\w+/g))
        .flat()
        .filter(Boolean);

      return links;
    } catch (err) {
      console.error('Twitter取得エラー:', err.message);
      return [];
    }
  }

  // 定期処理（例：5分ごと）
  cron.schedule('*/2 * * * *', async () => {
    const links = await fetchDiscordLinks();
    if (!links.length) return;

    const channel = await client.channels.fetch(channelId);

    for (const link of links) {
      if (!sent.has(link)) {
        await channel.send(link);
        sent.add(link);
      }
    }
  });
};