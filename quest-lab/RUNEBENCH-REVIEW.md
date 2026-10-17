# RuneBench review — what the quest pipeline can reuse

Reviewed at commit `3e5ad08fc8` (pushed 2026-10-13), cloned read-only to
`~/.hermes/cache/scratch/runebench-research`. No RuneBench code is vendored
into `rs-sdk-offline`.

## What it is

A benchmark suite for evaluating AI coding agents on RuneScape tasks, built on
rs-sdk and the LostCity engine, orchestrated with Harbor. Agents write and run
TypeScript against an emulated server at 8x speed, with wiki markdown supplied
as reference. Scoring is peak XP rate, or peak coins for the gold tasks.[1][2]

Running `bun generate-tasks.ts` myself produced **41 tasks**: 32 skill-XP
(16 skills × 15m/30m), 8 gold, 1 smoke. There are **no quest tasks**.[2]

## Directly reusable

**1. Observe-mode telemetry (strongest match).**
`shared/skill_tracker.ts` connects with `connectionMode: 'observe'`, samples
state on an interval, and writes JSON. Our gateway already supports this:
"Multiple 'observe' mode clients can coexist freely… One controller and
multiple observers can coexist", and observers may send only `say` /
`privateMessage`.[4]

This corrects an assumption in my earlier plan. I had said the babysitter must
work from log files because a second SDK connection would pre-empt the driver.
That is only true for `control` mode — a **passive observer never pre-empts the
driver**. The babysitter can watch live state while the quest script keeps the
single control slot. The tracker's own patterns are also worth copying: reconnect
retry loop, resume-from-existing-output-file, PID lock file so two trackers
cannot double-write, and a final sample on SIGTERM.[4]

**2. Verifying the outcome from outside the agent process.**
`shared/check_gold.ts` reads the player save from disk rather than asking the
agent, and scores `max(peak sample, final save read)` so a late death does not
erase earlier success.[8] This is the same principle our checkpoint gate uses:
the script's own "completed" log line is not evidence.

**3. Bounded continuation loops.**
`agents/opencode_adapter.py` runs the agent under a total time budget with a
restart loop: it refuses to restart with less than 180s remaining, tracks
consecutive sub-10s fast failures and aborts after 3, and on restart feeds
"you stopped early, there is still time, check current state and CONTINUE — do
not write a summary".[5] That is exactly the shape needed for a resumable
quest-development worker, and the "continue, don't summarize" wording is the
part most worth stealing.

**4. Trajectory extraction for diagnosis.**
`shared/trajectory.ts` normalises Claude Code / Codex / Gemini / OpenCode logs
into one `TrajectoryStep[]` shape and truncates large writes to 25 lines /
2000 chars for display.[7] Useful for the "diagnostic bundle" a stuck quest run
should leave behind, and for building a per-quest run report.

**5. Isolation and tamper boundaries (only if we ever run agents unattended).**
The container image keeps engine, saves, SDK, tracker and verifier root-owned
while the agent runs as an unprivileged `agent` user, with build-time assertions
that the agent genuinely cannot write `/app/server`, `/app/sdk` or
`/app/benchmark`.[3] It also documents prior tampering: agents hand-edited
`skill_tracking.json`, restarted the tracker at 1s cadence, overwrote
`agent.sav` via the SDK save-generator, and edited engine `.env`.[3] The
harness then defends specifically — verifiers call `ensure-services.sh`, which
deletes `save-generator.ts` and only trusts a root-owned tracker lock.[9]

## Not reusable

**Their save fixtures.** The four gold `.sav` files are opaque committed
binaries, and I confirmed they are **`SAV_VERSION` 6** (magic `0x2004`), while
the engine in `~/rs-sdk-offline` is **`SAV_VERSION` 8**
(`server/engine/src/engine/entity/PlayerLoading.ts:14`). Their own repo already
flags this as a problem: a proposal in the tree argues those blobs "cannot tell
from the repo what a condition grants" and should be replaced by declarative
`saveConfig` blocks — but that is a **proposal, not shipped code**, and it
points at the same `save-generator.ts` we already assessed as unsuitable
(legacy v6, hardcoded varp range and bank capacity, no presence/checkpoint
guards).[6]

**Quest-specific logic.** RuneBench has no quest tasks, no quest-journal
checkpoints, no prerequisite fixtures, and no clean-account staging rerun. Its
verifiers assert scalar outcomes (XP per window, coins in inventory + bank).
The 68-quest catalogue, prerequisite closure, checkpoint evidence gate and
promotion workflow remain ours to build.

**The Docker/Harbor/MCP stack.** Adopting it means a new heavyweight runtime
(Docker image per task, Harbor, Modal sandboxes, per-model adapters). Our local
engine + gateway + lite runner already gives a faster loop, and the plan's
"prove it locally, then stage" shape does not need remote sandboxes.

## Licence — check before copying code

The README ends with a `## License / MIT` section[1], but
`gh repo view MaxBittker/RuneBench --json licenseInfo` returns **`null`** — there
is no `LICENSE` file in the tree at `3e5ad08fc8`. Treat it as unlicensed until
confirmed with the author; do not copy source verbatim. Patterns, interfaces and
protocols (observe mode, "verify from outside", bounded continuation) are safe to
reimplement from scratch.

## Recommendation

1. **Adopt now:** observe-mode babysitting instead of log-only observation.
2. **Adopt now:** the "verify the outcome outside the agent, count the peak not
   the final state" discipline, which matches our promotion gate.
3. **Adopt now:** the bounded continuation loop's wording and fast-fail abort for
   the quest development worker.
4. **Adopt later:** the root/non-root tamper boundary, only if unattended runs
   become a thing.
5. **Skip:** their save fixtures, Verifier-as-script, and the Docker/Harbor stack.

## Sources

[1] https://github.com/MaxBittker/RuneBench — RuneBench
[2] https://github.com/MaxBittker/runebench/blob/3e5ad08fc8ef3379e55e7262bb7ced14ddd1e5a8/generate-tasks.ts — Task generation and Harbor contract
[3] https://github.com/MaxBittker/runebench/blob/3e5ad08fc8ef3379e55e7262bb7ced14ddd1e5a8/docker/Dockerfile — Container build and permission boundaries
[4] https://github.com/MaxBittker/runebench/blob/3e5ad08fc8ef3379e55e7262bb7ced14ddd1e5a8/shared/skill_tracker.ts — Observe-mode telemetry tracker
[5] https://github.com/MaxBittker/runebench/blob/3e5ad08fc8ef3379e55e7262bb7ced14ddd1e5a8/agents/opencode_adapter.py — Bounded agent continuation and trajectory adapter
[6] https://github.com/MaxBittker/runebench/blob/3e5ad08fc8ef3379e55e7262bb7ced14ddd1e5a8/PROPOSAL-backport-from-vendor.md — Proposed declarative fixtures, not yet shipped
[7] https://github.com/MaxBittker/runebench/blob/3e5ad08fc8ef3379e55e7262bb7ced14ddd1e5a8/shared/trajectory.ts — Trajectory extraction and truncation
[8] https://github.com/MaxBittker/runebench/blob/3e5ad08fc8ef3379e55e7262bb7ced14ddd1e5a8/shared/check_gold.ts — Gold verifier and save reader
[9] https://github.com/MaxBittker/runebench/blob/3e5ad08fc8ef3379e55e7262bb7ced14ddd1e5a8/docker/entrypoint.sh — Container lifecycle and watchdog
