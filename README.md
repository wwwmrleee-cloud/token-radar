# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wwwmrleee-cloud/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wwwmrleee-cloud/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: the pre-token DeFi protocols ranked by implied value, each with a 7-step farm plan. It reads a sealed DefiLlama snapshot (758 protocols), applies the watchlist's own eligibility rule to all of them, and ranks the 196 that pass — the 40 on the watchlist plus 156 early ones below the floor. Implied value is a model, not a price: the base multiple is the live market's own median mcap/TVL in the same snapshot (0.2138x), moved by 7-day growth, by how long the protocol has run with no token, and by how many chains it runs on. Live-token protocols are set aside with their market caps. The dashboard is a static page with no network: a sortable, filterable board, a detail view for every protocol with its model breakdown and farm plan, a live-token view, and a model lab that re-ranks the board live.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. `main.ts` (Node 22, standard library only) reads the snapshot, writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wp8y7q6s&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
