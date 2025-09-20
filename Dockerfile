FROM node:20-slim

# 必要ツール
RUN apt-get update && \
    apt-get install -y python3 ffmpeg curl && \
    rm -rf /var/lib/apt/lists/*

# yt-dlp の最新バイナリを取得
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# 作業ディレクトリ
WORKDIR /app

# package.json をコピーして依存関係インストール
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# アプリコピー
COPY . .

CMD ["node", "index.js"]