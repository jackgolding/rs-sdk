# Quest development and staging pipeline

Status: proposed plan, grounded in read-only inspection. No quest run, fixture creation, game restart or fleet change has been performed for this plan.

## Goal and scope

Produce a reusable, resumable script for every formal quest supported by the pinned local rs-sdk content, with recorded checkpoint evidence and clean-account staging verification.

The inspected checkout is `/Users/jackgolding/rs-sdk-offline`, revision `53d412fc8`, with existing uncommitted changes. The local quest list has **68 distinct quest entries** (70 registrations because two entries have alternative branches). The audit identified **15 existing primary quest scripts** to adapt, not to assume correct. Miniquests such as Barcrawl are a separate backlog. Source presence does not prove all quests are playable; unsupported content and engine defects must remain explicit blockers.

## Environment constraint (decides what may be depended on)

- **The local engine is ours to change.** `~/rs-sdk-offline` may be modified
  freely for fixtures, faster ticks, debug procs and authoritative state reads.
- **The Fly demo server (`rs-sdk-demo.fly.dev`) is not ours.** Nothing may be
  added to it.

Consequences, which the code must enforce rather than assume:

1. **Shipped quest scripts use only standard SDK actions and client-visible
   state.** No staff cheats, no `::` commands, no custom endpoints, no reliance
   on local-only hacks such as the `staffModLevel` patch.
2. **The journal is the checkpoint gate** because it is rendered server-side
   into the client interface and therefore behaves identically on both. This is
   what makes checkpoint validation portable.
3. **Local engine additions are for fixtures and diagnosis only** — including
   an authoritative quest-varp read used to cross-check the journal reader
   itself, since non-transmit varps (e.g. `druidquest`) are never sent to a
   client (`server/engine/src/engine/entity/Player.ts:565`).
4. **Never hardcode a numeric interface component id.** Target components by
   their client-visible label so local/demo content drift cannot silently break
   a route.

All other constraints stand: do not modify `~/rs-sdk`, the VPS, fleet
assignments, existing human accounts or unrelated local jobs. The local world
already has players: no global restart or tick-rate change without
coordination.

## Pipeline

`catalogued → fixture verified → draft → supervised development → frozen candidate → staging → verified`

Any stage can enter `blocked`, with evidence and a reason. A staging failure returns the candidate to development. Status is metadata, not a physical relocation of source files that could break imports.

0. **Foundation (delivered).** `quest-lab/catalogue.ts` derives all 68
   quest-list entries from the pinned content; `quest-lab/evidence.ts` gates a
   checkpoint on journal evidence with PASS/FAIL/UNKNOWN; `quest-lab/records.ts`
   stores immutable run identity and append-only checkpoint evidence. Buttons are
   targeted by visible label, not component id.

1. **Build the canonical quest catalogue**

Use actual server quest-list registrations, quest scripts, journal handlers, constants, varps and varbits as the authority. Generated wiki pages are research aids, not provisioning truth: the audit found filename aliasing and incomplete extraction.

Each reviewed manifest specifies:

- Stable quest ID, display name, source references, content revision and supported branch.
- Prerequisite dependency closure, quest-point threshold, auxiliary flags/unlocks and any cooperating accounts.
- Target quest's unstarted predicate and explicit completion predicate; do not assume every quest is one integer or that completion is always equality.
- Maxed skill setup using the engine's XP table, ordinary legal equipment, food and travel supplies.
- Required item IDs, quantities, acquisition stage, consumption and restock policy.
- A reviewed, reachable bank near the quest start, exact tile/plane and route. Nearest straight-line bank is insufficient.
- Ordered checkpoints, allowed transitions, journal expectations, supporting evidence and bounded recovery policy.

Build and validate the dependency graph before scheduling quests. Reject missing prerequisites, cycles and unresolved item definitions instead of guessing.

### 2. Provision reproducible accounts

Build one engine-backed fixture materializer rather than chaining the existing save-edit CLIs unchanged.

For each development or staging run:

1. Reserve a new disposable username and run ID; explicitly require local game and gateway endpoints.
2. Apply maxed normal skills, full health/prayer, legal equipment, tutorial state and the reviewed bank position. Do not grant invulnerability or special gameplay privileges to the route.
3. Start with empty inventory and stock the bank with all ordinary required supplies, plus declared recovery reserves. The script still deposits all on startup, then withdraws its first loadout.
4. Validate target quest unstarted, all prerequisite state, quantities, equipment eligibility and effective quest points after login.
5. Save the fixture specification, immutable baseline, verification output and versions.

**Items:** generate ordinary inputs. Target-quest keys, transformed objects, rewards and other progression items must be earned at the appropriate scripted step if spawning them would skip that step. An exceptional mid-quest debug fixture is separately labelled and cannot qualify as a full run.

**Prerequisites have two test modes:**

