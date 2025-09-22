# ベースイメージ
FROM node:20-bullseye

# 作業ディレクトリ
WORKDIR /app

# 必要なシステムパッケージ
RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp をユーザーレベルでインストール
RUN python3 -m pip install --user -U yt-dlp

# PATH にユーザローカルのbinを追加
ENV PATH=/root/.local/bin:$PATH

# package.json と package-lock.json をコピーして依存関係インストール
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# アプリケーションのソースをコピー
COPY . .

# ポート公開
EXPOSE 3000

# 起動コマンド
CMD ["node", "index.js"]