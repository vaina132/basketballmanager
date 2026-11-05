/** Generate a self-contained, offline browser for the locally imported reference data. */
export function renderDataBrowser(pack) {
  const embedded = JSON.stringify(pack)
    .replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; object-src 'none'">
<title>European basketball · Real data browser</title>
<style>
:root{color-scheme:dark;--bg:#101a17;--panel:#182620;--line:#314139;--ink:#f1f0e6;--muted:#aebbb2;--accent:#ff9479}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}a{color:var(--accent)}button,select,input{background:#101b16;color:var(--ink);border:1px solid #4b5b51;border-radius:7px;padding:9px 11px}button,select{cursor:pointer}button:hover{border-color:var(--accent)}button:disabled{opacity:.4;cursor:default}input:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}header{padding:30px 34px 20px;border-bottom:1px solid var(--line)}.eyebrow{color:var(--accent);font-size:11px;font-weight:750;letter-spacing:.15em;text-transform:uppercase}h1{font-size:30px;line-height:1.2;margin:8px 0 10px;letter-spacing:-.03em}p{margin:8px 0}.muted{color:var(--muted)}.topline{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.tag{border:1px solid var(--line);border-radius:20px;padding:6px 12px;white-space:nowrap;font-size:12px}.cards{display:grid;grid-template-columns:repeat(4,minmax(100px,1fr));gap:12px;max-width:960px;margin-top:24px}.card{background:var(--panel);border:1px solid var(--line);padding:14px 18px;border-radius:9px}.card strong{display:block;font-size:27px;font-weight:650}.card span{color:var(--muted);font-size:12px}.scope{margin-top:16px;color:var(--muted);font-size:13px}.scope strong{color:var(--ink)}main{padding:24px 34px}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding-bottom:18px}label{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:12px}.search{flex:1;min-width:230px}.search input{width:100%}select{max-width:270px;min-width:160px}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start}.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}.panelhead{padding:13px 16px;display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);font-size:12px}.tablewrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}th{text-align:left;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:600;background:#1c2b24}th,td{padding:11px 12px;border-bottom:1px solid #2b3c32}tbody tr:hover{background:#21362a}tbody tr.selected{background:#2d4335}td.num{text-align:right;font-variant-numeric:tabular-nums}.playerlink{color:var(--ink);background:transparent;border:0;padding:0;text-align:left;font-weight:650;max-width:230px;white-space:normal;line-height:1.4}.playerlink:hover{color:var(--accent)}.clubname{max-width:200px;white-space:normal}.pager{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 16px;font-size:12px}.pager div{display:flex;gap:8px}aside{position:sticky;top:20px}.detail{padding:20px}.avatar{width:56px;height:56px;background:#3d5143;border:1px solid #64806a;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--ink);font-size:18px;font-weight:700;margin-bottom:13px}h2{font-size:20px;line-height:1.3;margin:0 0 5px}h3{font-size:12px;margin:21px 0 10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:17px 0}dt{font-size:11px;color:var(--muted)}dd{margin:2px 0 0;font-weight:600}.history{padding:10px 0;border-bottom:1px solid var(--line);font-size:12px}.history strong{display:block}.statblock{margin-top:12px;border:1px solid var(--line);border-radius:7px;padding:12px}.statblock h4{font-size:12px;margin:0 0 2px}.statgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 6px;margin-top:13px}.statgrid strong{display:block;font-size:17px;font-variant-numeric:tabular-nums}.statgrid span{font-size:10px;color:var(--muted)}.statline{font-size:12px;margin:7px 0 0}.fine{font-size:11px;color:var(--muted)}.empty{padding:38px 20px;text-align:center;color:var(--muted)}footer{margin-top:24px;border-top:1px solid var(--line);padding:20px 0;color:var(--muted);font-size:12px}.downloads{display:flex;gap:18px;flex-wrap:wrap;margin:12px 0}.source-list{margin:8px 0;padding-left:18px;overflow-wrap:anywhere}.source-list li{padding:3px 0}details{margin-top:14px}summary{cursor:pointer;color:var(--ink)}.notice{color:var(--muted);font-size:12px;margin:0 0 12px}.notice strong{color:var(--ink)}@media(max-width:1100px){.workspace{grid-template-columns:minmax(0,1fr)}aside{position:static}.detail{max-width:none}.statgrid{grid-template-columns:repeat(6,1fr)}.cards{max-width:none}}@media(max-width:650px){header,main{padding:20px 16px}.topline{flex-direction:column;gap:8px}.cards{grid-template-columns:repeat(2,1fr)}h1{font-size:25px}select{max-width:100%;min-width:0}.toolbar label{flex:1}.search{min-width:100%}.statgrid{grid-template-columns:repeat(3,1fr)}.pager{flex-wrap:wrap}}
</style></head><body>
<header><div class="topline"><div><div class="eyebrow">European basketball · Official source records</div><h1>Real players. Real clubs.</h1><p class="muted" id="subtitle"></p></div><span class="tag">Available offline · No account needed</span></div><div class="cards" id="cards"></div><p class="scope"><strong>Included: EuroLeague and EuroCup.</strong> The twelve domestic divisions and Basketball Champions League are not included in this pack.</p></header>
<main><div class="toolbar"><label class="search">Search players, clubs or countries<input id="search" type="search" placeholder="Try a player name, club or country…" autocomplete="off"></label><label>Competition<select id="competition"><option value="">All competitions</option></select></label><label>Club<select id="club"><option value="">All clubs</option></select></label><label>Sort by<select id="sort"><option value="name">Player name A–Z</option><option value="club">Club name A–Z</option><option value="height">Height, tallest first</option><option value="birth">Birth date, youngest first</option></select></label><button id="reset" type="button">Reset</button></div>
<p class="notice"><strong>All-season registration history.</strong> A player may appear for more than one club. These records do not establish an opening-day roster or a current team.</p><div class="workspace"><section class="panel" aria-label="Player registrations"><div class="panelhead"><strong id="results" aria-live="polite"></strong><span>Select a player to inspect their record</span></div><div class="tablewrap"><table><thead><tr><th>Player</th><th>Club</th><th>Competition</th><th>Country</th><th>Position</th><th>Height cm</th><th>Weight kg</th><th>Born</th><th>No.</th><th>Registered from</th><th>Registered to</th></tr></thead><tbody id="rows"></tbody></table></div><div id="empty" class="empty" hidden>No matching registrations. Try a different name or filter.</div><div class="pager"><span id="page"></span><div><button id="previous" type="button">Previous</button><button id="next" type="button">Next</button></div></div></section><aside class="panel" aria-label="Selected player"><div id="detail" class="detail"><p class="muted">Select a player to view their details and season statistics.</p></div></aside></div>
<footer><strong>Open the data in Excel or another application</strong><div class="downloads"><a href="players.csv" download>Players CSV</a><a href="clubs.csv" download>Clubs CSV</a><a href="registrations.csv" download>Registrations CSV</a><a href="statistics.csv" download>Season statistics CSV</a></div><p id="quality"></p><p>Source: <a href="https://www.euroleaguebasketball.net/euroleague/" target="_blank" rel="noreferrer">EuroLeague</a> and <a href="https://www.euroleaguebasketball.net/eurocup/" target="_blank" rel="noreferrer">EuroCup</a>, through the official EuroLeague Basketball data service. This browser uses initials in place of photographs.</p><p>Local reference data. Salaries, scouting ratings, personalities and game-use licensing rights are not supplied by this dataset. Registration dates are source observations; club profile fields may reflect later updates.</p><details><summary>Source records and retrieval details</summary><ul class="source-list" id="sources"></ul></details></footer></main>
<script id="pack" type="application/json">${embedded}</script><script>(${browserMain.toString()})();</script></body></html>`;
}

function browserMain() {
  'use strict';
  const pack = JSON.parse(document.getElementById('pack').textContent);
  const players = pack.players || [];
  const clubs = pack.clubs || [];
  const competitions = pack.competitions || [];
  const registrations = pack.registrations || [];
  const statistics = pack.statistics || [];
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const clubMap = new Map(clubs.map((c) => [c.id, c]));
  const competitionMap = new Map(competitions.map((c) => [c.id, c]));
  const rows = registrations.map((registration, index) => ({
    ...registration, rowId: registration.id || String(index),
    player: playerMap.get(registration.playerId) || {},
    club: clubMap.get(registration.clubId) || {},
    competition: competitionMap.get(registration.competitionId) || {},
  }));
  const el = (id) => document.getElementById(id);
  const text = (value) => value === null || value === undefined || value === '' ? '—' : String(value);
  const date = (value) => value ? String(value).slice(0, 10) : '—';
  const number = (value, digits = 0) => typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-GB', { maximumFractionDigits: digits }) : '—';
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const name = (record) => text(record.name || record.fullName || record.code);
  const country = (record) => {
    const value = record.country || record.nationality || record.countryCode;
    return text(value && typeof value === 'object' ? value.name || value.code : value);
  };
  const make = (tag, content, className) => {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
  };
  const option = (select, value, label) => {
    const node = make('option', label);
    node.value = value;
    select.append(node);
  };
  let page = 0;
  let filtered = rows;
  let selected = null;
  const pageSize = 40;
  el('subtitle').textContent = `${pack.season || '2025–26'} season · Retrieved ${date(pack.retrievedAt)} · Official-source player records, registrations and recorded statistics`;
  [[clubs.length, 'clubs'], [players.length, 'unique players'], [registrations.length, 'registration records'], [statistics.length, 'player-season statistics']].forEach(([count, label]) => {
    const card = make('div', undefined, 'card');
    card.append(make('strong', number(count)), make('span', label));
    el('cards').append(card);
  });
  competitions.forEach((competition) => option(el('competition'), competition.id, name(competition)));
  function refreshClubs() {
    const current = el('club').value;
    const competitionId = el('competition').value;
    const availableIds = new Set(rows.filter((row) => !competitionId || row.competitionId === competitionId).map((row) => row.clubId));
    el('club').replaceChildren();
    option(el('club'), '', 'All clubs');
    clubs.filter((club) => availableIds.has(club.id)).sort((a, b) => name(a).localeCompare(name(b))).forEach((club) => option(el('club'), club.id, name(club)));
    if (availableIds.has(current)) el('club').value = current;
  }
  function applyFilters() {
    const query = normalize(el('search').value).trim();
    const competitionId = el('competition').value;
    const clubId = el('club').value;
    filtered = rows.filter((row) => (!competitionId || row.competitionId === competitionId)
      && (!clubId || row.clubId === clubId)
      && (!query || normalize(`${name(row.player)} ${name(row.club)} ${row.club.code || ''} ${country(row.player)}`).includes(query)));
    const sort = el('sort').value;
    filtered.sort((a, b) => {
      if (sort === 'club') return name(a.club).localeCompare(name(b.club)) || name(a.player).localeCompare(name(b.player));
      if (sort === 'height') return (b.player.heightCm || 0) - (a.player.heightCm || 0) || name(a.player).localeCompare(name(b.player));
      if (sort === 'birth') return String(b.player.birthDate || '').localeCompare(String(a.player.birthDate || '')) || name(a.player).localeCompare(name(b.player));
      return name(a.player).localeCompare(name(b.player)) || name(a.club).localeCompare(name(b.club));
    });
    page = 0;
    const selectedRow = filtered.find((row) => row.rowId === selected) || filtered[0];
    selected = selectedRow ? selectedRow.rowId : null;
    if (selectedRow) renderPlayer(selectedRow);
    else el('detail').replaceChildren(make('p', 'No matching player selected. Change your search or filters to view a record.', 'muted'));
    renderRows();
  }
  function renderRows() {
    const unique = new Set(filtered.map((row) => row.playerId)).size;
    el('results').textContent = `${number(filtered.length)} registrations · ${number(unique)} players`;
    el('rows').replaceChildren();
    filtered.slice(page * pageSize, (page + 1) * pageSize).forEach((row) => {
      const tr = make('tr');
      if (row.rowId === selected) tr.className = 'selected';
      const nameCell = make('td');
      const button = make('button', name(row.player), 'playerlink');
      button.type = 'button';
      button.addEventListener('click', () => { selected = row.rowId; renderRows(); renderPlayer(row); });
      nameCell.append(button);
      tr.append(nameCell);
      [name(row.club), name(row.competition), country(row.player), text(row.position), number(row.player.heightCm), number(row.player.weightKg), date(row.player.birthDate), text(row.jerseyNumber), date(row.startDate), date(row.endDate)].forEach((value, index) => {
        tr.append(make('td', value, index === 0 ? 'clubname' : index === 4 || index === 5 ? 'num' : undefined));
      });
      el('rows').append(tr);
    });
    el('empty').hidden = filtered.length > 0;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    el('page').textContent = `Page ${page + 1} of ${pages} · ${pageSize} records per page`;
    el('previous').disabled = page === 0;
    el('next').disabled = page + 1 >= pages;
  }
  function renderPlayer(row) {
    const player = row.player;
    const detail = el('detail');
    detail.replaceChildren();
    const initials = name(player).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('');
    detail.append(make('div', initials, 'avatar'), make('h2', name(player)), make('p', `${country(player)} · Source ID ${player.code || player.id}`, 'fine'));
    const facts = make('dl');
    [['Born', date(player.birthDate)], ['Height', player.heightCm ? `${number(player.heightCm)} cm` : '—'], ['Weight', player.weightKg ? `${number(player.weightKg)} kg` : '—'], ['Position', text(row.position)]].forEach(([label, value]) => {
      const group = make('div');
      group.append(make('dt', label), make('dd', value));
      facts.append(group);
    });
    detail.append(facts, make('h3', 'Season registrations'));
    rows.filter((registration) => registration.playerId === row.playerId).forEach((registration) => {
      const history = make('div', undefined, 'history');
      history.append(make('strong', name(registration.club)), make('div', name(registration.competition), 'muted'), make('div', `${date(registration.startDate)} → ${date(registration.endDate)}`, 'fine'));
      detail.append(history);
    });
    detail.append(make('h3', 'Recorded season statistics'), make('p', 'Totals cover the entire competition season. A player who changed clubs has combined totals.', 'fine'));
    const playerStats = statistics.filter((stat) => stat.playerId === row.playerId);
    if (!playerStats.length) detail.append(make('p', 'No recorded season statistics in this source. Missing values are not treated as zero.', 'muted'));
    playerStats.forEach((stat) => {
      const block = make('section', undefined, 'statblock');
      block.append(make('h4', name(competitionMap.get(stat.competitionId) || {})));
      const teamCodes = stat.sourceTeamCode || stat.sourceClubCode;
      if (teamCodes) block.append(make('p', `Source club code(s): ${teamCodes}`, 'fine'));
      const grid = make('div', undefined, 'statgrid');
      const games = stat.gamesPlayed;
      const average = (total) => typeof total === 'number' && typeof games === 'number' && games > 0 ? total / games : null;
      [['Games', games, 0], ['Minutes / game', average(stat.minutesPlayed), 1], ['Points / game', average(stat.points), 1], ['Rebounds / game', average(stat.rebounds), 1], ['Assists / game', average(stat.assists), 1], ['Points total', stat.points, 0]].forEach(([label, value, digits]) => {
        const metric = make('div');
        metric.append(make('strong', number(value, digits)), make('span', label));
        grid.append(metric);
      });
      block.append(grid);
      [['2-point', stat.twoPointMade, stat.twoPointAttempted], ['3-point', stat.threePointMade, stat.threePointAttempted], ['Free throws', stat.freeThrowMade, stat.freeThrowAttempted]].forEach(([label, made, attempted]) => {
        const percent = typeof made === 'number' && typeof attempted === 'number' && attempted > 0 ? ` · ${number(100 * made / attempted, 1)}%` : '';
        block.append(make('p', `${label}: ${number(made)} / ${number(attempted)}${percent}`, 'statline'));
      });
      block.append(make('p', `Season totals · rebounds ${number(stat.rebounds)} · assists ${number(stat.assists)} · steals ${number(stat.steals)} · blocks ${number(stat.blocks)} · turnovers ${number(stat.turnovers)} · fouls ${number(stat.fouls)}`, 'fine'));
      detail.append(block);
    });
  }
  el('search').addEventListener('input', applyFilters);
  el('competition').addEventListener('change', () => { refreshClubs(); applyFilters(); });
  el('club').addEventListener('change', applyFilters);
  el('sort').addEventListener('change', applyFilters);
  el('reset').addEventListener('click', () => {
    el('search').value = ''; el('competition').value = ''; el('club').value = ''; el('sort').value = 'name';
    refreshClubs(); applyFilters();
  });
  el('previous').addEventListener('click', () => { if (page > 0) { page -= 1; renderRows(); } });
  el('next').addEventListener('click', () => { if ((page + 1) * pageSize < filtered.length) { page += 1; renderRows(); } });
  const missingHeight = players.filter((player) => !player.heightCm).length;
  const missingWeight = players.filter((player) => !player.weightKg).length;
  el('quality').textContent = `Missing measurements: ${missingHeight} player height records and ${missingWeight} player weight records. A dash means unavailable. Source fields may contain inconsistencies; raw responses and provenance are included in the data pack.`;
  (pack.sources || []).forEach((source) => {
    const item = make('li');
    const url = source.url || source.sourceUrl;
    if (typeof url === 'string' && /^https:\/\//i.test(url)) {
      const link = make('a', source.label || source.id || url);
      link.href = url; link.target = '_blank'; link.rel = 'noreferrer';
      item.append(link);
    } else item.textContent = source.label || source.id || 'Source record';
    const retrieved = source.retrievedAt || pack.retrievedAt;
    if (retrieved) item.append(document.createTextNode(` · ${date(retrieved)}`));
    el('sources').append(item);
  });
  refreshClubs();
  applyFilters();
}
