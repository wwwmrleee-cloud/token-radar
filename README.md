# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wwwmrleee-cloud/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wwwmrleee-cloud/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: the pre-token DeFi protocols ranked by implied value, each with a 7-step farm plan. It reads a sealed DefiLlama snapshot (758 protocols), applies the watchlist's own eligibility rule to all of them, and ranks the 206 that pass — the 40 on the watchlist plus 166 early ones below the floor, across 117 chains and 34 categories. A versioned name (V2, V3) is set aside only when its unversioned parent already trades or is already ranked; otherwise its largest-TVL version is ranked. Implied value is a model, not a price: the base multiple is the live market's own median mcap/TVL in the same snapshot (0.2138x), moved by 7-day growth, by how long the protocol has run with no token, and by how many chains it runs on. Live-token protocols are set aside with their market caps. The dashboard is a static page with no network: a sortable, filterable board (search, category, chain, scope, minimum TVL, CSV export), a detail view for every protocol with its model breakdown, momentum in context, category rank and farm plan, a live-token view (40 rows; 11 extreme-ratio outliers and 283 no-market-cap records set aside and named), chain and category boards, a surging-this-week and new-on-the-board strip, a personal watchlist with snapshot-checked alerts, and a model lab that re-ranks the board live.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. `main.ts` (Node 22, standard library only) reads the snapshot, writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wp8y7q6s&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
