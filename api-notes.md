# ESPN NFL API notes

Everything below was verified against live responses. The traps section exists because
each one returned **HTTP 200 with useless data** — the failure mode that cost the most
time on the Diamond Edge (MLB) build.

## Endpoints in use

| Purpose | URL |
|---|---|
| Slate for a week | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week={n}&dates={year}` |
| Current week discovery | same URL with no parameters |
| Standings (points allowed, records) | `https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season={year}` |
| Team + roster | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{teamId}?enable=roster` |
| Athlete season stats | `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}/stats` |
| Team defensive stats | `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/types/2/teams/{teamId}/statistics` |
| Weather + injuries | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={eventId}` |

No API key. No rate limit hit at ~40 requests per game view.

## Traps — verified, do not "fix" these back

**1. `team.athletes` is a flat array.**
With `?enable=roster` the roster comes back as a flat list of ~77 athlete objects, each
carrying its own `position`. It is *not* grouped into `{ position, items: [] }`. Code that
loops `group.items` silently yields zero players.

**2. Athlete stats are at `categories[].statistics[]`, not `splits.categories[].stats[]`.**
Each `statistics[]` entry is one **season** of a career. Its `stats` array is positionally
parallel to the category's `names` array — you index by position, not by key lookup:

```js
names.forEach((n, i) => { values[n] = latest.stats[i]; });
```

Real field names: `QBRating`, `adjQBR`, `completionPct`, `passingYards`,
`yardsPerPassAttempt`, `passingTouchdowns`, `interceptions`, `rushingAttempts`,
`rushingYards`, `yardsPerRushAttempt`, `rushingTouchdowns`, `receptions`,
`receivingTargets`, `receivingYards`, `yardsPerReception`, `receivingTouchdowns`,
`gamesPlayed`. There is no `YPA`, `TD%`, `INT%` or `passerRating` field — the percentages
are computed from attempts.

Values are display strings with thousands separators (`"2,267"`). Strip commas before
`parseFloat`.

**3. `yardsAllowed` and `pointsAllowed` in the core `defensive` category are always 0.**
Both fields exist on all 32 teams and both return `0` while the response is HTTP 200.
Real points allowed comes from the **standings** endpoint (`pointsAgainst`), which also
gives wins/losses/ties for the per-game divisor — all 32 teams in one request.

Fields in that category that *are* real: `sacks`, `passesDefended`, `stuffs`,
`tacklesForLoss`, `soloTackles`, `totalTackles`, `teamGamesPlayed`.

**4. The `/teams` list endpoint is not CORS-open.**
`.../nfl/teams` fails with `TypeError: Failed to fetch` from any origin other than ESPN's
own, so it can't be used from a `file://` page. The team id → abbreviation map is built
from the standings response instead. The scoreboard, standings, athlete-stats, core-stats
and summary endpoints all send permissive CORS headers and work fine from `file://`.

**5. Weather has no `windSpeed` field.**
`summary.gameInfo.weather` returns `temperature`, `highTemperature`, `conditionId` and
`gust`. Use `gust` as the wind proxy. The scoreboard's own `competitions[].weather` is
frequently absent entirely on unplayed games, so the summary endpoint is the reliable read.
Dome games still report outdoor conditions — check `venue.indoor` before flagging wind.

**6. Rosters are not in depth-chart order.**
The QB list for a team can come back with the third-stringer first. Players are ranked by
season volume (pass attempts / receiving yards / carries) rather than array order. Early in
a season, before volume exists, this ordering is unreliable — a real depth chart endpoint
is on the roadmap.

**7. Verify player IDs before debugging anything else.**
Carried over from the MLB build, where a long debugging session was spent on ID 605612
(Harold Castro, an infielder) while trying to diagnose Seth Lugo's pitching splits
(actual ID 607625). Check the name that comes back before assuming the endpoint is broken.

## 8. UNVERIFIED — defensive athlete stat field names

Everything above was probed against live responses. **This section was not.** ESPN was
unreachable from both shells when the defensive-player feature was built, so the field names
for individual defenders are inferred from the *team-level* feed, which does expose
`totalTackles`, `soloTackles`, `sacks`, `passesDefended`, `tacklesForLoss` and a separate
`defensiveInterceptions` category.

Because of that, defensive stats are read through `statOf()`, which scans every category for
a list of candidate names rather than trusting one:

```js
defStat(stats, ["totalTackles", "tackles", "combinedTackles"])
```

Category order matters and is the reason the helper is scoped rather than global:
`interceptions` means **thrown** picks inside `passing` and **caught** picks inside
`defensiveInterceptions`. Defenders are restricted to `DEF_CATS` so a quarterback's
interceptions can never be read as a defender's.

If all candidates miss, the card renders "—" and the section shows an explanatory note
instead of breaking. **To verify:** fetch any defender's stats and print the category names
and their `names` arrays —

```js
const d = await (await fetch("https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}/stats")).json();
d.categories.map(c => ({ name: c.name, fields: c.names }));
```

then fix the candidate lists in `statOf` calls if they differ. Also confirm whether
`gamesPlayed` is present on a defensive category — without it the per-game rates fall back
to showing season totals only.

## Season rollover

In early September the new season exists on the scoreboard but every stat endpoint still
holds only the prior year. `getAthleteSeason()` picks the highest season year present, and
`getLeagueDefense()` falls back a year when the current season lacks a usable sample. The
season used is labeled in the UI so a stale number is never presented as current.

**Week 1 is a trap for the fallback test.** After a Thursday opener the standings show two
teams with one game played and thirty with none. A "no games played league-wide" check
therefore does *not* trigger, and the tool computes ranks off a two-team sample — 30 teams
tie on a default and the resulting pass-defense and run-defense ranks come back identical
and meaningless. The test is the **median** team's games played (`>= 4`), not the sum.

Verified: with the median rule at Week 1 of 2026, the tool falls back to 2025 and returns
all 32 teams with real separation (SEA 17.2 PPG allowed, DAL 30.1), and pass-defense and
run-defense ranks differ from one another as they should.
