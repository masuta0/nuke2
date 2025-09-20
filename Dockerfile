# Node.js 18 イメージを使用
FROM node:18-bullseye

# 必須パッケージをインストール（FFmpeg と libsodium）
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsodium-dev \
    python3 \
    python3-pip \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリ
WORKDIR /app

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm install --production

# ソースコードをコピー
COPY . .

# Bot 実行
CMD ["node", "index.js"]