# Node.js 18 をベースにする
FROM node:18

# 必要パッケージインストール
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean

# 作業ディレクトリ
WORKDIR /app

# パッケージコピー
COPY package*.json ./
RUN npm install

# アプリケーションコピー
COPY . .

# ポート指定
EXPOSE 3000

# 起動
CMD ["node", "index.js"]