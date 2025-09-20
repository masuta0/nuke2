# ベースイメージ
FROM node:18-bullseye

# 作業ディレクトリ作成
WORKDIR /app

# 必要な OS パッケージをインストール
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    build-essential \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ソースコードを先にコピー（依存関係キャッシュ用）
COPY package*.json ./

# npm を更新
RUN npm install -g npm@11.6.0

# 依存関係をインストール
RUN npm install --omit=dev

# 残りのソースコードをコピー
COPY . .

# yt-dlp をグローバルにインストール
RUN npm install -g yt-dlp-exec

# ポート設定（監視用 Express サーバー）
EXPOSE 3000

# 起動コマンド
CMD ["node", "index.js"]