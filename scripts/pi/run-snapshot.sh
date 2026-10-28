#!/usr/bin/env bash
# Runs `npm run snapshot` for cron on the Raspberry Pi and logs the output.
# Overlapping runs are skipped, and the log is trimmed to the last 2000 lines.
#
#   0 9-21 * * * /home/<user>/fantasy-hockey/scripts/pi/run-snapshot.sh
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
mkdir -p logs
log=logs/snapshot.log

exec 9>logs/snapshot.lock
if ! flock -n 9; then
  echo "$(date '+%F %T') skipped: previous run still going" >>"$log"
  exit 0
fi

echo "=== $(date '+%F %T') snapshot ===" >>"$log"
npm run --silent snapshot >>"$log" 2>&1
status=$?
echo "=== $(date '+%F %T') exit $status ===" >>"$log"

tail -n 2000 "$log" >"$log.tmp" && mv "$log.tmp" "$log"
exit "$status"
