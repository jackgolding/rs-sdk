#!/usr/bin/env bash
# Install the VPS fleet shepherd timer. Run on the box after the repo exists
# at /srv/fleet/repo (see infra/pilot README bring-up). Idempotent: safe to
# re-run after every change to infra/pilot/systemd/.
#
#   ssh root@$IP "bash /srv/fleet/repo/infra/pilot/install-shepherd.sh"
#
# Validate first (read-only, prints what a cycle WOULD do):
#   ssh root@$IP "FLEET_SUPERVISOR=docker FLEET_BOTS_DIR=/srv/fleet/bots \
#     FLEET_STATE_DIR=/srv/fleet/state \
#     bun /srv/fleet/repo/.cursor/skills/wake-fleet/scripts/fleet-shepherd.ts --plan"
# Logs: journalctl -u fleet-shepherd.service; actions: /srv/fleet/state/shepherd.log
set -euo pipefail

SRC=/srv/fleet/repo/infra/pilot/systemd
mkdir -p /srv/fleet/state
cp "$SRC/fleet-shepherd.service" "$SRC/fleet-shepherd.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now fleet-shepherd.timer
systemctl list-timers fleet-shepherd.timer --no-pager
