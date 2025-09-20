# Node 20 をベースにする
FROM node:20-bullseye

# 作業ディレクトリ
WORKDIR /app

# 必要なパッケージのインストール（FFmpeg も含む）
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係インストール（dev は除く、peer 依存警告無視）
RUN npm install --omit=dev --legacy-peer-deps

# ソースコードをコピー
COPY . .

# 起動コマンド
CMD ["node", "index.js"]