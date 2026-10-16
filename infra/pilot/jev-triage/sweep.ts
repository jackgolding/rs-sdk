#!/usr/bin/env bun
/**
 * Shadow-mode fleet triage sweep (research spike — NOT prod).
 *
 * Reads per-bot state (gateway /status + grind.log tail + shepherd state),
 * emits Jev-shaped verdicts, acts on NOTHING. Phase 1 output is a JSONL log
 * for precision comparison against shepherd verdicts.
 *
 *   bun infra/pilot/jev-triage/sweep.ts --squad ABGARMY18,Jackpoo5 [--live]
 *
 * --dry (default): heuristic verdicts in the Jev schema, zero API calls.
 * --live: one batched native System One call per sweep (model jev-latest).
 *   Requires JEV_API_KEY env. Falls back to dry on any API failure — the
 *   sweep never blocks, same rule as the local tick spike.
 *
 * Hard rules: HTTP reads only. Never opens SDK controllers on fleet
 * accounts. Never touches engine/gateway processes (hosted demo, not ours).
 */

import { execSync } from "node:child_process";

const BOX = "root@5.223.71.192";
const GATEWAY = "https://rs-sdk-demo.fly.dev";
const RESTART_CAP = 4; // per hour, same as shepherd
const GRIND_STALE_S = 15 * 60;

type Choice =
  | "healthy"
  | "restartable"
  | "needs-relogin"
  | "needs-restat"
  | "escalate-human";
type Urgency = "ignore" | "routine" | "now" | "critical";

interface Verdict {
  bot: string;
  ts: string;
  mode: "dry" | "live";
  choice: Choice;
  confidence: number;
  urgency: Urgency;
  safe_to_restart: boolean;
  reasons: string[];
  gateway: { status: string; inGame: boolean; controllers: number; stateAge: number | null };
  grind: { ageS: number | null; tail: string[] };
  shepherd: { restartsLastHour: number; skipped: boolean };
}

function ssh(cmd: string): string {
  return execSync(`ssh -o BatchMode=yes -o ConnectTimeout=10 ${BOX} ${JSON.stringify(cmd)}`, {
    encoding: "utf-8",
    timeout: 30000,
  });
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : def;
}

const live = process.argv.includes("--live") || process.argv.includes("--live-router");
const useRouter = process.argv.includes("--live-router");
const squadRaw = arg("--squad", "ABGARMY18")!;
const squad = squadRaw.split(",").map((s) => s.trim()).filter(Boolean);

// Canonical roster names (case-insensitive match for squad input).
const roster: { bots: { name: string }[] } = JSON.parse(
  execSync("cat bots/roster.json", { encoding: "utf-8", cwd: import.meta.dir + "/../../.." }),
);
const names = squad.map((s) => roster.bots.find((b) => b.name.toLowerCase() === s.toLowerCase())?.name ?? s);

// Shepherd state + skip list, fetched once per sweep.
const shepherdState: { bots?: Record<string, { restarts?: number[] }> } = JSON.parse(
  ssh("cat /srv/fleet/state/shepherd-state.json"),
);
const skipList = ssh("cat /srv/fleet/state/skip-bots.txt 2>/dev/null || true")
  .split("\n")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const nowS = Math.floor(Date.now() / 1000);

async function botState(bot: string) {
  const gw = await fetch(`${GATEWAY}/status/${encodeURIComponent(bot)}`, {
    signal: AbortSignal.timeout(15000),
  })
    .then((r) => r.json() as Promise<Record<string, unknown>>)
    .catch(() => null);
  let grindAge: number | null = null;
  let tail: string[] = [];
  try {
    const out = ssh(
      `L=/srv/fleet/bots/${bot}/grind.log; stat -c %Y "$L" 2>/dev/null; echo ---; tail -5 "$L" 2>/dev/null | cut -c1-160`,
    );
    const [mtimeRaw, ...rest] = out.split("\n");
    const mtime = parseInt(mtimeRaw.trim(), 10);
    if (Number.isFinite(mtime)) grindAge = nowS - mtime;
    tail = rest.slice(1).filter((l) => l.trim());
  } catch { /* unreadable log = signal in itself */ }
  const restarts = shepherdState.bots?.[bot]?.restarts ?? [];
  return { gw, grindAge, tail };
}

