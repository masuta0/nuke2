FROM node:20

# 作業ディレクトリ作成
WORKDIR /app

# 依存関係のコピー
COPY package*.json ./

# 既存 node_modules と lock ファイルを削除してからインストール
RUN rm -rf node_modules package-lock.json \
    && npm install --omit=dev --legacy-peer-deps

# yt-dlp インストール（Python 版をシステムに）
RUN apt-get update && apt-get install -y yt-dlp

# アプリケーションのソースコードをコピー
COPY . .

# ポート公開
EXPOSE 3000

# 起動コマンド
CMD ["node", "index.js"]