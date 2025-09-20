FROM node:20

# 必要なパッケージをインストール
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg

# yt-dlp をシステムにインストール
RUN apt-get update && apt-get install -y yt-dlp

# 作業ディレクトリ作成
WORKDIR /app

# package.json をコピー
COPY package*.json ./

# npm install（yt-dlp-exec を削除している場合）
RUN npm install --omit=dev --legacy-peer-deps

# ソースコードをコピー
COPY . .

# Bot 起動
CMD ["node", "index.js"]