#!/usr/bin/env bun
/**
 * jev-walk (OFFLINE ONLY — ~/rs-sdk-offline).
 * Jev walks jacklove5 from the road to the red-dragon isle gate, live.
 * Code owns feet (hop-steps need no collision data); Jev owns judgment
 * (march vs hold, eat vs wait, how soon to ask again).
 *
 * Usage (source ~/.zshrc first for OPENROUTER_API_KEY):
 *   bun tools/jev-dragons/jev-walk.ts jacklove5 --poll-every=6 [--dry]
 *
 * ONE-CONTROLLER RULE: kill that bot's quest script first. The game client
 * (lite or Chrome tab) stays logged in — only the controller swaps.
 */
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';

const NATIVE_URL = process.env.TYPESAFE_URL || 'https://api.typesafe.ai/v1/systemone';
const OR_URL = 'https://openrouter.ai/api/v1/systemone';
const OR_MODEL = 'typesafe/jev-1.14';
const TICK_MS = 400;
const CAMP = { x: 3200, z: 3834 };
// Road (Falador side) -> ditch -> north through wildy -> isle gate (SAFE END, outside).
const ROUTE = [
  { x: 3000, z: 3480 }, { x: 3040, z: 3505 }, { x: 3088, z: 3518 },
  { x: 3088, z: 3525 },
  { x: 3102, z: 3610 }, { x: 3110, z: 3700 }, { x: 3124, z: 3851 },
  { x: 3202, z: 3862 },
];

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (const a of argv) {
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); flags.set(k, v ?? 'true'); }
  else positional.push(a);
}
const botArg = positional[0];
if (!botArg) { console.error('usage: jev-walk.ts <botname> [--poll-every=6] [--dry]'); process.exit(1); }
const pollEvery = Math.max(1, parseInt(flags.get('poll-every') ?? '6', 10) || 6);

function loadKey(): string {
  if (process.env.JEV_API_KEY) return process.env.JEV_API_KEY;
  const p = join(process.env.HOME ?? '', '.config', 'jev', 'jev.env');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const t = line.trim(); if (!t || t.startsWith('#')) continue;
      const m = t.match(/^(?:JEV_API_KEY|TYPESAFE_API_KEY)\s*=\s*(.+)$/);
      if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
      if (/^sk-/.test(t) || /^[A-Za-z0-9_\-]{20,}$/.test(t)) return t;
    }
  }
  return '';
}
const apiKey = loadKey();
const orKey = process.env.OPENROUTER_API_KEY || '';
const backend = apiKey ? 'native' : orKey ? 'openrouter' : 'none';
const JEV_URL = backend === 'openrouter' ? OR_URL : NATIVE_URL;
const JEV_MODEL = backend === 'openrouter' ? OR_MODEL : 'jev-latest';
const JEV_KEY = backend === 'openrouter' ? orKey : apiKey;
const dry = flags.get('dry') === 'true' || backend === 'none';

function loadBotEnv() {
  const p = join(process.cwd(), 'bots', botArg, 'bot.env');
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
  }
}
loadBotEnv();
const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const gatewayUrl = process.env.GATEWAY_URL || deriveGatewayUrl(process.env.SERVER || undefined);
console.log(`[jev-walk] ${username} gw=${gatewayUrl} pollEvery=${pollEvery} backend=${backend} model=${JEV_MODEL} ${dry ? 'SHADOW' : 'LIVE Jev'}`);

const sdk = new BotSDK({ botUsername: username, password, gatewayUrl, connectionMode: 'control', autoLaunchBrowser: false, autoReconnect: true, showChat: false });
await sdk.connect();
await sdk.waitForCondition((s: any) => s.inGame && !!s.player, 90_000);
const bot = new BotActions(sdk);

const logPath = join(process.cwd(), 'bots', botArg, 'jev-spike.log');
const jevLog = join(process.cwd(), 'bots', botArg, 'jev-calls.jsonl');
const log = (m: string) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); try { appendFileSync(logPath, l + '\n'); } catch {} };

function pos() {
  const p: any = sdk.getState()?.player;
  return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, hp: p?.hp ?? 0, maxHp: p?.maxHp ?? 0, dead: !!p?.isDead, combat: !!p?.combat?.inCombat };
}
function foodCount() { try { return sdk.getInventory().filter((i: any) => /shark|swordfish|tuna|lobster/i.test(i.name) && (i.count ?? 0) > 0).reduce((n: number, i: any) => n + (i.count ?? 1), 0); } catch { return 0; } }

