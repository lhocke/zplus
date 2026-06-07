#!/bin/zsh
# Stop the playtest watcher by its exact PID. Verifies the PID really is the
# watcher before signalling it, and never uses pattern-based killing
# (no pkill / killall).
PIDFILE="/tmp/zork-playtest-watch.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "no watcher pidfile at $PIDFILE; nothing to stop"
  exit 0
fi

pid=$(cat "$PIDFILE")
if ps -p "$pid" -o command= 2>/dev/null | grep -q "watch-playtest.sh"; then
  kill "$pid" && echo "stopped watcher (pid $pid)"
else
  echo "pid $pid is not the watcher (stale pidfile) — not killing anything"
  rm -f "$PIDFILE"
fi
