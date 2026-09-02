# Contract: Intent and interface success

## Local intent

`BotSDK.showIntent(message: string): Promise<ActionResult>`

- Dispatches `{ type: 'localChat', message, reason: 'intent' }`.
- Client writes a type-0 local game message. No server packet.
- Empty/whitespace → success, no dispatch.
- Duplicate of last shown line → success, no dispatch.
- Max 80 characters after newline collapse.

Webclient: `ActionExecutor` handles `localChat`.

## Bank open

`BotActions.openBank()` success if and only if `state.bank.isOpen === true`.

| Situation | Result |
|-----------|--------|
| Bank already open | `{ success: true, reason?: undefined }` |
| Craft / make-item dialog open | Close it; do not count as bank |
| Other non-shop interface open | Close it before interacting with booth |
| Cannot path to booth | `{ success: false, reason: 'cant_reach' }` |
| Wait budget exceeded and bank still closed | `{ success: false, reason: 'timeout' }` |

`interface.isOpen` MUST NOT be treated as bank success.

## Shop open

`BotActions.openShop()` already returns structured `reason`. This feature keeps:

- `cant_reach` → `withDoorRetry`
- talk-then-shop fallback when no Trade option
- do not open trapdoors/manholes/hatches during that retry

## Walk blocked start

When `sendFindPath` returns no waypoints and the current tile is not walkable, `walkTo` steps to `nearestWalkableTile` (max 3 times) before failing.

## Door retry filter

`tryOpenBlockingDoor` and walkTo's openable-loc scan exclude loc names matching `/trapdoor|manhole|hatch/i`.

## Grind log severity (Ghostty)

Canonical prefix on each file line (ISO timestamp already present):

```text
2026-08-22T07:18:03Z LOG Banked 28 essence | trip 3
2026-08-22T07:18:28Z WARN teleport: nothing happened
2026-08-22T07:19:00Z ERROR recovery exhausted phase=teleport @ 3253,3401
```

`bots/watch-fleet.sh` tails with color: LOG default/dim, WARN yellow, ERROR red. ERROR must be the attention color.