let lastHp = -1, dmg10: Array<{ t: number; n: number }> = [];
let nextPollIn = pollEvery, navIdx = 0, arrived = false, stuckPolls = 0, lastPX = -1, lastPZ = -1;

function snap() {
  const p = pos(); const now = Date.now();
  if (lastHp >= 0 && !p.dead && p.hp < lastHp) dmg10.push({ t: now, n: lastHp - p.hp });
  lastHp = p.dead ? -1 : p.hp;
  dmg10 = dmg10.filter(d => now - d.t <= 10_000);
  const wp = ROUTE[Math.min(navIdx, ROUTE.length - 1)]!;
  return {
    pos: [p.x, p.z], hp: `${p.hp}/${p.maxHp}`, dmg_last_10s: dmg10.reduce((a, d) => a + d.n, 0),
    food: foodCount(), camp_m: Math.round(Math.hypot(p.x - CAMP.x, p.z - CAMP.z)),
    waypoint_n: `${Math.min(navIdx + 1, ROUTE.length)}/${ROUTE.length}`, waypoint_m: Math.round(Math.hypot(p.x - wp.x, p.z - wp.z)),
    in_combat: p.combat,
  };
}

// One hop-step toward (x,z): no collision data needed. Returns true if arrived.
async function hopStep(x: number, z: number): Promise<boolean> {
  const p = pos();
  if (p.dead) return false;
  const d = Math.hypot(p.x - x, p.z - z);
  if (d <= 3) return true;
  if (p.hp > 0 && p.hp <= 50) await doEat();
  const step = Math.min(10, Math.max(1, d));
  const tx = Math.round(p.x + ((x - p.x) / d) * step);
  const tz = Math.round(p.z + ((z - p.z) / d) * step);
  const sx = p.x, sz = p.z;
  try { await (bot as any).dismissBlockingUI(); } catch {}
  const wr: any = await sdk.sendWalk(tx, tz, true).catch((e: any) => ({ success: false, message: String(e).slice(0, 80) }));
  if (wr && wr.success === false) { log(`walk REJECTED (${tx},${tz}): ${wr.message ?? 'no reason'}`); return false; }
  await sdk.waitForCondition((s: any) => {
    if (s.player?.isDead) return true;
    const px = s.player?.worldX ?? 0, pz = s.player?.worldZ ?? 0;
    return Math.hypot(px - tx, pz - tz) <= 3 || Math.hypot(px - x, pz - z) <= 3;
  }, 8_000).catch(() => {});
  const q = pos();
  if (q.x === sx && q.z === sz) { // didn't move: sidestep nudge
    await sdk.sendWalk(sx + 2, sz + 1, true).catch(() => {});
    await sdk.waitForTicks(2).catch(() => {});
    return false;
  }
  return Math.hypot(q.x - x, q.z - z) <= 4;
}

async function openGateNear(x: number, z: number) {
  await sdk.scanNearbyLocs(14).catch(() => {});
  const gates = ((sdk.getNearbyLocs() ?? []) as any[]).filter(
    l => /gate/i.test(l.name) && Math.hypot(l.x - x, l.z - z) <= 6 &&
      (l.optionsWithIndex ?? []).some((o: any) => /^open$/i.test(o.text)));
  for (const gate of gates) {
    const open = gate.optionsWithIndex.find((o: any) => /^open$/i.test(o.text));
    if (!open) continue;
    await sdk.sendInteractLoc(gate.x, gate.z, gate.id, open.opIndex).catch(() => {});
    await sdk.waitForTicks(2).catch(() => {});
  }
}

async function doEat(): Promise<void> {
  const foods = sdk.getInventory().filter((i: any) => /shark|swordfish|tuna|lobster/i.test(i.name) && (i.count ?? 0) > 0);
  if (!foods.length) return;
  const r: any = await (bot as any).eatFood(foods[0]).catch(() => null);
  if (r?.success) log(`eat_food: ${foods[0].name} +${r.hpGained}`);
}

