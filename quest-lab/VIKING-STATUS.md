
## GATE PASSED — single uninterrupted run (qlviking5, 2026-10-19)

`07:06 → 09:06`, from the unstarted `viking.json` fixture, **no restarts, no
rescue**:

    started -> peer -> olaf -> sigli -> reveller -> swensen -> sigmund
    -> thorvald -> complete
    promotion gate: PASS — every required checkpoint is on the run record
    DONE Fremennik Trials verified via the quest journal

Run record: `quest-lab/runs/viking-qlviking5-2026-10-19t07-06-44-324z`.

That run also **confirmed the stall fix**: `ActivitySession` flags a stall after
120s without a *progress note*, and `showIntent` does not touch that clock —
`noteProgress(kind)` does, and a non-`phase` note additionally EXITS an
in-progress recovery. Crediting travel legs and drained conversations turned
"parks at nearly every stage boundary" into zero parks across the whole quest.

Fix applied after the run: the finish stage now `process.exit(0)`s after reporting
the gate. Before that, stopping the session left the loop spinning
(`no stage matched` ×210) until the process was SIGTERMed — a bot that finishes a
quest and then spins is unacceptable on the fleet.

Live prerequisites for a canary bot (the fixture stood in for all of these):
banked supplies (~20k coins, rune axe, knife, tinderbox, 5 raw shark, cabbage,
potato, onion, 4 beer, food), Woodcutting 40 / Crafting 40 / Fletching 25, and
~90 minutes unattended. Everything was derived against THIS content revision;
the hosted demo's revision is the one unverified variable.

# The Fremennik Trials — COMPLETE, journal-verified (2026-10-18)

**Result: all 7 votes + `QUEST COMPLETE!`**, earned end-to-end by
`bots/quests/fremennik-trials.ts` against the local quest-lab stack on the bot
`qlviking1`. Evidence, not assertion:

- `journal: active votes=[peer,olaf,sigli,reveller,swensen,sigmund,thorvald]`
- run record `quest-lab/runs/viking-qlviking1-2026-10-18t17-06-59-505z`:
  `complete` checkpoint PASS whose raw journal lines are
  `"@red@QUEST COMPLETE!"`, `"@dbl@@dre@Doklim"` (the Fremennik name) and
  `"I have @dre@seven votes@dbl@! I should go speak to @dre@Brundt@dbl@ again"`
- a fresh run now reads the completed journal at the startup probe and exits
  cleanly without banking or travelling.

Per-trial mechanics (verified live): Seer riddle/lock/mural; Bard pet rock ->
stew -> Seers' wheel -> swaying tree -> lyre -> altar -> longhall stage; Hunter
talisman -> Draugen hunt; Reveller keg swap (pipe bang FIRST, then swap inside
the longhall zone); Navigator's portal maze (real-portal destinations + room BFS
to the exit ladder at 2665,10037); Merchant 12-link chain (sober Manni only,
Askeladden's merchant label for the 5000-coin note, goods traded back up the
chain); Warrior Koschei fight (arena ladder op2 = Climb-down; honour-death also
completes the trial).

**Not yet promoted to the fleet tree.** The skill's promotion gate requires a
FRESH account from the original unstarted fixture to clear the staging tests
without manual rescue; this run verified a mid-quest resume. Next step for
promotion: run `viking.json` on a new bot from scratch against this script.

# The Fremennik Trials — development status (2026-10-18)

Script under development: `bots/quests/fremennik-trials.ts` (offline tree only —
NOT copied back to `~/rs-sdk`, it is not verified yet).
Fixture: `quest-lab/fixtures/viking.json` → account `qlviking1` (provisioned,
one-shot name). Lite runner for `qlviking1` runs from `server/webclient`.

## Verified mechanics (this content revision, from live dumps + content source)

Journal (`viking_journal.rs2`) — the checkpoint channel, read through the quest
side tab (label AND title are both "The Fremennik Trials"):

| stage | line |
|---|---|
| not started | `I can start this quest by speaking to Chieftain Brundt …` |
| started | `I spoke to Brundt the Fremennik chieftan …` |
| Peer done | `I now have the Seer's vote at the council` (no period) |
| Olaf done | `I now have the Bard's vote at the council.` |
| Sigli done | `I now have the Hunter's vote at the council.` |
| Reveller done | `I now have the Reveller's vote at the council` |
| Swensen done | `I now have the Navigator's vote at the council.` |
| Sigmund done | `I now have the Merchant's vote at the council.` |
| Thorvald done | `I now have the Warrior's vote at the council` |
| complete | `QUEST COMPLETE!` + `I made my way to the far north of Kandarin …` |