function dryVerdict(
  bot: string,
  s: Awaited<ReturnType<typeof botState>>,
  skipped: boolean,
  restartsLastHour: number,
): Verdict {
  const reasons: string[] = [];
  const gw = {
    status: String(s.gw?.status ?? "unknown"),
    inGame: s.gw?.inGame === true,
    controllers: Array.isArray(s.gw?.controllers) ? (s.gw.controllers as unknown[]).length : 0,
    stateAge: typeof s.gw?.stateAge === "number" ? (s.gw.stateAge as number) : null,
  };
  const base = {
    bot, ts: new Date().toISOString(), mode: "dry" as const, gateway: gw,
    grind: { ageS: s.grindAge, tail: s.tail },
    shepherd: { restartsLastHour, skipped },
  };
  if (skipped) {
    return { ...base, choice: "escalate-human", confidence: 0.9, urgency: "routine", safe_to_restart: false, reasons: ["on human skip list"] };
  }
  if (restartsLastHour >= RESTART_CAP) {
    reasons.push(`${restartsLastHour} restarts in the last hour (cap ${RESTART_CAP}) — leave for next hour`);
    return { ...base, choice: "escalate-human", confidence: 0.9, urgency: "routine", safe_to_restart: false, reasons };
  }
  if (!s.gw) {
    reasons.push("gateway /status unreachable from sweep host");
    return { ...base, choice: "escalate-human", confidence: 0.5, urgency: "now", safe_to_restart: false, reasons };
  }
  if (!gw.inGame) {
    reasons.push(`gateway reports status=${gw.status}, inGame=false`);
    if (s.grindAge != null) reasons.push(`grind.log age ${Math.round(s.grindAge / 60)}m`);
    return { ...base, choice: "needs-relogin", confidence: 0.8, urgency: "now", safe_to_restart: false, reasons };
  }
  if (gw.controllers === 0) {
    reasons.push("in-game with no controller attached (restartable)");
    return { ...base, choice: "restartable", confidence: 0.75, urgency: "now", safe_to_restart: true, reasons };
  }
  if (s.grindAge != null && s.grindAge > GRIND_STALE_S) {
    reasons.push(`controller attached but grind.log stale ${Math.round(s.grindAge / 60)}m (no_effect?)`);
    return { ...base, choice: "needs-restat", confidence: 0.6, urgency: "routine", safe_to_restart: true, reasons };
  }
  reasons.push(`inGame, ${gw.controllers} controller(s), grind fresh`);
  return { ...base, choice: "healthy", confidence: 0.85, urgency: "ignore", safe_to_restart: false, reasons };
}

