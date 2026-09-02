# Contract: ActivitySession

Public module: `sdk/activity.ts` (re-exported from `sdk/index.ts` if scripts import from there).

## Constructor

```ts
new ActivitySession(sdk: BotSDK, bot: BotActions, config: {
  name: string;
  stallMs?: number;                 // default 120_000
  repeatFailCount?: number;         // default 5
  repeatFailWindowMs?: number;      // default 120_000
  maxRecoveryTactics?: number;      // default 4
  recoveryBudgetMs?: number;        // default 180_000
})
```

## Methods

| Method | Behavior |
|--------|----------|
| `setPhase(phase: string)` | Sets phase, shows intent, notes `phase` progress |
| `noteProgress(kind, detail?)` | Records progress; exits recovery |
| `noteFailure(code, message)` | Records failure; may arm recovery |
| `needsRecovery(): boolean` | True if stall or repeat-fail threshold hit and not stopped |
| `registerRecovery(tactics: RecoveryTactic[])` | Ordered callbacks; each returns whether progress resumed |
| `recover(): Promise<'resumed' \| 'exhausted'>` | Runs next unused tactics until progress, budget, or list end. On exhaust: set stopReason, no further actions |
| `showIntent(message: string)` | Delegates to `sdk.showIntent` |
| `isStopped(): boolean` | `stopReason !== null` |
| `stop(code, message)` | Sets stopReason from current location/phase |
| `metrics()` | `{ phase, trips, itemsBanked, stallMs, recoveries, stopReason, lastSeverity }` |
| `recordTrip(quantity: number)` | Increments trip counters |
| `log(level, message)` | Writes grind-log + console with `log` \| `warn` \| `error`; samples repeated warn/log |

`RecoveryTactic`: `{ name: string; run: () => Promise<boolean> }` — `true` means the world showed progress.

## Guarantees

- After `exhausted` or `stop()`, further `recover()` calls do not send walk/interact/bank packets.
- `needsRecovery()` is false while `isStopped()`.
- Logging of a repeated `noteFailure` code is sampled (first, then every 10th, plus a running count) so grind.log cannot grow by more than 50 identical lines per minute under default tick rates.
- `recover()` logs **warn**; `stop()` logs **error** (never sampled away). `setPhase` / trip complete logs **log**.

## Errors

Throw only on programmer misuse (empty name, recover with no tactics registered when recovery is needed). World failures are `noteFailure` + stop reasons, not thrown exceptions, except disconnect which may still throw `BotDisconnectedError` from `runScript`.
