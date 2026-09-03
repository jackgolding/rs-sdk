---
name: quest-data
description: >-
  Regenerate bot-grade quest walkthroughs from server RS2 source and use them
  when authoring bots/quests quest scripts. Use when the user asks to generate
  quest data, regenerate wiki quests, scrape quest guides, implement a new
  quest script, or needs varp states, dialog option text, NPC coords, or item
  requirements for questing agents.
---

# Quest data

Prose guides in `wiki/quests/*.md` are OSRS-wiki paraphrases — no coords, no
dialog indices, no varp states. **Ground truth** for this revision lives in
`server/content/scripts/` (RS2). The generator turns that into bot-ready data.

Do not scrape LostHQ or old wikis when this repo already has the server source.
Read generated output first; open RS2 only for gaps (puzzle UIs, proc-based
progress, multi-varp quests).

## Regenerate

From repo root:

```bash
bun wiki/generate-quests.ts
```

Or via this skill:

```bash
bun .cursor/skills/quest-data/scripts/generate-quests.ts
```

Writes:

| Output | Purpose |
|--------|---------|
| `wiki/quests/{slug}.generated.md` | Human-readable state machine per quest |
| `wiki/quests/index.json` | Machine index: varp, states, NPCs, items, script paths |

Prose guides (`wiki/quests/*.md`) are **not** overwritten. Generated files sit
alongside them (`romeo-and-juliet.generated.md` next to `romeo-and-juliet.md`).

After `server/content` changes (upstream rebase onto `sdk/local`), regenerate
before trusting quest data.

## Coverage (typical run)

- ~62 quests from `update_questlist` in `general/scripts/quests.rs2`
- Skipped when progress is a proc, not a varp: Dig Site (`~itexam_progress`),
  Clock Tower (`~get_cog_progress`) — read those RS2 procs manually
- Prose wiki with no registry match: Mage Arena, Barcrawl (not in quest list)

## Authoring a quest script

1. **Check** `wiki/quests/index.json` for the quest slug (e.g. `romeojuliet`).
2. **Read** `wiki/quests/{wiki-slug}.generated.md` for:
   - `%varp` and state constants (`romeojuliet_spoken_juliet` = 20)
   - Journal hint (what to do at each state)
   - NPC config + **spawn coords** `(x, z, level)`
   - Dialog strings for `sdk.clickDialogByText(/…/i)`
   - Items consumed / required (`julietmessage`, `cadava`, …)
3. **Put the script** in `bots/quests/{name}.ts` with `{botname}` argv (see
   `bots/quests/romeo-and-juliet.ts`, `vampire-slayer.ts`). Do not copy per
   character — roster points at the shared file.
4. **Walk routes** are still hand-tuned when pathfinder misbehaves; generated
   NPC coords are interaction targets, not full routes. Reuse `movement.ts` /
   `tiles.ts` where a grind route already passes nearby.
5. **Resume-safe**: gate on inventory + dialog state like existing quest scripts;
   varp is not exposed on SDK state — infer progress from items and NPC dialog.

## Validate before calling it done

- Diff generated dialog strings against your `clickDialogByText` / `chat()` regexes.
- NPC coords in the script should match generated spawns (e.g. Romeo `3211,3425`).
- Short test run: `bun bots/quests/{quest}.ts {botname}` (~30s first), then
  `bun sdk/cli.ts {botname}` after.
- Complex quests (Underground Pass, Legends, puzzle boxes) will have incomplete
  generated steps — read `server/content/scripts/quests/` and area scripts
  directly; SDK may lack puzzle helpers (see Discord / Max on Freminnik trials).

## Source map (when generated data is thin)

| Need | Where |
|------|--------|
| Quest registry (slug → varp → complete) | `server/content/scripts/general/scripts/quests.rs2` `[proc,update_questlist]` |
| State constants | `quest_*/configs/*.constant`, `general/configs/quest.constant` |
| Journal text per state | `*_journal.rs2` or `questlist:` button scripts |
| NPC dialog + varp transitions | `areas/**/scripts/*.rs2`, `quests/**/scripts/*.rs2` — grep `%varpname` |
| NPC display names | `*.npc` configs |
| Item display names | `*.obj` configs |
| Agility obstacle order | grep varp in course `.rs2` (see `wildy-course.ts` comment pattern) |

## Do not

- Replace `wiki/quests/*.md` prose with generated files — keep both.
- Guess dialog option **indices** — use label text from generated data.
- Commit regenerated output without running the generator (stale index.json
  misleads agents).

Existing canaries: `wiki/quests/romeo-and-juliet.generated.md`,
`bots/quests/romeo-and-juliet.ts`, `wiki/generate-quests.ts`.
