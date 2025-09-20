# Dockerfile例
FROM node:20-slim

# 必要ツールのインストール
RUN apt-get update && apt-get install -y python3 ffmpeg && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリ
WORKDIR /app

# package.json をコピー
COPY package*.json ./

# npm install
RUN npm install --omit=dev

# アプリケーションコピー
COPY . .

# 起動
CMD ["node", "index.js"]