# ベースイメージ
FROM node:20-bullseye

# 作業ディレクトリ
WORKDIR /app

# システムパッケージと yt-dlp をインストール
RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg curl \
    && pip3 install -U yt-dlp \
    && rm -rf /var/lib/apt/lists/*
# yt-dlp と ffmpeg をインストール
RUN apt-get update && apt-get install -y ffmpeg python3-pip \
# npm 依存関係をコピーしてインストール
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# アプリケーションのソースをコピー
COPY . .

# ポート公開
EXPOSE 3000

# 起動コマンド
CMD ["node", "index.js"]