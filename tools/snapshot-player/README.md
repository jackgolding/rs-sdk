# snapshot-player: live player → local debug clone

Copy a fleet bot's live state (Fly demo server) onto your local server
(`~/rs-sdk-offline`) for debugging, without touching the live account.

## Workflow

```sh
# 1. Stop the live bot FIRST (snapshot login pre-empts its session).
#    Mac bot:
bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts stop <Name>
#    VPS bot (slug = lowercase name):
ssh root@$IP "cd /srv/fleet/repo && docker compose -f infra/pilot/compose.fleet.yml stop lite-<slug> quest-<slug>"

# 2. Snapshot (from ~/rs-sdk-offline; passwords read from the fleet checkout):
bun tools/snapshot-player/snapshot.ts <BotName>
#    -> snapshots/<name>-<stamp>.json

# 3. Apply to the local server (player must be offline locally):
cd server/engine && bun tools/server/snapshot-apply.ts ../../snapshots/<name>-<stamp>.json [--dry-run]

# 4. Log in locally as the player. First login auto-registers the account,
#    so ANY password works; the snapshot save is picked up.
# 5. Restart the live bot (start / compose start).
```

## What copies / what doesn't

| Copies | Doesn't (SDK can't see it) |
|---|---|
| all 21 skill XPs (exact) | bank contents |
| backpack inventory (id+count per slot) | quest varps / quest points |
| worn equipment (slot-for-slot) | appearance, playtime |
| map position, run energy | GE offers, hiscores rows |

Apply preserves everything already in the local save (bank, quests,
appearance) and overwrites only position/stats/inv/worn. A `.bak` of the
previous local save is kept next to the `.sav`.

## Why not just copy the .sav?

The live saves live on the Fly volume (`/opt/server/data/players/main/`),
which we can't reach over SSH — and the Hetzner box only runs bots, no
engine. So the snapshot goes through the SDK as the player, and the apply
side rebuilds a `.sav` with the engine's own `Player.save()` (no
hand-rolled byte layout to rot across `SAV_VERSION` bumps).

Equipment slots assume client interface-1688 order == engine `worn` order
(`^wearpos_*` in `player/configs/equip.constant`) — true on this rev; the
apply verifies by reloading the written save.
