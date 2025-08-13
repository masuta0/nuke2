#!/bin/bash
git config user.name "masuta0"
git config user.email "kuntekitou96@gmail.com"
git remote set-url origin https://$GH_TOKEN@github.com/masuta0/nuke2.git

git add .
git commit -m "auto update $(date +'%Y-%m-%d %H:%M:%S')" 2>/dev/null
git push origin main