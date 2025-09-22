# ベースイメージ
FROM node:20-bullseye

# 作業ディレクトリ
WORKDIR /app

# 必要なシステムパッケージ
RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp をユーザーレベルでインストール
RUN pip3 install --user -U yt-dlp

# npm 依存関係をコピーしてインストール
COPY package*.json ./

# アプリケーションのソースをコピー
COPY . .

# PATH にユーザローカルのバイナリを追加
ENV PATH=/root/.local/bin:$PATH

# ポート公開
EXPOSE 3000

# 起動コマンド
CMD ["node", "index.js"]