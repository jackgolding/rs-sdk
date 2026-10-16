# Jev on the VPS fleet — recon (research/jev-fleet)

Question: the local `jev-watcher` gives Rick/Morty sub-second god-reflexes for live
players. What, if anything, should Jev do for the 48-bot Hetzner fleet, where there
are no live players to impress?

## 1. What the fleet looks like today (infra/vps-pilot tip)

- Box: `fleet-pilot-1` (Hetzner, Singapore). Server paths `/srv/fleet/repo` (git,
  branch `infra/vps-pilot`) + `/srv/fleet/bots` (rsynced, gitignored `bot.env`).
- Runtime: `infra/pilot/compose.fleet.yml`, GENERATED from `bots/roster.json` via
  `gen-compose.py` — never edit by hand. Per bot: `lite-<bot>` (headless client)
  + `quest-<bot>` (task script), one shared image, `restart: unless-stopped`,
  700s quest drain. 48 bots ≈ 96 containers when fully migrated (1 migrated today).
- Game + gateway are REMOTE: `SERVER=rs-sdk-demo.fly.dev` in `bot.env`, no
  `GATEWAY_URL` override, so every container derives `ws://rs-sdk-demo.fly.dev:7780`
  (`sdk/index.ts:deriveGatewayUrl`, `lite/runner.ts:469`). No local engine/gateway
  on the box. A Jev service on the VPS would call out to the same remote gateway
  over HTTP — no new game clients, no controller pre-emption (same rule as local:
  HTTP only, never a second SDK controller on a live account).
- Supervision today: VPS shepherd (crash-loop caps, docker-blind verdicts) +
  `fleet-shepherd.timer`, fleet-desk on the Mac, and the `fleet-outage-recovery`
  triage buckets (restartable / logged_out / no_controller / no_effect / churning).
- Secrets travel over SSH (rsync + `chmod 600`), never through git or Actions.
  `bot.env` is gitignored by design; API keys must follow the same road.
- Deploy: `.github/workflows/fleet-pilot-deploy.yml` fires ONLY on push to
  `infra/vps-pilot` with touched paths under `bots/quests/**`, `sdk/**`,
  `server/webclient/**`, `infra/pilot/**`. Research branches are deploy-safe.

## 2. Candidate jobs for Jev on the fleet (ranked)

1. **Stuck/churn triage.** Today this is regex + shepherd verdicts + human buckets.
   Jev-shaped: state = `{bot, quest, last-N grind.log lines, gateway status}` →
   parallel `choice` (restartable / needs-relogin / needs-restat / escalate-human),
   `score` urgency, `noul` safe-to-restart-now. High volume, repeated, low-latency
   judgments — exactly the "System One" pitch. This is the job to spike first.
2. **Task routing.** Which quest a freed bot should take next given levels/stock.
   Lower frequency (on quest completion, not per-second); a cron + LLM works today.
   Jev only if routing ever needs to be instant (it doesn't).
3. **God-reflexes (local jev-watcher port).** No live players on the fleet → no job.
   Do NOT port the watcher; its `give/tele/bring` actions assume a human audience.
4. **Chat moderation / PM handling on fleet accounts.** Only if fleet accounts start
   talking to strangers. Parked.

## 3. API route: native vs OpenRouter

- **Native** (`POST api.typesafe.ai/v1/systemone`, `JEV_API_KEY`): `state` + typed
  `questions` in one round trip, calibrated `choice/score/noul` answers,
  ~70–500ms, $0.042/M input tokens, output free. Best fit for triage-at-scale.
- **OpenRouter** (`typesafe/jev-router`, `OPENROUTER_API_KEY` — verified present in
  the 462-model catalog 2026-10-15; no raw `jev-latest` listed): chat-shaped,
  router picks backend per request. No new account, but chat latency (seconds) and
  per-routed-model pricing instead of flat Jev pricing. Fine for the local watcher
  fallback; wrong shape for 48-bot high-frequency triage.
- Recommendation: native for the fleet spike; OpenRouter stays the local fallback.

## 4. Rough cost math (triage job, native pricing)

Assumptions: 48 bots, triage sweep every 60s, ~2k input tokens per bot-state
(grind tail + status), 3 questions per call, batchable per call.
- 48 × 24 × 60 = 69k calls/day ≈ 138M input tokens/day ≈ **$5.80/day** unbatched.
- Batched (one call, 48 states as array + shared questions): ~1.4k calls/day ≈
  **<$0.50/day**. Batching is the whole ballgame — Jev evaluates all questions in
  parallel per call, so design one call per sweep, not one per bot.
- vs outage cost: one mass-churn night burns more in Hetzner + human time. Shadow
  mode first (log verdicts, act on nothing) to prove precision before spending.

## 5. Proposed shape (spike, not build)

- `infra/pilot/jev-triage/` — one service, added to `gen-compose.py` output as a
  singleton (not per-bot): `command: ["bun", "infra/pilot/jev-triage/sweep.ts"]`.
- Inputs: gateway status per bot (remote HTTP, read-only) + `grind.log` tails from
  the shared `/srv/fleet/bots` mount (already mounted in every container).
- Secrets: `/srv/fleet/secrets/jev.env` (`chmod 600`, rsynced like `bot.env`,
  mounted read-only into the triage container). NEVER in git/Actions/compose.
- Output phase 1: append verdicts to a log + fleet-desk readable file. NO restarts,
  NO `docker` control. Graduate to shepherd signals only after shadow precision.
- Hard rules carried over from local: HTTP reads only; never open SDK controllers
  on fleet accounts; never touch engine/gateway processes (not ours — hosted demo).

## 6. Open questions

1. Can the VPS reach the demo gateway HTTP endpoints for all 48 bots, or only for
   locally-registered clients? (Local watcher polls `localhost:7780`; on the box
   the gateway is remote — verify `/chat/<bot>` + `/status/<bot>` visibility.)
2. Grind-log vs gateway as primary signal — which degrades more gracefully when
   the demo host is flaky?
3. Who consumes verdicts: shepherd (container ops) vs fleet-desk (human review)?
4. `composer` scale: does one sweep fit Jev's 8k-char state limit, or split by squad?
5. Migration interplay: code freeze discipline — spike only after current migrations
   settle; single-bot shadow on ABGARMY18 first.

## 7. Next steps

- [ ] Answer Q1 with a one-off curl from the box (no code, 5 min).
- [ ] Shadow-mode `sweep.ts` spike behind a squad flag; compare verdicts vs shepherd
      for one week.
- [ ] Get `JEV_API_KEY` (console.typesafe.ai) → `/srv/fleet/secrets/jev.env` via SSH.
- [ ] Decide native-vs-router on measured latency, then propose the real build.
