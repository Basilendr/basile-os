#!/bin/sh
# Installe le démarrage automatique du serveur du Mac à chaque ouverture de session, avec relance en cas d'arrêt.
# Le site public est sur Vercel : le serveur du Mac sert à faire tourner les tâches (École Directe, quiz, rappels).
# Ancien tunnel Cloudflare (accès public au Mac) : seulement avec `sh scripts/install-service.sh tunnel`.
# Désinstaller : sh scripts/install-service.sh remove
cd "$(dirname "$0")/.." || exit 1
DIR="$PWD"; LA="$HOME/Library/LaunchAgents"; U=$(id -u)
mkdir -p "$LA"
for name in server tunnel; do
  launchctl bootout "gui/$U/com.basileos.$name" 2>/dev/null
  rm -f "$LA/com.basileos.$name.plist"
done
[ "$1" = "remove" ] && { echo "Démarrage automatique retiré."; exit 0; }
SERVICES=server
[ "$1" = "tunnel" ] && SERVICES="server tunnel"
pkill -f "next dev --port 3100" 2>/dev/null
pkill -f "next start --port 3100" 2>/dev/null
pkill -f "next start --hostname 127.0.0.1" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
# Un serveur lancé à la main (son processus s'appelle « next-server ») occuperait le port : on l'arrête aussi.
lsof -ti tcp:3100 -sTCP:LISTEN | xargs kill 2>/dev/null
sleep 2
export PATH="$DIR/.tools/node/bin:$PATH"
[ -f .next/BUILD_ID ] || node node_modules/next/dist/bin/next build || exit 1
for name in $SERVICES; do
  [ $name = server ] && SCRIPT=start.sh LOG=server.log || { SCRIPT=service-tunnel.sh; LOG=tunnel-service.log; }
  cat > "$LA/com.basileos.$name.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.basileos.$name</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$DIR/scripts/$SCRIPT</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DIR/.data/$LOG</string>
  <key>StandardErrorPath</key><string>$DIR/.data/$LOG</string>
</dict></plist>
PL
  launchctl bootstrap "gui/$U" "$LA/com.basileos.$name.plist"
done
if [ "$1" = "tunnel" ]; then
  rm -f .data/public-url.txt
  for i in $(seq 1 45); do [ -s .data/public-url.txt ] && break; sleep 2; done
  [ -s .data/public-url.txt ] && echo "Site public : $(cat .data/public-url.txt)" || echo "Tunnel pas encore prêt, voir .data/tunnel.log"
else
  for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:3100/login && break; sleep 1; done
  curl -s -o /dev/null -w "Serveur du Mac lancé (code %{http_code}), relancé automatiquement à chaque ouverture de session.\n" http://127.0.0.1:3100/login
fi
