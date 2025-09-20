# ベースイメージ（Node 18）
FROM node:18-bullseye

# 作業ディレクトリ
WORKDIR /app

# 必要パッケージをインストール
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp を直接インストール
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存関係インストール（dev は除く）
RUN npm install --omit=dev

# ソースコードをコピー
COPY . .

# ポート設定
EXPOSE 3000

# 起動コマンド
CMD ["node", "index.js"]