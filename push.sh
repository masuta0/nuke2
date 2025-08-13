#!/bin/bash
# Replit → GitHub push 用ワンライナー

# 環境変数 GH_TOKEN が必要
if [ -z "$GH_TOKEN" ]; then
  echo "❌ 環境変数 GH_TOKEN が設定されていません"
  exit 1
fi

# コミットメッセージ
MSG=${1:-"Update bot code"}

# git push 実行
git add .
git commit -m "$MSG"
git config credential.helper "!f() { echo username=masuta0; echo password=\$GH_TOKEN; }; f"
git push origin main