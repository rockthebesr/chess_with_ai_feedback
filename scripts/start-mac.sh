#!/bin/zsh

set -euo pipefail

project_dir="/Users/Rock/Documents/workspace/chess"
app_url="http://127.0.0.1:5173"

if /usr/bin/curl -fsS "$app_url" >/dev/null 2>&1; then
  /usr/bin/open "$app_url"
  print "Local Chess Coach is already running at $app_url"
  exit 0
fi

cd "$project_dir"

if [[ ! -d node_modules ]]; then
  print "Installing Local Chess Coach dependencies…"
  npm install
fi

print "Starting Local Chess Coach…"
npm run dev &
runner_pid=$!

cleanup() {
  trap - INT TERM EXIT
  if kill -0 "$runner_pid" 2>/dev/null; then
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

for attempt in {1..60}; do
  if /usr/bin/curl -fsS "$app_url" >/dev/null 2>&1; then
    /usr/bin/open "$app_url"
    print "Local Chess Coach is ready. Press Ctrl-C here when you want to stop it."
    wait "$runner_pid"
    exit $?
  fi
  if ! kill -0 "$runner_pid" 2>/dev/null; then
    wait "$runner_pid"
    exit $?
  fi
  sleep 0.25
done

print -u2 "The app did not become ready within 15 seconds."
exit 1
