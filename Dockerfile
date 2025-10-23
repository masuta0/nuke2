FROM node:20-bullseye-slim

WORKDIR /app

# 必要パッケージ（curl と ffmpeg）をインストール、キャッシュ削除
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp バイナリを /usr/local/bin に配置（すべてのユーザーで利用可能）
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

# path 確認（冗長だが明示的）
ENV PATH=/usr/local/bin:$PATH
ENV NODE_ENV=production

# 依存を先にコピーしてキャッシュを活用
COPY package*.json ./

# 可能なら package-lock.json があると npm ci を使う
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --legacy-peer-deps; else npm install --omit=dev --legacy-peer-deps; fi

# アプリをコピー
COPY . .

# セキュリティ: node ユーザーで実行
USER node

EXPOSE 3000

CMD ["node", "index.js"]