# Research: Autonomous Activity Recovery

## 1. Where to put recovery

**Decision**: Shared `sdk/activity.ts` (`ActivitySession`) imported by character scripts. Not a tmux supervisor, not duplicated inside `bowstrings.ts`.

**Rationale**: `watch-fleet.sh` is view-only. Stalls happen inside the control process. Recovery needs `bot`/`sdk` and must run on the same connection. Constitution III requires shared porcelain.

**Alternatives considered**:
- Extend `bots/watch-fleet.sh` to kill/restart scripts — cannot recover mid-phase (wrong floor, open modal).
- Copy stall counters into each bot script — this is the current failure mode.
- OS process supervisor only — useful later for reconnect, insufficient for in-game stalls.

## 2. Progress and stall thresholds

**Decision**: Defaults from the spec: no progress for 2 minutes, or the same failure code 5 times in 2 minutes → recovery. Recovery budget: 4 tactics or 3 minutes, then stop. Scripts may override via config.

**Rationale**: Matches observed Jackpoo1 wheel/bank loops (~3 minutes of immediate retries). Fail-fast constitution already discourages unbounded loops.

**Alternatives considered**:
- Tick-based thresholds — harder to test; wall-clock matches operator experience.
- Unlimited retries with backoff — still babysits; spec forbids infinite click.

## 3. Bank vs craft window

**Decision**: Treat bank success as `state.bank.isOpen` only. Close non-bank interfaces before attempting bank. If a skill-product dialog (`Make X` / flax / wool) is open during the bank wait, close it and continue waiting. Align the in-flight early-return (already `bank.isOpen`) with the wait-loop success paths (still `interface.isOpen` today).

**Rationale**: Spec FR-006/FR-007. Current `_openBankOnce` can report success on a spinning-wheel modal.

**Alternatives considered**:
- Interface-id allowlist — brittle across client builds.
- Click option 0 on any dialog at the booth — current bug.

## 4. Intent channel

**Decision**: Use in-flight `sdk.showIntent()` → `localChat` → client-only game message. `ActivitySession` is the required caller (phase changes and recovery). Scripts may also call it. Dedup stays in `BotSDK`.

**Rationale**: Spec FR-012/FR-013 and constitution III (new API must have a caller). Public `say()` would leak intent and hit social packet rate.

**Alternatives considered**:
- Grind-log only — watcher looking at the client sees nothing.
- Public chat — hostile and rate-limited.

## 5. Travel then grind handoff

**Decision**: One `runScript` entry: if not at flax, run the existing wilderness-lever travel (extracted from `to-flax.ts` as functions imported by `bowstrings.ts`); on arrival, enter the grind loop. `to-flax.ts` becomes a one-liner that runs the same module with `grind: false` only if we still want a travel-only tool; default operator command is `bun bots/Jackpoo1/bowstrings.ts`.

**Rationale**: Spec US3. `to-flax.ts` currently disconnects on arrival.

**Alternatives considered**:
- Child-process spawn of `bowstrings.ts` — second launch, still a human-shaped state machine.
- Keep two files forever — fails FR-014.

## 6. Floor / stairs helper

**Decision**: Extract a small `reachFloor(level)` (or reuse script-local `climbTo`) into `sdk/actions.ts` only if a second caller needs it in this feature. First caller is flax recovery. If extraction would be unused by SDK tests besides flax, keep climb in the activity recovery callbacks registered by the script, and add a unit-tested helper for "choose climb loc matching up/down."

**Rationale**: Constitution III — do not add porcelain without a caller. Lumbridge stairs integration test already exists for live climb.

**Alternatives considered**:
- Full `bot.spinFlax()` in this feature — valuable later, not required for the spec if recovery + existing interact/use-item path works.
- Always extract `reachFloor` now — risk of unused API.

## 7. `hasLineOfSight`

**Decision**: Do not export from `sdk/pathfinding.ts` in this feature. Keep the implementation private or leave it unexported. Thieving stall LOS is a later spec.

**Rationale**: Constitution III / FR-019. No flax/recovery caller.

**Alternatives considered**:
- Wire into pickpocket now — out of spec scope.
- Ship unused export "for later" — forbidden.

## 8. Testing strategy

**Decision**: Mock-based unit tests (pattern in `sdk/test/walkto-partial-path.test.ts`) for walk blocked-start, bank skill-dialog, trapdoor filter, shop `cant_reach` reason, and `ActivitySession` budget. Live 50-trip bar is operator canary documented in `quickstart.md`, not CI.

**Rationale**: CI (`bun run check`) does not run live bots. Spec still requires evidence-first tests for decision branches.

**Alternatives considered**:
- Only live canary — regressions return as babysitting.
- Add Seers trip to CI — needs a logged-in character and is flaky in GitHub Actions.

## 9. Essence trip (Jackpoo2)

**Decision**: Second P1 canary. Same `ActivitySession`. Extract the mine loop from `bots/quests/rune-mysteries.ts` into `bots/Jackpoo2/essence.ts`. Quest completion is not in this feature's live bar.

**Rationale**: Production already stalls on Aubury teleport ("Nothing happened") and Varrock east bank-open spam. If recovery only ships in bowstrings, it is not shared.

**Alternatives considered**:
- Keep quest+mine in one file — mixes out-of-scope quest walkthrough with the canary.
- Only flax in v1 — user signed off 1b as in-scope.

## 10. Ghostty log / warn / error

**Decision**: Every grind-log line is prefixed with a severity token (`LOG`, `WARN`, `ERROR` or equivalent). `bots/watch-fleet.sh` (or the tail it runs) colorizes those tokens: quiet default, yellow warn, red error. `ActivitySession` emits warn on recovery and error on stop.

**Rationale**: Operator asked for Ghostty attention color, not a new dashboard. Independent tests are "glance at the pane."

**Alternatives considered**:
- Color only in the game client — operator watches Ghostty, not 7 clients.
- Public chat severity — hostile and rate-limited.
