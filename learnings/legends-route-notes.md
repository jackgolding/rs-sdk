# Legends' Quest route — notes from another team's max-QP run on this server

Source: a race-day post-mortem (2026-10-31, `Max QP speedrun_ race day`), a fresh account to
145 QP / 69 quests including Legends' Quest in ~73.7k ticks, zero deaths, on this live server.
Our requirement DAG (server content): https://claude.ai/artifact/MrpEqpURXP7FuJ7VERNnCh

## What carries over

- **Legends is completable here**; their route is a superset of our 107-QP plan.
- **Two-account quests**: Shield of Arrav and Heroes' Quest need a partner in the other gang.
  Park the partner at the meeting point (museum for the shield swap) so the waiting is theirs.
- **Legends' Quest (~4.2k ticks)**:
  - A courier meets the main in the Kharazi jungle with a **belt kit**; check the courier's bank holds
    it before the run (their stall).
  - The main carries the **lockpick and staff orb** itself.
  - Way out: **Camelot Teleport → bank at Seers** (same exit as kbd-range --melee).
  - Way back in: **any charged amulet of glory**. Route planner from the mainland to the meeting.
- **Expensive quests**: Troll Stronghold (doors wedged, +1.3k ticks), Shades of Mort'ton (6 limestone
  bricks), Monkey Madness and Regicide are long and pay out only at the end.

## Live-server lessons (match our fleet bugs)

- **Re-sending a toggle undoes it** (valve, lever): send once and wait for the reply. Same family as the
  KBD lever bounce (learnings in memory `fleet-chat-and-lever-gotchas`).
- The server reads **at most 5 inventory ops per tick**: verify bank deposits.
- A brand-new account is not members until its second login (bank capped at 120 kinds).
- Treat a resume as a full run: test the exact state it resumes from.