async function routerVerdicts(
  bots: { bot: string; s: Awaited<ReturnType<typeof botState>> }[],
): Promise<Verdict[] | null> {
  // OpenRouter fallback: chat-shaped typesafe/jev-router, one call per sweep.
  // Key read at runtime from env (source ~/.zshrc before running) — never in
  // chat, logs, git, or compose.
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error("live-router requested but OPENROUTER_API_KEY is unset — falling back to dry.");
    return null;
  }
  const lines = bots.map(({ bot, s }) => {
    const gw = s.gw as Record<string, unknown> | null;
    return `- ${bot}: status=${gw?.status ?? "unknown"} inGame=${gw?.inGame === true} controllers=${Array.isArray(gw?.controllers) ? (gw.controllers as unknown[]).length : 0} grindAgeS=${s.grindAge ?? "unknown"} tail=${JSON.stringify(s.tail.slice(-2))}`;
  });
  const sys =
    "You triage Runescape fleet bots. Reply with ONE line of JSON: an array with one object per bot, in order: " +
    '{"choice":"healthy|restartable|needs-relogin|needs-restat|escalate-human","urgency":"ignore|routine|now|critical","safe":true|false,"conf":0-1}. ' +
    "healthy=producing leave alone. restartable=in-game no controller, safe to restart. needs-relogin=session dead. " +
    "needs-restat=controller attached but stale log. escalate-human=capped, skipped, or unclear, never restart. No other text.";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "typesafe/jev-router",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Triage these bots:\n${lines.join("\n")}` },
        ],
        temperature: 0,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)) as {
      choice?: Choice; urgency?: Urgency; safe?: boolean; conf?: number;
    }[];
    if (!Array.isArray(arr) || arr.length !== bots.length) throw new Error("short/malformed verdict array");
    return bots.map(({ bot, s }, i) => ({
      ...dryVerdict(bot, s, false, 0),
      mode: "live" as const,
      choice: arr[i].choice ?? "escalate-human",
      urgency: arr[i].urgency ?? "routine",
      safe_to_restart: arr[i].safe ?? false,
      confidence: arr[i].conf ?? 0.7,
      reasons: ["openrouter typesafe/jev-router verdict"],
    }));
  } catch (e) {
    console.error(`router call failed (${e}) — falling back to dry.`);
    return null;
  }
}

async function liveVerdicts(
  bots: { bot: string; s: Awaited<ReturnType<typeof botState>> }[],
): Promise<Verdict[] | null> {
  const key = process.env.JEV_API_KEY;
  if (!key) {
    console.error("live requested but JEV_API_KEY is unset — falling back to dry.");
    return null;
  }
  const body = {
    model: "jev-latest",
    state: bots.map(({ bot, s }) => ({ bot, gateway: s.gw, grindAgeS: s.grindAge, tail: s.tail })),
    questions: [
      { type: "choice", instructions: "Triage this fleet bot.", criteria: { healthy: "producing, leave alone", restartable: "in-game, no controller — safe to restart", "needs-relogin": "session dead — needs client restart", "needs-restat": "controller attached but no effects — restat quest", "escalate-human": "capped, skipped, or unclear — do not touch" } },
      { type: "score", instructions: "How urgent?", criteria: ["ignore", "routine", "now", "critical"] },
      { type: "noul", instructions: "Is it safe to restart this bot right now?" },
    ],
  };
  try {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { answers?: { choice?: Choice; score?: Urgency; noul?: boolean; confidence?: number }[] };
    return bots.map(({ bot, s }, i) => {
      const a = data.answers?.[i];
      if (!a?.choice) throw new Error("short answer array");
      return {
        ...dryVerdict(bot, s, false, 0),
        mode: "live" as const,
        choice: a.choice,
        urgency: a.score ?? "routine",
        safe_to_restart: a.noul ?? false,
        confidence: a.confidence ?? 0.7,
        reasons: ["native System One verdict"],
      };
    });
  } catch (e) {
    console.error(`live call failed (${e}) — falling back to dry.`);
    return null;
  }
}

// --- sweep ---
const collected = [];
for (const bot of names) {
  collected.push({ bot, s: await botState(bot) });
}
let verdicts: Verdict[];
if (live) {
  const lv = useRouter ? await routerVerdicts(collected) : await liveVerdicts(collected);
  if (lv) {
    verdicts = lv;
  } else {
    verdicts = collected.map(({ bot, s }) =>
      dryVerdict(bot, s, skipList.includes(bot.toLowerCase()), (shepherdState.bots?.[bot]?.restarts ?? []).filter((t) => nowS - t < 3600).length),
    );
    for (const v of verdicts) v.mode = "dry";
  }
} else {
  verdicts = collected.map(({ bot, s }) =>
    dryVerdict(bot, s, skipList.includes(bot.toLowerCase()), (shepherdState.bots?.[bot]?.restarts ?? []).filter((t) => nowS - t < 3600).length),
  );
}

const logLine = verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n";
await Bun.write(import.meta.dir + "/shadow.log", logLine, { createPath: false }).catch(async () => {
  const f = Bun.file(import.meta.dir + "/shadow.log");
  const prev = await f.exists() ? await f.text() : "";
  await Bun.write(import.meta.dir + "/shadow.log", prev + logLine);
});

for (const v of verdicts) {
  console.log(`${v.bot}: ${v.choice} (conf ${v.confidence}, ${v.urgency}, safe=${v.safe_to_restart}) [${v.mode}]`);
  for (const r of v.reasons) console.log(`    - ${r}`);
}
console.log(`\nAPI cost this sweep: ${verdicts[0]?.mode === "live" ? "1 batched call" : "$0.00 (dry)"}`);
