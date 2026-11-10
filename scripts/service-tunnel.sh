#!/bin/sh
# Lancé par launchd (com.basileos.tunnel) : tunnel Cloudflare vers le serveur local, relancé automatiquement.
# Empêche la mise en veille tant que le Mac est sur secteur, écrit l'adresse publique et l'annonce par une notification.
cd "$(dirname "$0")/.." || exit 1
LOG=.data/tunnel.log
: > "$LOG"
caffeinate -s -w $$ &
.tools/cloudflared/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3100 >> "$LOG" 2>&1 &
CF=$!
for i in $(seq 1 60); do
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" | head -1)
  [ -n "$URL" ] && break
  sleep 2
done
if [ -n "$URL" ]; then
  OLD=$(cat .data/public-url.txt 2>/dev/null)
  echo "$URL" > .data/public-url.txt
  [ "$URL" != "$OLD" ] && osascript -e "display notification \"$URL\" with title \"BASILE OS est en ligne\"" 2>/dev/null
fi
wait $CF
