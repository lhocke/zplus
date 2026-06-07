#!/bin/zsh
# Follow the live playtest transcript, always tracking the newest session log.
#
# Start it once — it auto-switches to a new log whenever `npm run play` begins,
# so there's no kill/restart churn between playtests. Stop it with
# tools/stop-playtest-watch.sh (or, if launched as a harness task, TaskStop).
#
# Only ever kills its own child tail by exact PID — never a pattern match.
set -u

LOGDIR="${1:-/Users/lhocke/Code/zork-test/playtest-logs}"
PIDFILE="/tmp/zork-playtest-watch.pid"

echo $$ > "$PIDFILE"

tailpid=""
cleanup() { [ -n "$tailpid" ] && kill "$tailpid" 2>/dev/null; rm -f "$PIDFILE"; exit 0; }
trap cleanup TERM INT EXIT

current=""
echo "[watcher] watching $LOGDIR for the newest play session..."
while true; do
  newest=$(ls -t "$LOGDIR"/session-*.log 2>/dev/null | head -1)
  if [ -n "$newest" ] && [ "$newest" != "$current" ]; then
    [ -n "$tailpid" ] && kill "$tailpid" 2>/dev/null
    current="$newest"
    echo "[watcher] now following $(basename "$current")"
    tail -n +1 -f "$current" &
    tailpid=$!
  fi
  sleep 2
done
