# ベースイメージ
FROM node:20-bullseye
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

# 依存関係をインストール（npm 10.x のまま）
RUN npm install --omit=dev

# 残りのソースコードをコピー
COPY . .

# yt-dlp をグローバルにインストール
RUN npm install -g yt-dlp-exec

# ポート設定（監視用 Express サーバー）
EXPOSE 3000

# 起動コマンド
CMD ["node", "index.js"]