The viking varp is not client-visible; `%viking` (=1 + votes) and
`%viking_bits` are server-side only.

Council NPC anchors (recon sweep, all plane 0): Brundt 2658,3669 · Manni
2660,3675 · Thora 2662,3673 · Sigmund 2643,3681 · Olaf 2671,3684 · Sigli
2659,3654 · Thorvald 2666,3692 · Yrsa 2626,3674 · Skulgrimen 2663,3693 · Sailor
2629,3693 · Fisherman 2641,3699 · Askeladden 2658,3660 · Peer 2633,3669 ·
Swensen 2646,3660 · Council workman 2655,3592 · Poison Salesman 2735,3492.
Swensen's maze ladder: 2644,3657 (Climb-down).

### Peer trial (implemented, verified to the mural step)

1. Accept from Peer: talk → `Yes` (inventory and worn must be EMPTY for the
   door check; the script deposits everything at Seers first).
2. Combination door = **door at 2631,3667**. Click it from the NORTH
   (`z >= 3667`) or it answers with the "leaving" page
   (`If you leave by this door you will fail this trial`). An open door steps
   the player from z=3667 to z=3666 = inside.
3. Riddle menu hides behind the plaque continue page: door → continue →
   `Read the riddle` / `Solve the riddle` / `Forget it`.
4. Riddle text arrives as mesbox pages in `dialog.allComponents` (NOT
   `dialog.text`). Six riddles → MIND/TREE/LIFE/FIRE/TIME/WIND; answer
   matching by first line, e.g. `My first is in fish …` = FIRE.
5. Lock interface id 10051: dial letters at `base+43..46`, minus at
   `base+47/49/51/53`, plus at `base+48/50/52/54`, ENTER at `base+57`, where
   `base = interfaceId + 1` (all buttons are "Ok", so ids, not text). Success =
   chat `You have solved the riddle!` (give it ~20s).
6. Puzzle room is **plane 2**, up the Ladder@2631,3663 inside the house. Down
   is Trapdoor@2631,3663 (plane 2) → drops to 2631,3662 plane 0.
7. Room inventory: Bookcase@2634,3665 → red herring · Chest@**2635,3660**
   (Open then Search) → empty jug · Cupboard@2629,3660 (Open then Search) →
   empty bucket · Unicorn's head@2632,3660 → red disk · Bull's head@2634,3660 →
   wooden disk · Tap@2629,3661 / Drain@2629,3662 · Cooking range@2629,3663 ·
   Frozen table@2638,3665 · Chest (scales)@2635,3660 → use 4/5ths bucket → vase ·
   Chest@2638,3662. **Chest@2632,3665 is decorative and never opens** — keep
   rotating candidates, do not hammer the first one.
8. Red herring on the range → sticky red goop; goop + wooden disk → red disk.
   Gate this on "an unpainted disk exists", not on "no red disk yet".
9. Water arithmetic (classic 3/5): jug_3→bucket_empty → bucket_3; jug_3→
   bucket_3 → bucket_5 + jug_1; drain bucket_5; jug_1→bucket_empty → bucket_1;
   jug_3→bucket_1 → bucket_4; bucket_4 on the scales chest → vase.
10. Mural (plane 0, 2634,3663) takes both red disks → vase lid.
11. Vase + water (tap, or jug_3/bucket_3+ on it) + lid → sealed vase; on the
    frozen table → key in ice; on the range → Seers' key.
12. Exit door = **door at 2636,3667** (`viking_seers_door2`): locked shut unless
    you carry the Seers' key; unlocking sets `peer_complete`, adds a vote and
    prints `Incredible! To have solved my puzzle so quickly!`.

## Votes earned (journal-verified): peer, olaf

`CHECKPOINT peer PASS — Seer's vote` (run 11:47) and `CHECKPOINT olaf PASS —
Bard's vote` (run 13:09, offsets/logs above). The journal itself reports
`votes=[peer,olaf]` on the next pass, which is the ground truth for both.

## Olaf trial: COMPLETE (journal-verified)

