# ベースイメージを Node 18 に設定
FROM node:18-bullseye

# 必要な OS パッケージをインストール（FFmpeg, libsodium）
RUN apt-get update && \
    apt-get install -y ffmpeg python3 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリを作成
WORKDIR /app

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm install --omit=dev

# ソースコードをコピー
COPY . .

# ポートを公開
EXPOSE 3000

# Bot を起動
CMD ["node", "index.js"]