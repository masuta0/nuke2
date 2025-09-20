# 1. Node.js 18 をベースにする
FROM node:18

# 2. 作業ディレクトリを作る
WORKDIR /app

# 3. package.json と package-lock.json をコピーして依存関係インストール
COPY package*.json ./
RUN npm install --production

# 4. アプリのソースコードをコピー
COPY . .

# 5. Bot を起動
CMD ["node", "index.js"]