#!/bin/sh
# Publie le site sur internet : serveur de production + tunnel Cloudflare (adresse https://….trycloudflare.com).
# L'adresse publique est écrite dans .data/public-url.txt. Le Mac doit rester allumé.
cd "$(dirname "$0")/.." || exit 1
CF=.tools/cloudflared/cloudflared
[ -x "$CF" ] || { echo "cloudflared manquant (.tools/cloudflared/cloudflared)"; exit 1; }
pkill -f "next dev --port 3100" 2>/dev/null
pkill -f "next start --hostname 127.0.0.1" 2>/dev/null
pkill -f "cloudflared tunnel --url" 2>/dev/null
sleep 2
export PATH="$PWD/.tools/node/bin:$PATH"
[ -f .next/BUILD_ID ] || node node_modules/next/dist/bin/next build || exit 1
nohup sh scripts/start.sh > .data/server.log 2>&1 &
nohup "$CF" tunnel --no-autoupdate --url http://127.0.0.1:3100 > .data/tunnel.log 2>&1 &
for i in $(seq 1 30); do
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" .data/tunnel.log | head -1)
  [ -n "$URL" ] && break
  sleep 2
done
[ -n "$URL" ] && echo "$URL" > .data/public-url.txt && echo "Site public : $URL" || { echo "Tunnel non démarré, voir .data/tunnel.log"; exit 1; }
