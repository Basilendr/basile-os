#!/bin/sh
# Installe le démarrage automatique (serveur + tunnel) à chaque ouverture de session, avec relance en cas d'arrêt.
# Désinstaller : sh scripts/install-service.sh remove
cd "$(dirname "$0")/.." || exit 1
DIR="$PWD"; LA="$HOME/Library/LaunchAgents"; U=$(id -u)
mkdir -p "$LA"
for name in server tunnel; do
  launchctl bootout "gui/$U/com.basileos.$name" 2>/dev/null
  rm -f "$LA/com.basileos.$name.plist"
done
[ "$1" = "remove" ] && { echo "Démarrage automatique retiré."; exit 0; }
pkill -f "next dev --port 3100" 2>/dev/null
pkill -f "next start --hostname 127.0.0.1" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 2
export PATH="$DIR/.tools/node/bin:$PATH"
[ -f .next/BUILD_ID ] || node node_modules/next/dist/bin/next build || exit 1
for name in server tunnel; do
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
rm -f .data/public-url.txt
for i in $(seq 1 45); do [ -s .data/public-url.txt ] && break; sleep 2; done
[ -s .data/public-url.txt ] && echo "Site public : $(cat .data/public-url.txt)" || echo "Tunnel pas encore prêt, voir .data/tunnel.log"
