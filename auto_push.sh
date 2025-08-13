#!/bin/bash
git config user.name "ReplitBot"
git config user.email "replit@replit.com"
git remote set-url origin https://$GH_TOKEN@github.com/username/nuke-bot.git

git add .
git commit -m "auto update $(date +'%Y-%m-%d %H:%M:%S')" 2>/dev/null
git push origin main