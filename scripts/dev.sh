#!/bin/sh
# Lance le serveur de développement avec le Node.js local du projet (.tools/node).
cd "$(dirname "$0")/.." || exit 1
export PATH="$PWD/.tools/node/bin:$PATH"
exec node node_modules/next/dist/bin/next dev --port "${PORT:-3100}"
