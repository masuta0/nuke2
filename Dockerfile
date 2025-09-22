FROM node:20-bullseye-slim

WORKDIR /app

# 必要パッケージ
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl && rm -rf /var/lib/apt/lists/*

# yt-dlp をユーザー領域にインストール
RUN pip3 install --user -U yt-dlp

# PATH を通す
ENV PATH=/root/.local/bin:$PATH

# 依存関係
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# ソースコピー
COPY . .

# ポート
EXPOSE 3000

# 起動
CMD ["node", "index.js"]