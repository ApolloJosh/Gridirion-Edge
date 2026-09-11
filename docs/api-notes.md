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

## 8. The bulk endpoint — the whole league in one request

```
https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/statistics/byathlete
  ?region=us&lang=en&contentorigin=espn&isqualified=false
  &season={year}&seasontype=2&page=1&limit={n}&sort={category.field}:desc
```

Verified: `limit=250` returns 250 athletes, all 32 teams represented, every stat category
attached. This is what makes the Edge Board possible — scanning the slate by roster would be
roughly 2,000 athlete calls; five sorted pulls here cover the league in about two seconds.

Sorts in use: `passing.passingYards:desc`, `receiving.receivingYards:desc`,
`rushing.rushingYards:desc`, `defensive.totalTackles:desc`, `defensive.sacks:desc`.
Players appear in several pulls, so de-duplicate by athlete id.

**Its shape differs from the per-athlete feed.** Each athlete's `categories[]` carry a
`values` array with no field names on it; the schema lives at the **response** level in
`categories[].names`. Zip them by position:

```js
const schema = {};
(d.categories || []).forEach(c => { schema[c.name] = c.names || []; });
// then per athlete category: schema[c.name][i] -> c.values[i]
```

`count` and `pageCount` come back undefined and `pagination` is an empty object — page by
asking for a bigger `limit` rather than trusting a page count.

### 8a. Verified defensive field names

```
general:                 gamesPlayed, fumblesForced, fumblesRecovered, fumblesTouchdowns
defensive:               soloTackles, assistTackles, totalTackles, sacks, sackYards,
                         tacklesForLoss, passesDefended, longInterception
defensiveinterceptions:  interceptions, interceptionYards, interceptionTouchdowns
```

Note the casing: the bulk feed spells it **`defensiveinterceptions`** (all lowercase) while
the team-level feed uses `defensiveInterceptions`. `statOf()` is therefore case-insensitive.

It is also **scoped**, and that matters more than the casing: `interceptions` means *thrown*
picks inside `passing` and *caught* picks inside `defensiveinterceptions`. Reading it
globally would credit a quarterback's giveaways to a safety.

## 9. The bulk feed reports the team a player played for THAT SEASON

Not his current team. Combined with the season fallback (§ below), that means a scan run in
September is filing players under last year's rosters. Measured at Week 1 of 2026: **157 of
684 players in the slate had changed teams** — 23% of the board would have been matched
against the wrong defense.

The Edge Board fixes this by fetching the 32 current rosters for the week's games and
building an `athleteId → current team` map that overrides the stats feed. Players whose
production came with another team are tagged `stats w/ {OLD}` on the row, because the
production itself is still from a different offense and deserves a second look.

Spot-verified at Week 1 2026: Travis Etienne Jr. → NO, Kenny Gainwell → TB,
Wan'Dale Robinson → TEN, all confirmed against the live roster endpoint.

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
