# Gridiron Edge 🏈

NFL matchup analysis tool for identifying betting edges. Built by Apollo Media.

Sister project to [Diamond Edge](https://github.com/ApolloJosh/diamond-edge) (MLB).

## What it does

Pulls live data from ESPN's public NFL API and grades offensive production against the
specific defense it's facing, for every game on the slate:

- **QB vs pass defense** — passer rating, YPA, completion %, TD%, INT%
- **WR/TE vs secondary** — yards per game, targets per game, YPR, receptions, TDs
- **RB vs run defense** — yards per game, carries per game, YPC, TDs, receiving work
- **Defensive league ranks** — every opponent is scored 1–32 on points allowed, pass
  defense, run defense, coverage and pressure, so a good player against a bad defense
  reads differently than a good player against an elite one
- **EDGE score** — 0–100 per player: 60% production grade, 40% how exploitable the
  opposing defense is by rank. Both inputs stay visible on screen.
- **Weather flags** — wind gusts 15+ mph and sub-35°F, suppressed automatically for domes
- **Injury report** — pulled from ESPN's game summary feed, flagged inline on each player
- **Divisional flag** — divisional matchups trend under
- **Week selector** — any week of the regular season or postseason, current or prior years

## How to use it

Open `index.html` in any browser. No build step, no install, no account, no API key.
Requires an internet connection to pull live ESPN data.

## How the EDGE score works

```
EDGE = (player production grade × 0.60) + (opposing defense softness × 0.40)
```

Production grade averages the color-graded stat tiers for that player's position.
Defense softness is the opponent's league rank (1 = toughest, 32 = softest) normalized 0–1.

| EDGE | Read |
|---|---|
| 72+ | Smash spot |
| 58–71 | Lean |
| 42–57 | Neutral |
| 28–41 | Soft fade |
| < 28 | Fade |

**Honest limitations.** ESPN's public feed does not expose yards allowed by position or
DVOA. Points allowed is *total* defense, not split pass/rush. The pass-defense and
run-defense ranks are composites of sack rate, passes-defended rate, run-stuff rate and
tackles-for-loss rate — directional signals, not opponent-adjusted efficiency. Treat EDGE
as a shortlist generator, then price it against your book's actual number.

## Data source

ESPN public APIs — free, no key needed. See [`docs/api-notes.md`](docs/api-notes.md) for
verified endpoints and the fields that lie.

Early in a new season ESPN still reports the prior year's totals; the tool detects this,
falls back automatically, and labels which season each stat came from.

## Roadmap

- [ ] True yards allowed by position (requires aggregating opponent box scores)
- [ ] Line movement tracker (reverse line movement, key number alerts at 3 / 7 / 10)
- [ ] Player prop comparison vs the book's posted line
- [ ] Short-week and off-bye situational flags
- [ ] Backup QB detection (lines lag QB news)
- [ ] Depth chart ordering instead of production ordering for early-season slates

## Stack

Vanilla HTML + React via CDN + ESPN public APIs. No framework, no build tooling, no
dependencies to install.

---

Part of the Apollo Media sports tools suite. For entertainment and research purposes —
nothing here is financial advice.
