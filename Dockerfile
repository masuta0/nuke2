# Node.js ベースイメージ
FROM node:20-slim

# 作業ディレクトリ作成
WORKDIR /app

# 依存関係インストールのため package.json / package-lock.json をコピー
COPY package*.json ./

# ffmpeg と yt-dlp インストール
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g npm@latest

# npm install 実行
RUN npm install --omit=dev

# アプリコードをコピー
COPY . .

# ポート指定（Express用）
EXPOSE 3000

# 起動コマンド
CMD ["npm", "start"]