# headless/sim — Brain-sim-lite (from Rig Simulator Atlas)

One bot brain against a hand-ported world model. Proves **mechanism**: does the
bot send the right action, take the right path, decode the right state.
Adapted to rs-sdk's level: bots speak `BotAction` over the gateway, so the
harness validates there — no ISAAC packet layer.

Rule (Atlas): **a bot is never edited to make a test pass.**

## Files

| File | Atlas ref | Job |
|---|---|---|
| `protocol.ts` | protocol.ts (456 lines) | Known-`BotAction` check; unknown type throws loudly |
| `world.ts` | world.ts (475 lines) | Movement: 25-waypoint cap, diagonal→E/W→N/S, blocked step wedges, loc ops only on zero-step ticks, MOVE clears pending op, seeded RNG |
| `harness.ts` | harness.ts (299 lines) | `SimHarness`: brain `(state) => action` vs one world, deferred apply order, idle watchdog |
| `chaos.ts` | chaos switchboard | `SIM_DOORS` random+flip, `SIM_DROP` hold-and-flush, `SIM_NET_LATE` ordered jitter, deadline counter |
| `run-tests.ts` | run-tests.ts gate | Batches of 6, labels OK/FAIL/PANIC/TIMEOUT, splits panicked batches |
| `replay-validate.ts` | replay-validate.ts | Live-vs-sim metric ratios, PASS within 5% |

## Run

```bash
bun test headless/sim            # direct
bun headless/sim/run-tests.ts    # the gate (batch labels, panic splitting)
bun headless/sim/replay-validate.ts live.json sim.json [--tol 0.05]
```

## Proof hygiene (Atlas Part 5)

- Report **logged-in clock**, never wall total.
- Proof lanes run with **all chaos on**; single switches are repro-only.
- Chaos uses its **own PRNG** — world RNG untouched.
- Jitter preserves order: everything flows through one queue with
  head-of-line blocking; bytes arrive late, never lost.

## Deliberately not ported (yet)

CoopHarness multi-bot (trade/bank ports), combat EV model, skill ports
(mining/fishing), mapload from real jm2, fork/split mode, 50-lane proof
batches. Add when a bug demands them — one at a time.
