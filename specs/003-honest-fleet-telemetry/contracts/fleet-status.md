# Contract: `fleet-status.ts` output

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-status.ts           # JSON
bun .cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty  # table
```

## JSON

```jsonc
{
  "root": "/Users/…/rs-sdk",
  "generatedAt": "2026-10-04T11:47:00.000Z",
  "headline": "28 producing, 16 not producing",
  "summary": {
    "producing": ["…"],
    "notProducing": ["…"],          // every kind except producing and paused
    "byKind": {
      "producing": [], "alive-not-producing": [], "churning": [], "capped": [],
      "needs-supplies": [], "needs-client": [], "foreign-owner": [],
      "finished": [], "restartable": [], "paused": []
    }
  },
  "bots": [ /* Fleet verdict rows; see data-model.md */ ]
}
```

**Removed fields**: `command` and `commandSource`, replaced by `restartCommand`, `owner` and `drift`. The `running` / `wake` / `intervene` kinds are gone too. Consumers are the shepherd and the wake-fleet skill; both are updated in the same change.

## Pretty

The first line is always the headline. After it comes one row per bot, sorted with not-producing rows first, then by kind:

```text
28 producing, 16 not producing: Jackpoo1, Jackpoo3, jacklove10, …

bot         kind                 check             levels                       detail
Jackpoo1    alive-not-producing  no_effect         Atk99 Rng76 Fish85           no effect 267m, snapshot 267m old, owner pid 36569 (supervised)
jacklove10  churning             churn             Fish99                       6 relaunches/1h, last stop recovery_exhausted 11:48
Jackpoo5    capped               capped            Atk99 Rng77                  capped 11:37, 5 starts/1h; next start when budget allows
jackthief   needs-supplies       supplies          Atk99 Str87                  missing_supplies ×120 "no super attack in bank"
jacklove4   foreign-owner        foreign_owner     Atk99 Fish99                 owned by converge-and-accept-trade.ts (manual), roster: fishing-route.ts
jacklove7   producing            ok                Fish99                       effect 3m ago, fishing 74k xp/h
```

## Guarantees

1. A row is `producing` only when every check in data-model.md has passed.
2. `restartCommand` is exactly what `fleet-launchd.ts start|restart` will run.
3. `fleet-status` is read-only. It no longer writes `assignment.json`, and it reads (but never writes) the shepherd's launchd `runs` samples.
4. Total runtime for 45 bots is under 10 s, including 45 `launchctl print` calls and the gateway fetches in parallel.
