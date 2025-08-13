#!/bin/bash

# GitHub情報
USER=$GH_USER
TOKEN=$GH_TOKEN
REPO=$GH_REPO
BRANCH=main  # ブランチ名

# Git操作
git add .
git commit -m "Replit auto update" || echo "Nothing to commit"
git push https://$USER:$TOKEN@github.com/$USER/$REPO.git $BRANCH