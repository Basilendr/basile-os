#!/bin/sh
# Seconde instance isolée (base et build séparés) pour vérifier l'interface sans toucher aux données réelles.
cd "$(dirname "$0")/.." || exit 1
export PATH="$PWD/.tools/node/bin:$PATH"
export DATA_DIR=.data-preview NEXT_DIST_DIR=.next-preview APP_URL=http://localhost:3101 DISABLE_SCHEDULER=1
exec node node_modules/next/dist/bin/next dev --port 3101
