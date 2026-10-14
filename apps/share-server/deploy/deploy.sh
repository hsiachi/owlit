#!/usr/bin/env bash
# Puts the share server on a machine you can ssh into, as a systemd service, and starts it.
#
#   apps/share-server/deploy/deploy.sh <ssh-host> <public-url>
#   apps/share-server/deploy/deploy.sh algernon https://share.example.org
#
# public-url is where links will point. Behind a reverse proxy that holds the certificate (see Caddyfile),
# the server listens on 127.0.0.1:8787 only. With an http://<ip>:<port> URL and no proxy, it listens on
# every address instead (unencrypted: fine to try it out, not for real drafts).
# The machine needs Node 22.13 or later and sudo for the service; data lives in ~/owlit-share/data.
set -euo pipefail

host=${1:?usage: deploy.sh <ssh-host> <public-url>}
url=${2:?usage: deploy.sh <ssh-host> <public-url>}
url=${url%/}
port=${PORT:-8787}
root=$(cd "$(dirname "$0")/../../.." && pwd)

listen=127.0.0.1
trust=1
if [[ $url == http://* ]]; then
  listen=0.0.0.0
  trust=0
  port=$(sed -E 's#^http://[^/:]+:?([0-9]*).*#\1#' <<<"$url")
  port=${port:-80}
fi

echo "→ building the server and the reader's page"
pnpm --dir "$root" --filter @owlit/share-server build
pnpm --dir "$root" --filter @owlit/share-web build

echo "→ checking $host"
node_path=$(ssh "$host" 'bash -lc "command -v node"') || { echo "Node isn't installed on $host (it needs 22.13 or later)."; exit 1; }
ssh "$host" "$node_path -e 'const [a,b]=process.versions.node.split(\".\").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'" ||
  { echo "Node on $host is older than 22.13, which node:sqlite needs."; exit 1; }
remote_user=$(ssh "$host" 'id -un')
remote_home=$(ssh "$host" 'printf %s "$HOME"')

echo "→ copying to $host:~/owlit-share"
ssh "$host" 'mkdir -p ~/owlit-share/web ~/owlit-share/data'
rsync -az --delete "$root/apps/share-web/dist/" "$host:owlit-share/web/"
rsync -az "$root/apps/share-server/dist/server.mjs" "$host:owlit-share/server.mjs"

echo "→ installing the owlit-share service"
sed -e "s#@USER@#$remote_user#g" -e "s#@HOME@#$remote_home#g" -e "s#@NODE@#$node_path#g" -e "s#@URL@#$url#g" \
  -e "s#@PORT@#$port#g" -e "s#@HOST@#$listen#g" -e "s#@TRUST@#$trust#g" \
  "$root/apps/share-server/deploy/owlit-share.service" | ssh "$host" 'cat > ~/owlit-share/owlit-share.service'
# A terminal of its own, so sudo can ask for the password
ssh -t "$host" 'sudo install -m 644 ~/owlit-share/owlit-share.service /etc/systemd/system/owlit-share.service && sudo systemctl daemon-reload && sudo systemctl enable owlit-share >/dev/null 2>&1 && sudo systemctl restart owlit-share'

sleep 1
if ssh "$host" "curl -fsS http://127.0.0.1:$port/healthz" >/dev/null; then
  echo "✓ running on $host:$port; links will be $url/s/<id>"
  echo "  Point owlit at it: OWLIT_SHARE_SERVER=$url pnpm build (or pnpm dev with it set)"
else
  echo "✗ it didn't answer; see: ssh $host journalctl -u owlit-share -n 50"
  exit 1
fi
