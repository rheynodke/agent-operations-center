#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "▶ git pull"
git pull --ff-only

if ! git diff --quiet HEAD@{1} HEAD -- package.json package-lock.json 2>/dev/null; then
  echo "▶ package.json changed → npm install"
  npm install --no-audit --no-fund
else
  echo "▶ package.json unchanged → skipping npm install"
fi

echo "▶ vite build"
npm run build

echo "▶ pm2 restart aoc-dashboard --update-env"
pm2 restart aoc-dashboard --update-env || pm2 start ecosystem.config.cjs

echo "▶ pm2 save"
pm2 save

echo
pm2 list | grep -E "name|aoc-dashboard" || true
echo
echo "▶ health checks"
sleep 3
LOCAL=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:18800/ || echo "000")
PUBLIC=$(curl -s -o /dev/null -w "%{http_code}" https://agents.dke.dev/ || echo "000")
echo "  local  http://localhost:18800/    → $LOCAL"
echo "  public https://agents.dke.dev/    → $PUBLIC"

if [ "$LOCAL" != "200" ]; then
  echo
  echo "✗ local health check failed — last 20 error log lines:"
  pm2 logs aoc-dashboard --err --lines 20 --nostream
  exit 1
fi

echo
echo "✓ deploy ok"