async function askJev(state: unknown, cands: Record<string, string>) {
  const questions = {
    next_action: {
      type: 'choice',
      instructions: {
        question: 'The bot is walking to the red dragon isle. What should it do for the next seconds?',
        focus: ['Keep moving while healthy and fed; the score is reaching the gate.', 'Hold still if hurt or something needs attention; walking while dying is stupid.', 'Only retreat if there is no food left.'],
      }, criteria: cands,
    },
    this_tick: {
      type: 'choice',
      instructions: {
        question: 'Anything to do right now without changing the plan?',
        focus: ['do_nothing is normal while walking.', 'eat_food when hitpoints are low.', 'restart_current when the walk has gone quiet (re-step).', 'close_dialog when a window is open.'],
      },
      criteria: { do_nothing: 'keep going', eat_food: 'eat one food now', restart_current: 're-step toward the waypoint', close_dialog: 'close open dialog' },
    },
    poll_again_in_ticks: {
      type: 'choice',
      instructions: {
        question: 'Ticks before asking again?',
        focus: ['Soon when the situation may change (near the gate, hurt); longer gaps while steadily walking.'],
      },
      criteria: Object.fromEntries([...new Set([pollEvery, pollEvery * 2, 5, 10].filter(n => n >= pollEvery && n <= 10))].map(n => [String(n), `in ${n} ticks`])),
    },
  };
  const res = await fetch(JEV_URL, { method: 'POST', headers: { Authorization: `Bearer ${JEV_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ state, model: JEV_MODEL, questions }), signal: AbortSignal.timeout(Math.max(8000, pollEvery * TICK_MS)) });
  if (!res.ok) throw new Error(`${backend} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  try { appendFileSync(jevLog, JSON.stringify({ ts: new Date().toISOString(), state, response: data }) + '\n'); } catch {}
  return data.answers;
}

let tick = 0;
log('jev-walk running. Every poll asks Jev; every march decision takes one hop-step.');
while (true) {
  await new Promise(r => setTimeout(r, TICK_MS));
  if (++tick % nextPollIn !== 0) continue;
  const st = snap();
  if (st.pos[0] !== lastPX || st.pos[1] !== lastPZ) { stuckPolls = 0; lastPX = st.pos[0]; lastPZ = st.pos[1]; }
  else stuckPolls++;

  const atGate = st.camp_m <= 30;
  const cands: Record<string, string> = atGate
    ? { hold_stack: 'wait at the gate; the dragons are visible over the fence' }
    : { march_north: `advance to waypoint ${st.waypoint_n} (${st.waypoint_m}m away)`, hold_position: 'stand still' };
  if (st.food === 0) cands.retreat_bank = 'no food left: turn back';
  if (dry) { log(`shadow poll pos=${st.pos} camp=${st.camp_m}m wp=${st.waypoint_n} cands=[${Object.keys(cands)}]`); continue; }

  try {
    const a = await askJev({ bot: username, goal: 'reach the red dragon isle gate', stuck_polls: stuckPolls, ...st }, cands);
    const next = a.next_action?.choice ?? 'march_north';
    const fix = a.this_tick?.choice ?? 'do_nothing';
    nextPollIn = parseInt(a.poll_again_in_ticks?.choice ?? String(pollEvery), 10) || pollEvery;
    const probs = a.next_action?.probabilities ?? {};
    const top = Object.entries(probs).sort((x: any, y: any) => y[1] - x[1]).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(' ');
    if (atGate && !arrived) { arrived = true; log(`JEV HAS ARRIVED at the gate. Holding. ${top}`); }
    if (fix === 'eat_food') await doEat();
    else if (fix === 'close_dialog') { try { await sdk.sendClickDialog(0); } catch {} }
    else if (fix === 'restart_current' && !atGate) {
      const wp = ROUTE[Math.min(navIdx, ROUTE.length - 1)]!;
      await hopStep(wp.x, wp.z);
      log(`jev restart_current -> re-step wp${navIdx + 1} ${top}`);
    }
    if (next === 'march_north' && !atGate) {
      const wp = ROUTE[Math.min(navIdx, ROUTE.length - 1)]!;
      if (st.waypoint_m <= 4) { navIdx = Math.min(navIdx + 1, ROUTE.length - 1); log(`waypoint ${navIdx}/${ROUTE.length} reached. ${top}`); }
      else {
        if (navIdx >= ROUTE.length - 2) await openGateNear(wp.x, wp.z);
        await hopStep(wp.x, wp.z);
        const q = pos();
        log(`jev march_north -> step to (${q.x},${q.z}) camp=${Math.round(Math.hypot(q.x - CAMP.x, q.z - CAMP.z))}m ${top}`);
      }
    } else if (next === 'hold_position' || (atGate && next === 'hold_stack')) {
      log(`jev HOLD (${atGate ? 'at gate' : 'road'}) ${top} hp=${st.hp}`);
    } else if (next === 'retreat_bank') {
      log(`jev retreat_bank (no food!) ${top} — holding, needs resupply`);
    }
  } catch (e) { log(`jev miss (${String(e).slice(0, 100)}) — keep walking`); nextPollIn = pollEvery; }
}
