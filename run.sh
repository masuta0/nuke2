#!/bin/bash
git add .
git commit -m "Auto update from Replit $(date '+%Y-%m-%d %H:%M:%S')" || echo "No changes to commit"
git push origin main