# Node 20 をベース
FROM node:20-bullseye

# 作業ディレクトリ
WORKDIR /app

# 必要パッケージをインストール（FFmpeg, Python）
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係インストール（dev は除く）
RUN npm install --omit=dev --legacy-peer-deps

# ソースコードコピー
COPY . .

# 起動
CMD ["node", "index.js"]