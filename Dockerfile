FROM node:20-bullseye

WORKDIR /app

# pip と ffmpeg をインストール
RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp をユーザーレベルでインストール
RUN python3 -m pip install --user -U yt-dlp

# npm 依存関係をコピーしてインストール
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# アプリケーションコピー
COPY . .

# PATH に yt-dlp のパスを追加
ENV PATH=/root/.local/bin:$PATH

CMD ["node", "index.js"]