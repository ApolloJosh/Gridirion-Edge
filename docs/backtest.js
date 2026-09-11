/**
 * Gridiron Edge — model backtest harness
 *
 * Paste into the browser console on any page whose origin isn't ESPN
 * (the endpoints are CORS-open, a file:// page works too), then:
 *
 *    await gxBacktest()
 *
 * It rebuilds the season database from box scores, pulls player game logs, and
 * re-runs every experiment behind docs/model.md. Holdout discipline: a game in
 * week W is predicted using only weeks < W, for both player and team metrics.
 *
 * Re-run after each season. If the optimal exponents move, update the model
 * constants in index.html and the tables in docs/model.md.
 */
async function gxBacktest(SEASON = 2025) {
  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
  const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl";
  const sj = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
  const N = (v) => { if (v == null || v === "-") return NaN; const n = parseFloat(String(v).replace(/,/g, "")); return isNaN(n) ? NaN : n; };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  async function pool(a, l, fn) {
    const o = new Array(a.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(l, a.length) }, async () => {
      while (i < a.length) { const x = i++; o[x] = await fn(a[x], x); }
    }));
    return o;
  }
  function corr(xs, ys) {
    const mx = mean(xs), my = mean(ys); let n = 0, dx = 0, dy = 0;
    xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); dx += (x - mx) ** 2; dy += (ys[i] - my) ** 2; });
    return n / Math.sqrt(dx * dy);
  }

  /* ---------- 1. season database from box scores ---------- */
  console.log("Building season database…");
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const boards = await pool(weeks, 6, (w) => sj(`${ESPN}/scoreboard?seasontype=2&week=${w}&dates=${SEASON}`));
  const events = [];
  boards.forEach((b, i) => (b?.events || []).forEach((e) => {
    if (e.competitions?.[0]?.status?.type?.state === "post") events.push({ id: e.id, week: i + 1 });
  }));
  const sums = await pool(events.map((e) => e.id), 8, (id) => sj(`${ESPN}/summary?event=${id}`));
  const TG = [];
  sums.forEach((s, i) => {
    const bt = s?.boxscore?.teams; if (!bt || bt.length !== 2) return;
    const comps = s?.header?.competitions?.[0]?.competitors || [];
    const score = {}; comps.forEach((c) => { score[c.team?.abbreviation] = N(c.score); });
    const g = (t, n) => { const x = (t.statistics || []).find((y) => y.name === n); return x ? x.displayValue : null; };
    const ab = bt.map((t) => t.team?.abbreviation);
    bt.forEach((t, k) => {
      const ca = (g(t, "completionAttempts") || "0/0").split("/");
      TG.push({
        week: events[i].week, team: ab[k], opp: ab[1 - k],
        plays: N(g(t, "totalOffensivePlays")), rushYds: N(g(t, "rushingYards")),
        rushAtt: N(g(t, "rushingAttempts")), passYds: N(g(t, "netPassingYards")),
        passAtt: N(ca[1]), pts: score[ab[k]],
      });
    });
  });
  console.log(`  ${events.length} games, ${TG.length} team-game rows`);

  /* ---------- 2. player game logs ---------- */
  const B = `${WEB}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=false&season=${SEASON}&seasontype=2&page=1`;
  const bulk = async (sort, limit) => {
    const d = await sj(`${B}&limit=${limit}&sort=${encodeURIComponent(sort)}`);
    return (d?.athletes || []).map((a) => ({
      id: a.athlete?.id, pos: a.athlete?.position?.abbreviation, team: a.athlete?.teamShortName,
    })).filter((x) => x.id);
  };
  const [rb, wr, qb] = await Promise.all([
    bulk("rushing.rushingYards:desc", 70),
    bulk("receiving.receivingYards:desc", 110),
    bulk("passing.passingYards:desc", 45),
  ]);
  const seen = new Set(), roster = [];
  [...qb, ...rb, ...wr].forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); roster.push(p); } });
  const logs = await pool(roster, 8, (p) => sj(`${WEB}/athletes/${p.id}/gamelog?season=${SEASON}`));
  const PL = [];
  roster.forEach((p, i) => {
    const gl = logs[i]; if (!gl?.names || !gl?.events) return;
    const byId = {};
    (gl.seasonTypes || []).forEach((st) => (st.categories || []).forEach((c) =>
      (c.events || []).forEach((e) => { byId[e.eventId] = e.stats; })));
    const games = [];
    Object.entries(gl.events).forEach(([eid, meta]) => {
      const s = byId[eid]; if (!s) return;
      const o = {}; gl.names.forEach((n, k) => { if (o[n] === undefined) o[n] = N(s[k]); });
      games.push({ week: meta.week, opp: meta.opponent?.abbreviation, stats: o });
    });
    games.sort((a, b) => a.week - b.week);
    if (games.length >= 6) PL.push({ ...p, games });
  });
  console.log(`  ${PL.length} players, ${PL.reduce((a, p) => a + p.games.length, 0)} player-games`);

  /* ---------- 3. as-of-week context (no leakage) ---------- */
  const cache = {};
  function ctxAsOf(W) {
    if (cache[W]) return cache[W];
    const prior = TG.filter((r) => r.week < W);
    const off = {}, def = {};
    prior.forEach((r) => {
      const o = off[r.team] = off[r.team] || { g: 0, plays: 0, rushAtt: 0, pts: 0 };
      o.g++; o.plays += r.plays; o.rushAtt += r.rushAtt; o.pts += r.pts;
      const d = def[r.opp] = def[r.opp] || { g: 0, plays: 0, rushYds: 0, rushAtt: 0, passYds: 0, pts: 0 };
      d.g++; d.plays += r.plays; d.rushYds += r.rushYds; d.rushAtt += r.rushAtt; d.passYds += r.passYds; d.pts += r.pts;
    });
    let ly = 0, la = 0;
    prior.forEach((r) => { ly += r.rushYds; la += r.rushAtt; });
    cache[W] = {
      off, def, leagueYpc: ly / la,
      leagueRushPg: mean(prior.map((r) => r.rushYds)),
      leaguePassPg: mean(prior.map((r) => r.passYds)),
      leaguePlays: mean(prior.map((r) => r.plays)),
    };
    return cache[W];
  }

  function sample(posOK, statKey) {
    const S = [];
    for (const p of PL) {
      if (!posOK(p.pos)) continue;
      for (const g of p.games) {
        const W = g.week; if (W < 6) continue;
        const prior = p.games.filter((x) => x.week < W); if (prior.length < 4) continue;
        const act = g.stats[statKey]; if (isNaN(act)) continue;
        const ctx = ctxAsOf(W); const D = ctx.def[g.opp]; if (!D || D.g < 3) continue;
        const v = prior.map((x) => x.stats[statKey] || 0);
        const ra = prior.map((x) => x.stats.rushingAttempts || 0);
        S.push({
          act, seasonMean: mean(v), last3: mean(v.slice(-3)),
          carriesPg: mean(ra), carriesLast3: mean(ra.slice(-3)),
          actCarries: g.stats.rushingAttempts,
          rushRatio: (D.rushYds / D.g) / ctx.leagueRushPg,
          ypcRatio: (D.rushAtt ? D.rushYds / D.rushAtt : ctx.leagueYpc) / ctx.leagueYpc,
          passRatio: (D.passYds / D.g) / ctx.leaguePassPg,
        });
      }
    }
    return S;
  }

  const MAE = (S, f, key = "act") => mean(S.map((s) => Math.abs(f(s) - s[key])));
  const out = {};

  /* ---------- 4. experiments ---------- */
  const RB = sample((p) => ["RB", "FB"].includes(p), "rushingYards");
  out.rbShrinkSweep = [0, .1, .25, .5, .75, 1].map((k) => ({
    k, MAE: +MAE(RB, (s) => s.seasonMean * Math.pow(s.rushRatio, k)).toFixed(3),
  }));
  out.rbResidualCorr = +corr(RB.map((s) => s.rushRatio), RB.map((s) => s.act - s.seasonMean)).toFixed(4);
  out.rbCarries = [
    { m: "season", MAE: +MAE(RB, (s) => s.carriesPg, "actCarries").toFixed(3) },
    { m: "last3", MAE: +MAE(RB, (s) => s.carriesLast3, "actCarries").toFixed(3) },
    { m: "50/50", MAE: +MAE(RB, (s) => .5 * s.carriesPg + .5 * s.carriesLast3, "actCarries").toFixed(3) },
    { m: "70/30", MAE: +MAE(RB, (s) => .7 * s.carriesPg + .3 * s.carriesLast3, "actCarries").toFixed(3) },
  ].sort((a, b) => a.MAE - b.MAE);

  const QB = sample((p) => p === "QB", "passingYards");
  const WR = sample((p) => ["WR", "TE"].includes(p), "receivingYards");
  const passSweep = (S) => [0, .15, .25, .4, .6, 1].map((k) => ({
    k, MAE: +MAE(S, (s) => s.seasonMean * Math.pow(s.passRatio, k)).toFixed(2),
  }));
  out.qbPassSweep = passSweep(QB);
  out.wrPassSweep = passSweep(WR);
  out.qbResidualCorr = +corr(QB.map((s) => s.passRatio), QB.map((s) => s.act - s.seasonMean)).toFixed(4);

  /* ---------- 5. distribution calibration ---------- */
  let inBand = 0, m = 0;
  const key = (p) => p.pos === "QB" ? "passingYards" : ["RB", "FB"].includes(p.pos) ? "rushingYards" : "receivingYards";
  for (const p of PL) {
    for (const g of p.games) {
      const W = g.week; if (W < 8) continue;
      const prior = p.games.filter((x) => x.week < W).map((x) => x.stats[key(p)]).filter((x) => !isNaN(x));
      if (prior.length < 6) continue;
      const act = g.stats[key(p)]; if (isNaN(act)) continue;
      const s = [...prior].sort((a, b) => a - b);
      const q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
      if (act >= q(.25) && act <= q(.75)) inBand++;
      m++;
    }
  }
  out.bandCoverage = { n: m, pctInside25to75: +(inBand / m * 100).toFixed(1), ideal: 50 };

  console.table(out.rbShrinkSweep);
  console.table(out.rbCarries);
  console.table(out.qbPassSweep);
  console.log(out);
  return out;
}
if (typeof window !== "undefined") window.gxBacktest = gxBacktest;
