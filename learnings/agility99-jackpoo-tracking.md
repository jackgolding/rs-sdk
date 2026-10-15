# Agility 1→99 experiment — Jackpoo1-5

Started: 2026-10-14T10:56:50Z (epoch 1791975410)
Goal: Agility 99, then return to fishing-route --bignet
Start levels (dump-skills.ts 2026-10-14 ~10:55Z):
- Jackpoo1: Fish 99, Agil 1, Cook 99, cmb 123, tot 1194
- Jackpoo2: Fish 99, Agil 1, Cook 99, cmb 122, tot 1176
- Jackpoo3: Fish 99, Agil 1, Cook 99, cmb 76, tot 656
- Jackpoo4: Fish 99, Agil 1, Cook 99, cmb 123, tot 1083
- Jackpoo5: Fish 99, Agil 1, Cook 99, cmb 123, tot 1085

Route: bots/quests/agility-route.ts (Gnome to 52, Wildy course to 99, Mage Arena bank restocks)
Roster switch: fishing-route.ts --bignet → agility-route.ts
Return plan: when agility-route exits done (Agility 99), switch roster back + `switch` to fishing.

## Timing log
- 2026-10-14T10:56:50Z START (roster edited fishing→agility, switch issued)
- 10:57:29–10:57:54Z agility procs live (lvl=1 xp=0, phase gnome_travel)
- ~11:00–11:01Z all five at gnome gate (2459,3383 / phase gnome_entrance)
- Jackpoo5 drained+restarted again 11:00:56Z by sequential switch pass (expected)
- 11:03-11:06Z: J2/J4/J5 lapping partial (net→pipe, +1000/lap, NO log, NO bonus); J1/J3 stranded east of course fence (2494,3436)
- 11:44Z: J5 crash = OLD latent OOB (`return 6` with 6-step array) — already fixed by 7-step array
- ~12:05Z: J1's east-fence detour WORKED (re-entered, reached L2). Detour design verified.
- 12:11-12:16Z: XP rate confirmed 2.5x (net 75→+187). Full lap value if log+bonus: ~2162 XP vs partial 1000.
- (finish times appended per bot as they hit 99)

## Observations / improvements
- DONE: log balance added as lap step 1 (server varp 1/7), tested — bots were
  walking around it, losing the 390-point lap bonus every lap.
- DONE: steps advance only on Agility XP (or a completed force-move crossing),
  not on plain movement. Pipe counts a lap only with bonus evidence (≥300 XP
  on the pipe step), else warns "Pipe without lap bonus" and restarts at log.
- DONE: per-step trace `[n/7] id +xp @ x,z Lvl` + pipe `+xp` in Lap lines.
- DONE: east-fence detour (verified live: J1 re-entered 12:04Z).
- DONE: rope-skip micro-loop fix (skip target tree_down), tick guard for bad
  stepIndex, fails reset on step change, 4s XP grace after climbs/teleports.
- DONE: cross steps (log/rope) use raw sendInteractLoc — bot.interactLoc's
  approach walk faked crossings.
- TEMPORARY: log step auto-skips until the log is located (partial 1000 XP
  laps keep flowing). REMOVE once sweep finds it.
  - RESOLVED 2026-10-14 ~13:20Z (Hermes local debug): log IS on L0 at
    (2474,3435), id 2295, op Walk-across — 1 tile south of GNOME_START.
    Sweeps missed it because they ran seconds after travel/teleport while
    the client scene was still streaming; the skip then stuck forever.
    Fix in bots/quests/gnome-course.ts: removed the permanent skip, added
    settle+rescan (5 ticks) on log/net_up miss, settle (3 ticks) at each
    sweep stop, and logSwept reset in stall handling so the sweep retries.
    Verified locally: full 7-obstacle laps with +1163 pipe (bonus incl),
    lvl 3→40 in ~2 min at 30ms tick. L1 "sighting" during debug was a
    stale-scene artifact — scans after a tele read the old plane until the
    rebuild lands, so never trust a scan within seconds of a tele.
- OPEN: log location — corridor sweeps (r22 then r40) from start/gate found
  nothing on L0; L1 scans near net landing found nothing. Candidates: far
  west/south, L2, or level-gated scans hiding it.
  - ANSWERED: none of the above — it was at start all along, scene-load race.
- Switch lesson: the first foreground `switch` timed out at 180s but had already started working — relaunching it in background caused a second drain+restart pass (Jackpoo2/3/5 re-drained mid-travel ~11:00:5x). Next time run switch once in background from the start.
- 11:01Z: J1/J4/J5 "Opening gate @ 2459,3383", J2/J3 "No gate found near …" then re-approaching — entrance recovery path is being exercised, watch whether they get in without intervention.
- Initial note: fishing grind.log shows repeated "Drop Raw mackerel/cod failed: Drop ... was not observed" — candidate fishing fix after return.
- jackthief is the only Agility 99 reference account for rates.
- Gnome resume() logs bogus "resume step 6/6 (pipe)" when starting far from course (Catherby beach) — cosmetic, queue fix.
- Fishing dropBigNetJunk() breaks on first drop failure, leaving junk in inv — queue fix (continue).
