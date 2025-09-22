# ベースイメージ
FROM node:20-bullseye

WORKDIR /app

# yt-dlp と ffmpeg をインストール
RUN apt-get update && apt-get install -y \
    ffmpeg python3-pip \
RUN python3 -m pip install --user -U yt-dlp
ENV PATH=/root/.local/bin:$PATH

# 依存関係
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# ソースコピー
COPY . .

# パスに追加（pip3 install の場所）
ENV PATH="/usr/local/bin:$PATH"

EXPOSE 3000

CMD ["node", "index.js"]