- **Isolated quest mode:** prerequisites are materialized as complete, including necessary auxiliary state, legitimate retained rewards and access flags. This accelerates development of the target quest. Setting only a completion varp is not enough.
- **Chain mode:** prerequisites and the target begin unstarted; stock the ordinary supplies for the whole dependency closure and execute prerequisite scripts in order. This proves the prerequisite workflows and handoffs rather than assuming them. Quest-point requirements may need additional named quests beyond explicit dependencies.

An isolated-quest pass is not a chain pass. Track them independently.

**Save safety:** acquire per-account ownership, confirm no online or ghost entity and drain pending saves. Fail closed when presence cannot be checked. Reconcile the actual database checkpoint authority before touching an existing identity: `PlayerLoading` may prefer the market database over `.sav`. Prefer new identities with no checkpoint row. Never delete unrelated records or use `--force` as the default. Serialize through engine load/save, verify serialized fields independently of the database-preferring loader, then verify the effective login state.

### 3. Build the journal/checkpoint layer before scaling

The current SDK has component-click support, and the lite client publishes journal component text through untyped `interface.debugInfo`. This is a promising implementation path, **not a runtime-verified journal API**. There is no verified generic `getVarp` or `getQuestJournal` method.

First prove journal capture on a pilot, then expose typed component text with raw formatting preserved. Current normalized debug text strips strikethrough; crossed-out and outstanding tasks can otherwise be confused. If a browser watcher replaces the lite client, first establish equivalent journal export there; do not silently change the evidence source.

At each checkpoint the sole driver:

1. Finishes an action at a safe boundary.
2. Reopens the correct quest journal and waits for fresh, populated interface state.
3. Checks the journal identity and a source-derived predicate for the expected stage.
4. Checks supporting evidence where the journal is coarse: item transformation/count, location/plane, dialogue result, trade or combat outcome.
5. Persists an unsampled evidence record and advances only on PASS.

Use `PASS`, `FAIL` and `UNKNOWN`. Missing, stale or ambiguous evidence is UNKNOWN and blocks progression. A successful click, XP gain, log message or file checkpoint is not proof of quest progress. Do not invent a journal transition for a substep that does not change the journal; verify its actual effect and the current quest stage.

Evidence includes run/account/quest/checkpoint IDs; script, content and fixture revisions; tick and state freshness; journal component IDs/raw text; expected predicate; observed inventory/location/dialogue; verdict; attempt and recovery history.

**Concrete regression test:** maxed Herblore with Druidic Ritual unstarted must not be reported as complete. The existing script currently uses Herblore XP >=250 as a completion shortcut.

### 4. Draft and babysit the development run

Write each quest as a state machine with explicit entry conditions, actions, postconditions and recovery transitions. Reuse `ActivitySession`, but keep quest evidence separate from sampled/truncated activity telemetry.

- Route through short verified movement legs; handle doors, stairs, planes and delayed scene updates.
- Use observed dialogue choices and stage state, not blind option indices or fixed sleeps.
- Verify bank availability and inventory quantities at point of use.
- Bound retries by checkpoint-specific limits. No-progress timeouts must produce a diagnostic bundle and an explicit pause/failure, not endless walking or unrelated grinding.
- On restart, infer real progress from the game, reconcile with recorded checkpoints and re-bank when safe. Do not trust a local step counter blindly or return from a dangerous instance merely to satisfy a startup convention.

Agent roles:

- **Parent:** owns queue, shared interfaces, safety, integration and promotion decisions.
- **Quest developer/babysitter:** observes the assigned account through evidence/logs, diagnoses failures, patches its assigned script and reruns.
- **Staging verifier:** independently checks an immutable candidate on a fresh account and reports evidence; it does not patch staging in place.

There is **one SDK controller per player**. The babysitter follows telemetry, not a second SDK login. For interactive diagnosis, stop the original controller and explicitly hand ownership over. A physical follower or browser client is unnecessary.

Trial-and-error fixes must land in code. No target quest-state edits or staff teleports during a qualifying run. Any manual rescue is recorded as an assisted attempt and requires a fresh clean rerun. Add a regression test for the observed failure where feasible. Use disjoint files or separate worktrees for parallel writers; shared framework changes are parent-owned.

### 5. Freeze and stage

A development completion makes a candidate, not a verified script.

Freeze the script and shared dependency revision, fixture and content configuration. Create a **different account from the original pre-quest specification**, never from the completed development save. Run at the intended deployment tick rate with the same normal player actions.

The required first staging pass has no operator rescue, state grants, teleports or code edits. The verifier can observe and collect evidence. If it fails, retain the failure bundle, fix in development and restart staging from a fresh fixture.

Recommended promotion suite:

- One fresh-account end-to-end staging run with every checkpoint validated.
- A second fresh run for repeatability, including small ordinary starting variation where safe.
- Explicit restart/resume tests at meaningful checkpoint boundaries.
- Bounded-failure tests for missing supplies, blocked movement or dropped client/controller; expect safe diagnostics and recovery/failure, not false success.
- Partner-account coverage for cooperative quests and branch-specific coverage where claimed.
- Prerequisite-chain integration tests after dependency scripts are available.

