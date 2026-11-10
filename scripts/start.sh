#!/bin/sh
# Serveur de production (à lancer après `npm run build`). N'écoute que sur la machine : l'accès public passe par le tunnel.
cd "$(dirname "$0")/.." || exit 1
export PATH="$PWD/.tools/node/bin:$PATH"
export NODE_ENV=production
[ -z "$ENCRYPTION_KEY" ] && [ -f .data/encryption.key ] && ENCRYPTION_KEY="$(cat .data/encryption.key)" && export ENCRYPTION_KEY
exec node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port "${PORT:-3100}"