Verified chain, each step gated on the item it must produce:

1. Accept from Olaf (2671,3684): `I was wondering...` → `Yes`.
2. **Talk to Lalli FIRST** — his refusal sets `olaf_spoken_lalli`, and that is the
   only Askeladden branch that hands out the pet rock (`olaf_started` is flavour).
3. Askeladden (2658,3660) → pet rock. Then Lalli again → the "cunning plan".
4. `Lalli's Stew@2772,3623`: use pet rock + cabbage + potato + onion on it →
   the cauldron sets `olaf_made_stew` once all four are in → talk Lalli → fleece.
5. **Spin the fleece at the SEERS' VILLAGE wheel (2715,3471, upstairs plane 1).**
   Rellekka's own wheel is `viking_spinningwheel` and answers *"Only Fremenniks
   may use this spinning wheel"* until `%viking = complete`.
6. `Swaying tree@2738,3638` — its op is literally **`Cut-branch`** (not "Chop"),
   and the branch lands a few ticks after the swing.
7. Knife + branch → unstrung lyre (Craft 40); golden wool + unstrung → lyre.
8. `Strange altar@2626,3598` — raw shark on it (requires the STRUNG lyre in the
   bag) → enchanted lyre.
9. Play the enchanted lyre **inside the longhall zone** `0_41_57_31_34 ..
   0_41_57_38_37` (= x 2655-2662, z 3682-3685) — `[opheld1]` only grants the
   vote inside that zone.

Two general bugs this trial exposed (both now fixed in the script):

- **Local-scan-only helpers**: `useOnLoc`/`interactByName` scan the CURRENT
  surroundings, so a distant target (tree/altar/wheel) silently reports "not
  nearby" forever. Every distant step must travel to its anchor tile first.
- **Whole-pack requirements**: `ensurePack` demands the stew vegetables the
  earlier step already ate, so the stage loops on "pack incomplete". Stage
  supplies must be computed from the REMAINING steps, and withdrawals must not
  deposit (that banks the fleece/lyre just earned).

## Peer trial: COMPLETE (journal-verified, 2026-10-18)

`CHECKPOINT peer PASS — Seer's vote` in run `viking-qlviking1-2026-10-18t11-47-02`.
The full verified chain: accept → deposit-all at Seers → combination door from
the north → plaque page → riddle (mesbox text in `dialog.allComponents`) →
combo dials by interface id (base = interfaceId+1) → plane 2 puzzle room →
herring/jug/bucket/disks → cook herring + paint the wooden disk → water
arithmetic (bucket on tap → 5/5 bucket on empty jug → jug on drain → 2/5
bucket on empty jug → bucket on tap → 5/5 bucket on 2/3 jug = **4/5 bucket**) →
4/5 bucket on the scales chest → vase → both red disks on the mural (eastern
trapdoor!) → vase lid → seal → freeze on the frozen table → melt on the range →
Seers' key → **east** door 2636,3667 unlocks and the vote lands.

Two traps that cost runs and are now encoded:

1. Clicking the combination door at 2631,3667 from inside runs its leave branch,
   which CLEARS every peer trial item — including a Seers' key already earned.
   The key goes on the door at **2636,3667** (`viking_seers_door2`).
2. Once `seerdoor_reddisk_2` is set the bookcase stops giving herrings and the
   mounted heads stop giving disks. That is "already done", not a failure — the
   grab steps must log and continue, or the stage loops forever.

## Peer trial: mural blocker SOLVED (eastern trapdoor)

There are TWO trapdoors on plane 2 at z=3663:

- **2631,3663** — `Trapdoor[Climb-down|Close]` → drops into a POCKET room
  (lands 2631,3662) that is walled off from the mural: `Study` and the red-disk
  use answer `I can't reach that!` from every reachable tile, including the
  adjacent 2633,3663.
