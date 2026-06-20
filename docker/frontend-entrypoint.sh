#!/bin/sh
# Runs automatically before nginx starts (official nginx image executes every
# executable script under /docker-entrypoint.d/). Injects the API origin into the
# dashboard so fetch()/WebSocket calls cross to the API container's own domain
# instead of resolving relative to this static frontend's origin.
set -eu

API_ORIGIN="${API_ORIGIN:-https://api-sentry.agentikiq.com}"

envsubst '${API_ORIGIN}' \
  < /usr/share/nginx/html/index.html.template \
  > /usr/share/nginx/html/index.html
