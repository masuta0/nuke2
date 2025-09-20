# Node 18 イメージを使用
FROM node:18-bullseye

# 必要なパッケージをインストール
RUN apt-get update && \
    apt-get install -y ffmpeg libsodium-dev git curl && \
    rm -rf /var/lib/apt/lists/*

# 作業ディレクトリ
WORKDIR /app

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm install --production

# アプリのソースをコピー
COPY . .

# Bot 起動
CMD ["node", "index.js"]