#!/bin/bash

# 1. Bot起動（Node.js）
node index.js &  # & を付けてバックグラウンドで実行

# 2. 自動Push
while true
do
  ./auto_push.sh
  sleep 600  # 10分ごとにpush
done