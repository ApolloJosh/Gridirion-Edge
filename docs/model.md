# The projection model, and the backtest behind it

Every constant in `analyze()` comes from the experiment below. Nothing here is a guess or a
plausible-sounding coefficient — where the data said a factor doesn't work, it was turned off
rather than kept for appearances.

## Method

- **Sample**: 198 players (57 RB, 100 WR/TE, 41 QB), 3,084 player-games, 2025 regular season.
- **Holdout**: predict each player-game in week W using *only* weeks < W. Team defensive and
  pace metrics are likewise recomputed as-of week W, so no future information leaks in.
- **Qualifiers**: W ≥ 6, player has ≥ 4 prior games, opponent has ≥ 3 games played.
- **Metric**: mean absolute error (MAE), with RMSE and a paired t-test against the baseline.
- **Data**: 272 game box scores (544 team-game rows) + per-player game logs, all from ESPN.

## Result 1 — opponent *rushing* defense does not predict RB yards

| Model | MAE | vs baseline |
|---|---|---|
| Season average (baseline) | 26.56 | — |
| ±12% rank multiplier (the old shipping model) | 26.50 | −0.2% |
| Blend 60/40 season+last3 | 26.68 | +0.4% |
| × opponent YPC allowed, capped | 26.90 | +1.3% |
| Rate model (carries × YPC × opponent) | 27.04 | +1.8% |
| × opponent rush yards allowed per game | 27.06 | +1.9% |

Shrinkage sweep on the opponent ratio — exponent `k` in `seasonMean × ratio^k`:

| k | 0 | 0.1 | 0.25 | 0.5 | 0.75 | 1.0 |
|---|---|---|---|---|---|---|
| MAE | 26.565 | **26.564** | 26.587 | 26.678 | 26.834 | 27.043 |

The optimum is `k ≈ 0.1`, which is "almost entirely off". Paired improvement over baseline:
**0.001 yards, t = 0.04** — indistinguishable from zero. Correlation between the opponent's
rushing defense and the prediction residual: **0.049** (r² ≈ 0.2%).

Decomposing made it worse, not better:

- Opponent-adjusting YPC: MAE 1.610 → **1.621**
- Pace-adjusting carries: MAE 4.305 → **4.399**

This is not a bug in the data — it's a real property of team rushing-defense statistics. They
are dominated by game script. Teams that lead get run on; teams that trail face passing. The
season aggregate mostly measures how often a defense was ahead, not how well it stops runs.

## Result 2 — opponent *passing* defense does predict, mildly

| QB passing yards | MAE |
|---|---|
| Season × opponent pass ratio ^0.25 | **64.65** |
| Season × opponent pass ratio ^1.0 | 65.27 |
| Season average | 65.35 |
| Last 3 games | 70.21 |

Residual correlation with opponent pass defense: **0.141** — an order of magnitude above the
rushing equivalent. WR/TE receiving yards show the same sign, smaller: 26.49 vs 26.57.

So the tool applies an opponent factor to passing at `^0.25` and to rushing at `^0.10`. The
asymmetry is measured, not assumed.

## Result 3 — recency helps volume, hurts passing

| RB carries | MAE |
|---|---|
| 50/50 season + last 3 | **4.197** |
| 70/30 season + last 3 | 4.208 |
| Season average | 4.305 |
| Last 3 only | 4.369 |

Carries respond to recency because workload genuinely changes — injuries, committee shifts,
role changes. Passing yardage does not: last-3 is 7% worse than the season average for QBs.
So carries blend 50/50, and passing volume does not blend at all.

## Result 4 — the range is trustworthy; the point estimate is not

Median player coefficient of variation: **0.599**. A back averaging 65 rushing yards has a
game-to-game standard deviation near 39 yards. Every matchup adjustment discussed above moves
the projection by single-digit yards — inside a ±39-yard band.

But the empirical distribution is well calibrated. Taking each player's prior game log and
forming a 25th–75th percentile band, the actual result landed inside it **47.7%** of the time
against an ideal of 50%.

That is the finding the UI is built around: **show the range, demote the point estimate.**
Prior mean is a marginally better point estimate than prior median (MAE 32.72 vs 33.00), so
the mean is what's shown — but the band is the headline.

## Result 5 — past hit rate is mean-reverting, not predictive

Correlation between a player's first-half over-rate and his second-half over-rate, against a
fixed line: **−0.41**. Negative.

Part of that is mechanical (using the full-season mean as the line forces reversion), but the
direction is a warning worth heeding: "he's gone over in 8 of his last 10" is one of the
oldest traps in prop betting. The hit-rate readout in the UI carries that caveat inline.

## What is *not* validated

**Vegas implied team totals.** ESPN serves odds for upcoming games only — of 272 completed
2025 games, **0** retained closing lines. So the implied-total factor could not be backtested
here and is presented as context rather than baked into the yardage projection. A pregame
scoring-environment proxy (own PPG + opponent PPG allowed) was testable and came out weak:
correlation 0.099 with rushing yards, −0.002 with carries.

Validating it properly needs a historical closing-line dataset, which ESPN does not provide.

## Re-running this

The harness is in `docs/backtest.js`. It builds the season database from box scores, pulls
game logs, and prints the tables above. Re-run it after each season and update the exponents
if they move.
