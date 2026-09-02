# Agility courses

Server scripts under `server/content/scripts/skill_agility/` are the source of
truth for obstacle order, fail tiles, XP, and varps. The game is not buggy when
a bot skips a lap.

## Do not call a lap done without evidence

A grind line `Wildy lap N | Agility …` is only valid if that tick also saw
**4989 Agility XP** or the game message **"You reach the top."** (`%wilderness_course_progress = 5`).
Rocks always forcemove; sampling XP on the first 3-tile move logs `+0 xp` and
skips the lap line even when the bonus already landed.

Faster pit climbs, "attempted the log", or XP from partial obstacles / deaths
are not laps. Gnome lap bonus is 300 XP, not 4989.

## Wilderness course (jackthief)

Lap: pipe (3003,3937) → rope (3005,3951) → stones (3001,3959) → log (3001,3945)
→ rocks (2994,3935). West south-of-fence gate is (2948,3904), not the spider
web at 3224.

- **Log is plane 0** (bridged L1 loc 2297). Do not treat `level !== 0` as "leave
  gnome", and do not climb-down loc_1759 to "reach the log" — that is the pit
  entrance (`z+6400`).
- Pit climb-up is loc_1755 at (3005, 10363) → surface (3005, 3962). loc_1765 is
  an unhandled ladder.
- Log fail slide is **4 tiles west**. Success is Agility XP or `x <= x0-7` still
  on plane 0. Treating −4 as done skips to rocks while falling.
- After a pit at `z>=3960`, resume **log** along the **east wall** (`x=3006`),
  never recross lava/stones. West of the pit ladder (x≈2996, z≈3963) is trees.
- Fail does not clear varp. Log+rocks after a pit still pay 4989 **iff**
  pipe–stones already counted. If varp is 0, rocks will not pay the bonus.
- `valid()` on rocks is **from the north** (`pz > lz`). Standing south of the
  loc is the landing, not the click tile.
- Pipe is entered from the **south**. After rocks, hop **east at z=3934**
  (2 tiles at a time) to (3004, 3937). A single `sendWalk(3004, 3936)` from
  (2994, 3933) pathfinds **north around the lava** to the pipe's north end
  ("You can't enter the pipe from this side"). Ridge gates at (2998, 3931)
  make `z=3933` east walks drop south into the yard.
- Use `sdk.sendInteractLoc` on the course. `bot.interactLoc` / `bot.walkTo`
  run the wilderness pathfinder and will route through walls, lava, and void.

West of x=2944 at the course fence is unallocated void. Food restock is Mage
Arena cellar via Gundai (ladder loc_2871 at 3091,3957). Two webs sandwich
(3094, 3957); slashing one is not enough. Empty inv + 4 HP in the pit dies to
skeletons — bank food, then re-enter the west gate and start at the **pipe**.

## Gnome course

Linear 7-step order in `gnome_course.rs2`. Do not pick the nearest agility loc.
Do not `inferStep` mid-lap from "rope still nearby" — that regresses the step.
The gnome log is L1; that fact does **not** transfer to the wilderness log.
