# Node 20 ベース
FROM node:20-slim

# 必要パッケージのインストール
RUN apt-get update && \
    apt-get install -y python3 ffmpeg curl && \
    rm -rf /var/lib/apt/lists/*

# yt-dlp バイナリを直接ダウンロード
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# 作業ディレクトリ
WORKDIR /app

# package.json & package-lock.json をコピーして依存関係インストール
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# アプリケーションのソースコードをコピー
COPY . .

# Bot 起動
CMD ["node", "index.js"]