# Gridiron Edge 🏈

NFL matchup analysis tool for identifying betting edges. Built by Apollo Media.

Sister project to [Diamond Edge](https://github.com/ApolloJosh/diamond-edge) (MLB).

## What it does

Pulls live data from ESPN's public NFL API and, for every player on the slate, separates
**what he has actually done** from **what to expect this week**:

- **Season block** — real production, color-graded against fixed tiers
- **Projected line** — that season baseline run through a chain of matchup factors,
  with every factor and its multiplier shown on the card

Covered positions:

- **QB** — yards/game, passer rating, YPA, completion %, TD%, INT%, TD/game, rush yards/game
- **WR / TE** — yards/game, targets/game, receptions/game, YPR, TDs
- **RB** — yards/game, carries/game, YPC, receptions/game, TDs
- **Defenders** — tackles/game, sacks/game, INTs/game, passes defended, TFL, forced fumbles
  for the six most productive players on the defense being faced

Plus: league-wide defensive ranks (1–32) for every opponent, weather flags, injury report,
divisional-game flag, bye teams, and a week selector for any week of any recent season.

## The projection model

```
projected line = season per-game baseline × factor₁ × factor₂ × …
```

Each factor declares whether it is modeled yet, so the card shows the full intended chain
and marks what is still pending. Adding a factor is one object in `buildFactors()`.

| Factor | Status | How it works |
|---|---|---|
| Opponent defense vs position | **active** | Opponent's pass-D or run-D league rank mapped to a multiplier, capped at ±12% (rank 1 → ×0.88, rank 32 → ×1.12) |
| Weather | **active** | Wind gusts and cold suppress passing, mildly help rushing; domes are exempt |
| Defensive-player volume | **active** | Opposing offense's scoring rank as a snap-volume proxy, capped at ±8% |
| Kickoff window / game script | *pending* | Declared, multiplier 1.000, not yet modeled |
| Defense vs archetype | *pending* | Needs charting data ESPN doesn't expose publicly |

**Archetypes are already classified** from production shape — Deep threat, Volume WR1,
Possession WR, Receiving back, Bruiser, Explosive back, Move TE, Dual threat, Pocket passer.
The classification is live and tagged on each card; what's missing is the *defense vs that
archetype* half, which requires slot/wide snap counts and box-count data. Rather than invent
a number, that factor renders as pending.

### EDGE score

Still on every card: 0–100, 60% production grade + 40% opponent softness by rank.

| EDGE | Read |
|---|---|
| 72+ | Smash spot |
| 58–71 | Lean |
| 42–57 | Neutral |
| 28–41 | Soft fade |
| < 28 | Fade |

**Honest limitations.** ESPN's public feed does not expose yards allowed by position or
DVOA. Points allowed is *total* defense, not split pass/rush. The pass-D and run-D ranks are
composites of sack rate, passes-defended rate, run-stuff rate and tackles-for-loss rate —
directional signals, not opponent-adjusted efficiency. Treat a projection as a shortlist
generator, then price it against your book's actual number.

## How to use it

Open `index.html` in any browser. No build step, no install, no account, no API key.
Requires an internet connection to pull live ESPN data.

## Design

Field green with white chalk lines, goalpost-yellow accents for projections and highlights,
and football-leather brown for shadows and the projection plate. Barlow Condensed for
numbers, Inter for body text.

## Data source

ESPN public APIs — free, no key needed. See [`docs/api-notes.md`](docs/api-notes.md) for
verified endpoints and the fields that lie.

Early in a new season ESPN still reports the prior year's totals; the tool detects this,
falls back automatically, and labels which season each stat came from.

## Roadmap

- [ ] Verify defensive athlete stat field names against a live response (see api-notes §8)
- [ ] Model the kickoff-window / game-script factor
- [ ] Defense vs archetype (needs a charting data source — PFF, Sports Info Solutions)
- [ ] True yards allowed by position (requires aggregating opponent box scores)
- [ ] Line movement tracker (reverse line movement, key numbers at 3 / 7 / 10)
- [ ] Player prop comparison vs the book's posted line
- [ ] Depth chart ordering instead of production ordering for early-season slates

## Stack

Vanilla HTML + React via CDN + ESPN public APIs. No framework, no build tooling, no
dependencies to install.

---

Part of the Apollo Media sports tools suite. For entertainment and research purposes —
nothing here is financial advice.
