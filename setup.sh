#!/usr/bin/env bash
# AOC Dashboard — first-time setup & start
# Usage: bash setup.sh
set -e

echo "=== AOC Dashboard Setup ==="
echo ""

# 1. Check Node version
NODE_VER=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VER" ] || [ "$NODE_VER" -lt 20 ]; then
  echo "ERROR: Node >= 20 required. Current: $(node -v 2>/dev/null || echo 'not found')"
  exit 1
fi
echo "[ok] Node $(node -v)"

# 2. Install dependencies
if [ ! -d "node_modules" ]; then
  echo "[..] Installing dependencies..."
  npm install
else
  echo "[ok] node_modules exists"
fi

# 3. Create .env from example if missing
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    # Auto-generate DASHBOARD_TOKEN
    TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/^DASHBOARD_TOKEN=$/DASHBOARD_TOKEN=$TOKEN/" .env
    else
      sed -i "s/^DASHBOARD_TOKEN=$/DASHBOARD_TOKEN=$TOKEN/" .env
    fi
    # Auto-detect OPENCLAW_HOME
    OPENCLAW_HOME="${HOME}/.openclaw"
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^OPENCLAW_HOME=.*|OPENCLAW_HOME=$OPENCLAW_HOME|" .env
      sed -i '' "s|^OPENCLAW_WORKSPACE=.*|OPENCLAW_WORKSPACE=$OPENCLAW_HOME/workspace|" .env
    else
      sed -i "s|^OPENCLAW_HOME=.*|OPENCLAW_HOME=$OPENCLAW_HOME|" .env
      sed -i "s|^OPENCLAW_WORKSPACE=.*|OPENCLAW_WORKSPACE=$OPENCLAW_HOME/workspace|" .env
    fi
    echo "[ok] Created .env from .env.example (token auto-generated)"
    echo "     >>> Review .env and adjust settings if needed"
  else
    echo "WARNING: .env.example not found. Create .env manually."
  fi
else
  echo "[ok] .env exists"
fi

# 4. Create required directories
mkdir -p logs data
echo "[ok] logs/ and data/ directories"

# 5. Build frontend
echo "[..] Building frontend..."
npx vite build
echo "[ok] Frontend built to dist/"

# 6. Install pm2 if not available
if ! command -v pm2 &> /dev/null; then
  echo "[..] Installing pm2..."
  npm install -g pm2
fi
echo "[ok] pm2 $(pm2 -v)"

# 7. Start with pm2
pm2 describe aoc-dashboard > /dev/null 2>&1 && pm2 restart aoc-dashboard || pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "=== Done! ==="
echo "  Dashboard: http://localhost:${PORT:-18800}"
echo "  Status:    pm2 status"
echo "  Logs:      pm2 logs aoc-dashboard"
echo "  Stop:      pm2 stop aoc-dashboard"
echo ""
echo "  For auto-start on boot, run: pm2 startup"
