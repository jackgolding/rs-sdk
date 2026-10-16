#!/usr/bin/env bun
/**
 * jev-dragons tick spike (OFFLINE ONLY — ~/rs-sdk-offline).
 * Live Jev decisions for red-dragons copies: eat / re-click / patrol.
 *
 * Usage:
 *   JEV_API_KEY=$(cat ~/.config/jev/jev.env 2>/dev/null) \
 *     bun tools/jev-dragons/tick-spike.ts jacklove5 --tank=jacklove5 --lead=jacklove5 [--poll-every=3] [--dry]
 *   --dry = shadow: log Jev vote, execute nothing (default when no key).
 *
 * Backend: native TypeSafe (JEV_API_KEY) preferred, else OpenRouter
 * System One (OPENROUTER_API_KEY, model typesafe/jev-1.14). The shell
 * already exports OPENROUTER_API_KEY from ~/.zshrc — just
 * `source ~/.zshrc` before running. --dry = shadow, no calls.
 *
 * ONE-CONTROLLER RULE: this opens the SDK controller for the account.
 * Locally that's fine (copies). Never run alongside another controller
 * for the same name.
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

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (const a of argv) {
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); flags.set(k, v ?? 'true'); }
  else positional.push(a);
}
const botArg = positional[0];
if (!botArg) { console.error('usage: tick-spike.ts <botname> [--tank=..] [--lead=..] [--poll-every=3] [--dry]'); process.exit(1); }
const TANK = new RegExp(`^${flags.get('tank') ?? botArg}$`, 'i');
const LEAD = new RegExp(`^${flags.get('lead') ?? botArg}$`, 'i');
const pollEvery = Math.max(1, parseInt(flags.get('poll-every') ?? '3', 10) || 3);

// key: env first, then ~/.config/jev/jev.env (KEY=... or bare)
function loadKey(): string {
  if (process.env.JEV_API_KEY) return process.env.JEV_API_KEY;
  const p = join(process.env.HOME ?? '', '.config', 'jev', 'jev.env');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const t = line.trim(); if (!t || t.startsWith('#')) continue;
      const m = t.match(/^(?:JEV_API_KEY|TYPESAFE_API_KEY)\s*=\s*(.+)$/);
      if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
      if (/^sk-/.test(t) || /^[A-Za-z0-9_\-]{20,}$/.test(t)) return t; // bare key
    }
  }
  return '';
}
const apiKey = loadKey();
const orKey = process.env.OPENROUTER_API_KEY || '';
// Native first, OpenRouter System One fallback. --dry forces shadow.
const backend = apiKey ? 'native' : orKey ? 'openrouter' : 'none';
const JEV_URL = backend === 'openrouter' ? OR_URL : NATIVE_URL;
const JEV_MODEL = backend === 'openrouter' ? OR_MODEL : 'jev-latest';
const JEV_KEY = backend === 'openrouter' ? orKey : apiKey;
const dry = flags.get('dry') === 'true' || backend === 'none';

// local bot.env: bots/<name>/bot.env in THIS checkout; any password works locally
function loadBotEnv() {
  const p = join(process.cwd(), 'bots', botArg, 'bot.env');
  if (!existsSync(p)) throw new Error(`missing ${p} — create it locally: BOT_USERNAME=${botArg}, PASSWORD=x (any), no SERVER line (=localhost gateway)`);
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
  }
}
loadBotEnv();
const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const gatewayUrl = deriveGatewayUrl(process.env.SERVER || undefined);
console.log(`[spike] ${username} role=${TANK.test(username) ? 'tank' : 'dps'} gw=${gatewayUrl} pollEvery=${pollEvery} backend=${backend} model=${JEV_MODEL} ${dry ? 'SHADOW (no calls)' : 'LIVE Jev'}`);

const sdk = new BotSDK({ botUsername: username, password, gatewayUrl, connectionMode: 'control', autoLaunchBrowser: false, autoReconnect: true, showChat: false });
await sdk.connect();
await sdk.waitForCondition((s: any) => s.inGame && s.skills?.length > 0 && !!s.player, 90_000);
const bot = new BotActions(sdk);
console.log('[spike] in game at', sdk.getState()?.player?.worldX, sdk.getState()?.player?.worldZ);

const logPath = join(process.cwd(), 'bots', botArg, 'jev-spike.log');
const jevLog = join(process.cwd(), 'bots', botArg, 'jev-calls.jsonl');
const log = (m: string) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); try { appendFileSync(logPath, l + '\n'); } catch {} };

let lastXp = -1, lastXpAt = Date.now(), lastHp = -1, dmg10: Array<{ t: number; n: number }> = [];
let nextPollIn = pollEvery, runningGoal = 'hold_stack';

function snap() {
  const s: any = sdk.getState(); const p = s?.player; const now = Date.now();
  if (p && lastHp >= 0 && !p.isDead && p.hp < lastHp) dmg10.push({ t: now, n: lastHp - p.hp });
  if (p) lastHp = p.isDead ? -1 : p.hp;
  dmg10 = dmg10.filter(d => now - d.t <= 10_000);
  const xp = s?.skills?.find((k: any) => /attack/i.test(k.name))?.experience ?? 0;
  if (xp > lastXp) { lastXp = xp; lastXpAt = now; }
  const lead = (s?.nearbyPlayers ?? []).find((pl: any) => LEAD.test(pl.name));
  const tankTgt = (s?.nearbyPlayers ?? []).some((pl: any) => TANK.test(pl.name) && pl.inCombat);
  return {
    role: TANK.test(username) ? 'tank' : 'dps', status: p?.isDead ? 'dead' : dmg10.length && now - dmg10[dmg10.length - 1]!.t < 6000 ? 'under_attack' : p?.combat?.inCombat ? 'in_combat' : 'idle',
    hp: `${p?.hp ?? '?'}/${p?.maxHp ?? '?'}`, dmg_last_10s: dmg10.reduce((a, d) => a + d.n, 0),
    secs_since_xp: +((now - lastXpAt) / 1000).toFixed(1), food: foodCount(), slots: slots(),
    lead_xy: lead ? [lead.x, lead.z] : null, tank_has_target: tankTgt, pos: [p?.worldX, p?.worldZ],
  };
}
function foodCount() { try { return sdk.getInventory().filter((i: any) => /shark|swordfish|tuna|lobster/i.test(i.name) && (i.count ?? 0) > 0).reduce((n: number, i: any) => n + (i.count ?? 1), 0); } catch { return 0; } }
function slots() { try { return sdk.getInventory().filter((i: any) => (i.count ?? 0) > 0).length; } catch { return 0; } }

function catalog(st: ReturnType<typeof snap>) {
  const isTank = TANK.test(username);
  const c: Record<string, string> = { hold_stack: 'stay stacked with lead at camp' };
  if (isTank && st.status !== 'in_combat') c.tank_engage_fresh = 'attack a fresh red dragon now';
  if (!isTank && st.tank_has_target) c.dps_pile = 'pile the tank dragon';
  if (!st.tank_has_target) c.patrol_next = 'walk isle patrol to find a dragon';
  if (st.food === 0) c.retreat_bank = 'out of food: leave for Mage bank';
  return c;
}

async function askJev(state: unknown, cands: Record<string, string>) {
  const questions = {
    next_action: { type: 'choice', instructions: { question: 'Which action best uses the next seconds of this red-dragon trip?', focus: ['Staying alive beats XP. No food means retreat.', 'DPS never starts a fresh fight; only pile the tank target.', 'Patrol when nothing is engaged.'] }, criteria: cands },
    this_tick: { type: 'choice', instructions: { question: 'Anything to do this tick without changing the goal?', focus: ['do_nothing is normal.', 'eat_food when HP is low.', 'restart_current when quiet too long (re-click).', 'close_dialog when a dialog is open.'] }, criteria: { do_nothing: 'keep going', eat_food: 'eat one food now', restart_current: 're-click the target', close_dialog: 'close open dialog' } },
    poll_again_in_ticks: { type: 'choice', instructions: { question: 'Ticks before asking again?', focus: ['Soon when hurt/idle, later when settled.'] }, criteria: Object.fromEntries([...new Set([pollEvery, pollEvery * 2, 5, 10].filter(n => n >= pollEvery && n <= 10))].map(n => [String(n), `in ${n} ticks`])) },
  };
  const res = await fetch(JEV_URL, { method: 'POST', headers: { Authorization: `Bearer ${JEV_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ state, model: JEV_MODEL, questions }), signal: AbortSignal.timeout(pollEvery * TICK_MS) });
  if (!res.ok) throw new Error(`${backend} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  try { appendFileSync(jevLog, JSON.stringify({ ts: new Date().toISOString(), state, response: data }) + '\n'); } catch {}
  return data.answers;
}

async function doEat(): Promise<void> {
  const foods = sdk.getInventory().filter((i: any) => /shark|swordfish|tuna|lobster/i.test(i.name) && (i.count ?? 0) > 0);
  if (!foods.length) { log('eat_food: no food'); return; }
  const r: any = await (bot as any).eatFood(foods[0]);
  log(`eat_food: ${foods[0].name} -> ${r?.success ? '+' + r?.hpGained : r?.message}`);
}

let tick = 0;
log('spike running — Ctrl+C to stop. Decisions append to jev-spike.log');
while (true) {
  await new Promise(r => setTimeout(r, TICK_MS));
  if (++tick % nextPollIn !== 0) continue;
  const st = snap();
  const cands = catalog(st);
  if (dry) { log(`shadow poll goal=${runningGoal} hp=${st.hp} food=${st.food} cands=[${Object.keys(cands)}] secs_xp=${st.secs_since_xp}`); continue; }
  try {
    const a = await askJev({ bot: username, ...st, running_goal: runningGoal }, cands);
    const next = a.next_action?.choice ?? runningGoal;
    const fix = a.this_tick?.choice ?? 'do_nothing';
    nextPollIn = parseInt(a.poll_again_in_ticks?.choice ?? String(pollEvery), 10) || pollEvery;
    log(`jev goal ${runningGoal} -> ${next} (p=${JSON.stringify(a.next_action?.probabilities ?? {})}) tick=${fix} again=${nextPollIn} hp=${st.hp}`);
    if (fix === 'eat_food') await doEat();
    else if (fix === 'close_dialog') { try { await sdk.sendClickDialog(0); } catch {} }
    else if (fix === 'restart_current') log('restart_current: re-click target (tank: fresh dragon / dps: tank dragon)');
    if (next !== runningGoal) { runningGoal = next; log(`goal switch -> ${next} (patrol/hold executed by base script fns)`); }
  } catch (e) { log(`jev miss (${String(e).slice(0, 120)}) — keep ${runningGoal}`); nextPollIn = pollEvery; }
}