Final evidence must include the correct quest journal's explicit completion, reconciled completion predicate, and applicable unlock/reward/quest-point checks. Maxed XP is not a completion signal. Optional offline post-run save inspection corroborates the result only after clean logout and save-authority reconciliation.

The verified claim is scoped: **maxed, supplied account; tested branch; pinned local content/client/timing**. It does not automatically prove minimum-level accounts, all optional branches, browser-client parity or hosted-server compatibility. Those require separate tests before production use.

## Rollout order and gates

| Phase | Work | Exit condition |
|---|---|---|
| Foundation | Catalogue, safe fixtures, journal reader, evidence records, queue/report | Reproducible starting state; journal distinguishes unstarted/active/completed; stale evidence and XP shortcuts rejected |
| Pilot A | Cook's Assistant, new small script | Clean staging proof of bank → dialogue → journal → completion |
| Pilot B | Druidic Ritual, adapt existing script | Maxed-account regression fixed; travel/planes/item transformation verified |
| Pilot C | Rune Mysteries, quest-only mode | Multi-location deliveries and restart/resume verified |
| Combat pilot | Vampire Slayer | Combat outcome and completion independently verified |
| Catalogue waves | Short independent quests, dependency chains, then complex/cooperative quests | Per-quest staging evidence; unresolved content explicitly blocked |
| Regression/release | Shared-helper regression suite and fleet-compatible review | No local cheats or fixture tooling leak into production scripts |

Begin with one active quest development run. Parallelize read-only catalogue research and bounded script drafting first. Increase gameplay concurrency only after measuring local capacity and shared NPC/resource interference. Do not launch every quest at once.

## Proposed artifacts

These paths are proposed, not implemented by this document:

- `quest-lab/catalog/<quest>.json` — reviewed requirements, dependency and checkpoint manifest.
- `quest-lab/fixtures/<quest>.json` — reproducible setup specification.
- `bots/quests/<quest>.ts` — one reusable script, not a different dev/staging implementation.
- `quest-lab/tests/` — checkpoint predicates, fixtures, recovery and regressions.
- `quest-lab/runs/<run-id>/` — immutable versions, provision evidence, checkpoint JSONL, logs and diagnostic bundles.
- `quest-lab/status.json` — queue, attempt budget, stage, owner and blocker for every quest.
- Engine-package fixture tool under `server/engine/tools/server/`, where engine imports resolve.

The durable queue is authoritative; a conversation or subagent transcript is not. Agent sessions are bounded. If unattended overnight execution is later requested, add a resumable worker/supervisor with account locks, time/token/retry budgets and safe shutdown—not an assumption that one chat delegation runs forever.

## Acceptance for a verified quest

- Source-backed manifest and complete declared prerequisite configuration.
- Target proven unstarted on its fixture.
- Every required checkpoint has fresh PASS evidence.
- Explicit final completion proven independently of script success logging.
- Fresh staging passes on the frozen candidate, with no manual assistance.
- Restart and failure behavior meet the declared test contract.
- Build and relevant automated tests pass; pre-existing baseline failures are reported separately.
- Evidence identifies exact versions and limitations; no production deployment implied.

## Evidence behind this plan

Paths below are relative to `/Users/jackgolding/rs-sdk-offline`:

- `server/content/scripts/general/scripts/quests.rs2:304-381`: canonical quest-list registrations, alternate and computed states. Parent independently counted 68 unique entries and matched their UI sections. The `fortress` entry maps to `quest_blackknight`, not a same-named directory.
- `bots/quests/druidic-ritual.ts:105-112`: concrete XP-based false completion.
- `server/content/scripts/quests/quest_druid/scripts/druid_journal.rs2:6-20`: stage-specific journal with strikethrough and final completion.
- `server/content/scripts/quests/quest_cook/scripts/cook_journal.rs2:4-31`: journal depends on stage and carried ingredients; title differs from the conventional quest name.
- `sdk/index.ts:1335-1337`, `sdk/types.ts:261-265`: component clicks exist; typed interface state lacks journal debug text.
- `server/webclient/src/lite/LiteClient.ts:917-955`, `server/webclient/src/lite/actions.ts:48-53,646-660`: journal debug export and formatting loss.
- `server/engine/src/engine/entity/PlayerLoading.ts:31-37`: database checkpoint precedence.
- `server/engine/tools/server/quest-set.ts:38-60,67-90`: existing CLI's presence/default-port and loader-verification limitations.
- `sdk/test/utils/save-generator.ts:22-24,155-168,244-255`: legacy custom binary fixture writer, not a safe turnkey materializer.
- `server/content/scripts/quests/quest_hero/scripts/quest_hero.rs2:1-7`: prerequisite and quest-point gate.

Remaining uncertainties: actual runtime journal freshness/export fidelity; full per-quest prerequisite/item manifests; end-to-end playability of all catalogue entries; and total engineering effort. Estimate throughput after the pilot wave, not from the quest count alone.
