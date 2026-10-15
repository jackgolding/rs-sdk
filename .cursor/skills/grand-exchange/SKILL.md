---
name: grand-exchange
description: >-
  Check public Grand Exchange quotes and open books, default-sorted newest
  last trade first. Use when the user asks to check the GE, Grand Exchange,
  market prices, offers, bid/ask, or /market.
---

# Grand Exchange

Read the **public** market. Do not walk to Varrock, open the exchange, or take
control of any bot. Individual offer owners are not in the API.

## Do this every time

1. From the **repo root**, dump quotes newest-first:

   ```bash
   bun .cursor/skills/grand-exchange/scripts/dump-ge.ts
   ```

   JSON on stdout. Origin comes from the first roster `bot.env` `SERVER`
   (else `https://rs-sdk-demo.fly.dev`). Override with `--origin`.

   ```bash
   bun .cursor/skills/grand-exchange/scripts/dump-ge.ts --q "rune scim" --limit 25
   bun .cursor/skills/grand-exchange/scripts/dump-ge.ts --sort buyValue --days 7
   bun .cursor/skills/grand-exchange/scripts/dump-ge.ts --origin https://rs-sdk-demo.fly.dev
   ```

2. Read `~/.cursor/skills-cursor/canvas/SKILL.md` and write
   `.canvas.tsx` under the workspace `canvases/` directory. Import only from
   `cursor/canvas`. Embed the dump inline — no `fetch()`.

3. Link
   `[grand-exchange](/Users/<user>/.cursor/projects/<workspace>/canvases/grand-exchange.canvas.tsx)`.
   Chat: one-line summary (featured item, 24h/7d volume or newest trades), then
   the canvas link. Do not paste the offer table.

## Dump rules

- HTTP **GET** only via `MarketClient` / this script. Game origin, not the
  gateway port.
- Default `--sort recent`: items with a last execution, **newest `lastTradeAt`
  first**. That is the "newest to oldest" ranking. `days` only changes
  volume/gross/vwap/change, not last-trade order.
- Other sorts when asked: `buyValue` (open buy books), `volume`, `price`,
  `rises` / `falls`, `name`.
- `--limit` max 100. Paginate with `--offset` if they want more.
- `enabled: false` / `GEUnavailableError` means GE is off on that world — say
  so; do not invent quotes.
- Quotes are a 5s cache. Bid/ask can move before anyone reaches the table.

## Canvas shape

- Title the finding (newest fills, hottest book), not "Market".
- Summary `Stat`s: listed rows, period volume, period gross, items with an
  open book (`buyQuantity` or `sellQuantity` > 0).
- `Table` newest-first unless the dump used another `--sort`: Item, Bid, Ask,
  Buy qty, Sell qty, Last, Last trade (relative, e.g. `12m ago`), Volume
  (period). Right-align numbers. Sticky header.
- Search/filter with `useCanvasState` (`all` / `open book` / `traded in period`).
- Caption: origin, `updatedAt`, `days`, `sort`.
- Host theme tokens. No gradients, emojis, or box-shadows.

## Do not

- `bot.openGE()`, `placeGEOffer`, cancel/collect, or `sdk.getGEState()`.
  Private slots need an open table session and would steal the controller.
- Hit `GET /gateway/state/:bot` on fly.dev.
- Claim a bid/ask row is a single player's offer.