- **2636,3663** — a CLOSED trapdoor with a single `Open` op → open it, then
  `Climb-down`, and you land at 2636,3664 INSIDE the mural room, where
  `Study Abstract mural` succeeds ("You study the mural... it appears to be
  missing something..."). Verified by probe-viking-mural5.

A plain "find a Climb-down loc" search picks the western one, so the script has
a dedicated `descendToMuralRoom()` (open the eastern trapdoor first, then climb
down) — this is the fix for the step that was failing.

Exit path out of the house from the mural room (there is no outside door there —
its door at 2636,3667 is the locked exit that only the Seers' key opens):
ladder up (plane 2) → **western** trapdoor down into the pocket → combination
door at 2631,3667, whose `you will fail this trial` page is the exit
confirmation. `exitSeerHouseIfInside()` encodes this; every long trip starts
with it (a plain walk cannot route out).

## Olaf/Sigli/Manni recon targets (from the walkthrough transcript)

`wiki/quests/fremennik-trials.video.md` (chapters "Sigli, Olaf, Manni") gives
directions where the content gives none:

- **Lalli the troll**: leave Rellekka, then "follow the dirt path EAST to Lalli"
  — east of town, outside the gate. The old script anchor (2762,3649) has no NPC.
- **Swaying tree**: "go NORTHWEST to the swaying tree" from Lalli; the transcript
  says it shows a rare-tree icon on the minimap with rabbits and doogle leaves
  around it — use that as the scan signature, not a coordinate guess.
- **Strange altar**: from the Council Workman's bridge (2655,3592) "go WEST and
  follow the dirt path until you see a small peninsula just south into the
  woods"; the raw shark goes on that altar. The script's old guess (2612,3608)
  is unverified.
- Also noted: pick the stew vegetables (cabbage/onion/potato) from the garden
  behind the house south-east of the longhall if the bank is short; the beer +
  keg for Manni come off the longhall table; the non-alcoholic keg is 250 coins
  from the Poison Salesman in the Seers' Village pub (2735,3492).

**Swept and confirmed in-game (2026-10-18, logs in `bots/qlviking1/sweep-*.log`):**

- **Lalli** — NPC `Lalli@2768,3619` (also 2771,3621), with `Cave Entrance@2774,3619`
  and `Lalli's Stew@2772,3623` (the cauldron the rock/cabbage/potato/onion go into).
  Golden sheep + `Golden tree@2765,3608` cluster around him.
- **Swaying tree** — `Swaying tree@2738,3638`, exactly where the walkthrough's
  "rabbits and doogle leaves" signature said (bunnies + bear cubs all around
  2720-2742,3631-3648). Chop it for the branch (axe, WC 40).
- **Strange altar** — `Strange altar@2626,3598`, west of `Council workman@2655,3592`
  on the small peninsula. Raw shark on it → enchanted lyre.
- Spinning wheel for the fleece is also in Rellekka at `Spinning wheel@2617,3659`
  (no need to trek to Seers' Village).

Olaf's own NPC sits at 2671,3684 (east of the longhall) per the first sweep.

## Next: Sigli (in progress)

The run advances to `sigli` on its own once olaf passes, and it currently loops
on `pack incomplete — banking` — the same whole-pack bug as olaf, since the old
sigli body still calls `ensurePack`. Fix that the same way (targeted
`ensureItems`) and then the talisman → Draugen hunt, returning the charged
talisman to Sigli (2659,3654) for the vote.




## Promotion gate runs (fresh accounts, 2026-10-19)

Two brand-new accounts from the unstarted `viking.json` fixture, to prove the
script works from scratch rather than only on a resume:

- **qlviking2** — 7/7 votes + `CHECKPOINT complete PASS`; run
  `quest-lab/runs/viking-qlviking2-2026-10-19t04-45-25-507z`. Required several
  restarts while fresh-account-only bugs were fixed under it.
- **qlviking3** — same result: `started → peer → olaf → sigli → reveller →
  swensen → sigmund → thorvald → complete`, with the `DONE ... verified via the
  quest journal` line and the journal's completion text on the record.

Fresh-account bugs this exposed (all fixed — none of them could show on a resume,
where the flags were already set):

1. The `start` stage was the only stage that never called `refreshProgress`, so
   `progress.started` never flipped and the run re-talked to Brundt forever.
2. A stage's `checkpoint()` PASS never marked `progress`, so the stage's own
   `detect()` stayed true and it re-ran its whole body (re-hunting, re-walking
   the merchant chain) until the session's stall recovery exhausted → parked
   `stuck` with the vote already earned.
3. The olaf altar step needed a raw shark fetched AT THE POINT OF USE — the
   stage's need list is computed before the lyre chain exists.
4. The reveller keg is a GROUND SPAWN whose take is `[opobj3,viking_beerkeg]`:
   `pickupItem` (op1) times out on it — use `interactGroundItem` with
   `optionIndex: 3`. Same for the floor Beer (`id 3803`) when the bank runs dry.
5. The reveller accept was gated on "already hold a task item", and the
   low-alcohol keg counts as one — so the trial never started and the keg take
   (content-guarded on `reveller_started`) silently did nothing.
6. The reveller stage's talks matched `/manni|bjorn|eldgrim|reveller/`, which is
   the DRUNK reveller's dialogue; the contest lives on `/^manni/`.
7. The reveller drink completes ~5s after the last dialogue page, and the journal
   write lands later still — settle + re-read before the checkpoint.

Known wart: a stage boundary can still trip the session's stall detector after a
PASS, which parks the run as `stuck`; a restart resumes from the journal and
carries on (no progress is lost, and every trial re-verifies).

## Maze route (solution map supplied by the operator)

The operator's route map shows **S -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> F**: the
seven REAL portals taken in numeric order, each landing in the next panel, with
portal 7 landing beside the finish. That matches the content-derived table
exactly (portal N -> `p_telejump` target), and portal 7 -> (2665,10038) is one
tile from the vote-granting exit ladder at (2665,10037).

`MAZE_PORTAL_ORDER` in the script now encodes that line with the map-dump ids
(`vt_mazeportal_1..7` = 4150..4156), placements and landings, and `solveMaze`
tries it FIRST via `followPortalOrder()` (walk with the `isTileWalkable` room BFS,
click by coordinate+id, verify the landing). The learning explorer remains as the
fallback — it is what actually earned the vote before the map arrived (its
successful chain was the 4->5->6->7->exit tail of the same route).

Caveat: qlviking1 has already completed the quest, so the re-run exits at the
startup probe and this new path could not be re-exercised here. First live test
is the fresh-fixture promotion run.

## Sigmund's merchant chain (in progress, 2026-10-18 evening)

Votes verified so far by the journal: **peer, olaf, sigli, reveller, swensen**
(`votes=[peer,olaf,sigli,reveller,swensen]`). Sigmund's chain is the current work.

Chain, read out of content (each link advances ONLY from the previous flag):

    sigmund_started -> sailor -> olaf -> yrsa(viking_clothing_shopkeeper)
    -> brundt(chief) -> sigli -> skulgrimen(viking_weapon_salesman)
    -> fisherman -> swensen(viking_hallifred) -> peer(seer) -> thorvald
    -> manni(viking_reveller_3) -> barkeep(Thora) -> [spoke_thora]
    then Askeladden sells viking_promissary_note2 for 5000 coins,
    then the goods trade BACK up the same chain to Sigmund's rare flower.

Lessons that cost runs:

- The MERCHANT dialogue exists only on `viking_reveller_3` ("Manni the
  Reveller", sober, in the longhall). `viking_reveller` / `_2` are the drunk
  revellers ("Bjorn" / "Eldgrim") whose entire dialogue is hiccuping flavour —
  a broad `/manni|bjorn|eldgrim|reveller/` matches one of those and leaves
  `spoke_manni` unset forever. Use `/^manni/` for the chain.
- Askeladden's menu leads with "Ask about the Merchant's trial", and that branch
  only recites the chain. The 5000-coin sale lives in his MAIN body, reached by
  picking "Ask about becoming a Fremennik" (option 2).
- Sigmund's own recital only changes at `spoke_thora`, so he is a poor progress
  probe; each LINK's reply text is the reliable tell (it names the item that
  link currently wants).
- `talk()` used to `return ''` silently when the anchor was unreachable or no NPC
  matched, which made a whole 12-link pass look like it ran. It now logs both.

Remaining here: the barkeep -> Askeladden hand-off (the note still is not
bought), the trade-back, and Sigmund's flower -> Merchant's vote.

## Still to do (this script)

- Finish the Peer trial (mural → vase → key → exit door) and checkpoint it.
- Olaf (Lalli's cave — NPC `Lalli`, cave mouth not yet located), Sigli (Draugen
  hunt with the talisman), Reveller (keg/firecracker/poison salesman), Swensen
  (maze under 2644,3657), Sigmund (12-NPC trade chain, 5000 coins), Thorvald
  (Koschei, unarmed, must run after the Sigmund chain).
- Then the usual promotion path: frozen candidate → fresh-account staging run.
