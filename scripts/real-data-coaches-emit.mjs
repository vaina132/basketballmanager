#!/usr/bin/env node
/**
 * Writes `src/data/real-coaches.ts` from the facts gathered by `scripts/real-data-coaches.mjs` (format 82, owner item E).
 *
 *   node scripts/real-data-coaches-emit.mjs --in COACHES.json --pack PACK.json --out src/data/real-coaches.ts
 *
 * Each post's level for the rating formula (`src/world/coach-ratings.ts`) comes from the pack's competitions: a
 * EuroLeague club 4, a top-division club in the EuroCup or BCL 3 (a club playing only in those cups too), a top-division
 * club 2, a second-division club 0.5; national teams by the game's level (1: 3.5, 2: 2.5, 3: 1.5). A coach with two
 * posts (club and national team) takes the higher level. "Known for" hints are the game's own estimate for a few
 * widely known coaches; every other coach's style follows from his attributes and a personal lean.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Game estimate (owner item E): what a few widely known coaches are known for. */
const HINTS = {
  'Željko Obradović': ['defence', 'discipline', 'tactics'],
  'Šarūnas Jasikevičius': ['offence', 'discipline'],
  'Pablo Laso': ['pace', 'offence', 'youth'],
  'Giorgos Bartzokas': ['defence', 'tactics'],
  'Dimitrios Itoudis': ['defence', 'discipline'],
  'Dušan Alimpijević': ['defence', 'tactics'],
  'Andrea Trinchieri': ['offence', 'tactics'],
  'Luca Banchi': ['defence'],
  'Ergin Ataman': ['motivation', 'offence'],
  'Sergio Scariolo': ['tactics', 'defence'],
  'Aleksandar Đorđević': ['motivation'],
  'Saša Obradović': ['defence', 'discipline'],
  'Vassilis Spanoulis': ['offence', 'motivation'],
  'Neven Spahija': ['defence'],
  'Velimir Perasović': ['defence', 'discipline'],
  'Pedro Martínez': ['tactics'],
  'Sito Alonso': ['pace', 'defence'],
  'Joan Peñarroya': ['pace', 'threes'],
  'Ettore Messina': ['tactics', 'discipline'],
  'Tomislav Mijatović': ['offence'],
};

const LEVELS = { euroleague: 4, european: 3, top: 2, second: 0.5, national: { 1: 3.5, 2: 2.5, 3: 1.5 } };
const slug = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/ł/gi, 'l').replace(/ı/g, 'i').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const quote = value => JSON.stringify(value);

async function main() {
  const argument = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
  const input = JSON.parse(await readFile(argument('--in'), 'utf8'));
  const envelope = JSON.parse(await readFile(argument('--pack'), 'utf8')), pack = envelope.pack ?? envelope;
  const nationsText = await readFile(path.join(path.dirname(argument('--out')), 'national-teams.ts'), 'utf8');
  const nationLevel = new Map([...nationsText.matchAll(/team\('([^']+)', '[^']+', '([A-Z]{3})', '[^']+', (\d)\)/g)].map(match => [`nation-${match[2].toLowerCase()}`, Number(match[3])]));
  const tierOf = new Map(), europe = new Map();
  for (const competition of pack.competitions) for (const id of competition.clubIds) {
    if (competition.kind === 'european' || !competition.country) europe.set(id, [...(europe.get(id) ?? []), competition.name]);
    else tierOf.set(id, Math.min(tierOf.get(id) ?? 9, competition.tier));
  }
  const levelOf = team => {
    if (team.kind === 'national') return LEVELS.national[nationLevel.get(team.id) ?? 3];
    const cups = europe.get(team.id) ?? [];
    if (cups.includes('EuroLeague')) return LEVELS.euroleague;
    const tier = tierOf.get(team.id);
    if (tier === 1) return cups.length ? LEVELS.european : LEVELS.top;
    if (tier === undefined) return cups.length ? LEVELS.european : LEVELS.second;
    return LEVELS.second;
  };
  const facts = new Map(input.coaches.map(coach => [coach.name, coach]));
  const coaches = new Map(), posts = [];
  // Checks against each coach's own article (the review rules, 22 November 2026):
  // - an article of someone born before 1940 is another person with the same name: its facts are not used;
  // - a coach whose article names another pack club as his current team left this club: the post is dropped (stale);
  // - a coach named by two clubs keeps the club whose English page listed him (`real-club-people.ts`), else the club his
  //   article names. A dropped club gets a generated coach. National teams are kept beside a club, as in real life.
  const GENERIC = new Set(['basket', 'basketball', 'baloncesto', 'pallacanestro', 'basketbol', 'club', 'sport', 'spor', 'sporting', 'metropole', 'team', 'city', 'baskets', 'giants', 'lions', 'libertas', 'victoria', 'olympic', 'union']);
  const fold = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đ]/gi, 'd').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = text => fold(text).split(' ').filter(word => word.length >= 4 && !GENERIC.has(word));
  const names = (team, current) => { const own = words(team.name), other = words(current); return own.some(word => other.some(item => item === word || item.startsWith(word) || word.startsWith(item))); };
  for (const coach of input.coaches) if (coach.birthDate && Number(coach.birthDate.slice(0, 4)) < 1940) {
    console.log(`another person: ${coach.name} (${coach.birthDate}, ${coach.article})`);
    Object.assign(coach, { birthDate: null, nationality: null, firstHeadCoachYear: null, titles: null, currentTeam: null, article: null });
  }
  const clubTeams = input.teams.filter(item => item.coach && item.kind === 'club');
  const dropped = new Set();
  // A post checked by hand against a current source (`checked`) is kept as it is; another club naming the same coach
  // from an older page is stale and dropped.
  const checkedPost = new Map(clubTeams.filter(team => team.checked).map(team => [team.coach, team]));
  for (const team of clubTeams) {
    const owner = checkedPost.get(team.coach);
    if (owner && owner !== team) { dropped.add(team.id); console.log(`stale: ${team.coach} at ${team.name} (checked current at ${owner.name} on ${owner.checked})`); }
  }
  for (const team of clubTeams) {
    if (team.checked || dropped.has(team.id)) continue;
    const current = facts.get(team.coach)?.currentTeam;
    if (!current || names(team, current)) continue;
    const elsewhere = clubTeams.find(other => other !== team && names(other, current));
    if (elsewhere) { dropped.add(team.id); console.log(`stale: ${team.coach} at ${team.name} (his article: ${current}, coached by him: ${elsewhere.name})`); }
  }
  for (const name of new Set(clubTeams.map(team => team.coach))) {
    const holders = clubTeams.filter(team => team.coach === name && !dropped.has(team.id));
    if (holders.length < 2) continue;
    const current = facts.get(name)?.currentTeam;
    const keep = holders.find(team => team.checked) ?? holders.find(team => !team.notes.length) ?? holders.find(team => current && names(team, current)) ?? holders[0];
    for (const team of holders) if (team !== keep) { dropped.add(team.id); console.log(`dropped: ${name} at ${team.name} (kept ${keep.name})`); }
  }
  for (const team of input.teams.filter(item => item.coach && !dropped.has(item.id))) {
    const coach = facts.get(team.coach), id = `coach-${slug(team.coach)}`, level = levelOf(team);
    const known = coaches.get(id);
    if (known) known.level = Math.max(known.level, level);
    else coaches.set(id, {
      id, name: team.coach, born: coach?.birthDate ?? null, nationality: coach?.nationality ?? null, since: coach?.firstHeadCoachYear ?? null,
      titles: coach?.titles ?? { euroleague: 0, europe: 0, league: 0, cup: 0, national: 0, awards: 0 }, level, source: coach?.article ?? coach?.wikidata ?? team.source, hints: HINTS[team.coach] ?? [],
      note: team.checked ? 'checked current' : coach?.currentTeam ? `article: ${coach.currentTeam}` : coach?.article ? 'article without a current team' : 'no article found',
    });
    posts.push({ teamId: team.id, team: team.name, coachId: id, source: team.source });
  }
  const lines = [
    '/**',
    ' * Real head coaches (owner, 22 November 2026, item E; format 82): the head coach of each club in the real pack and of',
    ' * the 24 national teams, with the facts the game estimates their 1-20 attributes from (`src/world/coach-ratings.ts`).',
    ` * Sources: English Wikipedia (CC BY-SA 4.0; for nine clubs the Italian, French, Turkish or Czech Wikipedia) and Wikidata`,
    ' * (CC0), facts only (who coaches which team, birth date, nationality, first season as a head coach, titles won as a',
    ` * head coach), each with its page link; ${input.teams.filter(team => team.checked).length} club posts checked by hand against a current 2026-27 league, club or press page`,
    ' * (`CHECKED` in the fetch script, which also drops older claims on the same coach); fetched by `scripts/real-data-coaches.mjs` and',
    ` * written by \`scripts/real-data-coaches-emit.mjs\` on ${input.fetchedOn}. Teams not listed have no head coach in a free`,
    ' * source and get a generated coach (marked). `level`: the job level the formula uses; `hints`: the game\'s own estimate',
    ' * of what a few widely known coaches are known for. Unknown facts are null.',
    ' */',
    "import type { CoachFacts } from '../world/coach-ratings';",
    '',
    'export interface RealCoach extends CoachFacts { id: string; level: number }',
    'export interface RealCoachPost { teamId: string; team: string; coachId: string; source: string }',
    '',
    `export const REAL_COACHES_FETCHED_ON = ${quote(input.fetchedOn)};`,
    '',
    'export const REAL_COACHES: readonly RealCoach[] = Object.freeze(([',
    ...[...coaches.values()].map(coach => `  { id: ${quote(coach.id)}, name: ${quote(coach.name)}, born: ${quote(coach.born)}, nationality: ${quote(coach.nationality)}, since: ${quote(coach.since)}, titles: ${JSON.stringify(coach.titles).replace(/"(\w+)":/g, '$1: ')}, level: ${coach.level}, ${coach.hints.length ? `hints: ${quote(coach.hints)}, ` : ''}source: ${quote(coach.source)} },`),
    '] as RealCoach[]).map(coach => Object.freeze(coach)));',
    '',
    'export const REAL_COACH_POSTS: readonly RealCoachPost[] = Object.freeze([',
    ...posts.map(post => `  { teamId: ${quote(post.teamId)}, team: ${quote(post.team)}, coachId: ${quote(post.coachId)}, source: ${quote(post.source)} },`),
    ']);',
    '',
  ];
  await writeFile(argument('--out'), lines.join('\n'));
  console.log(`coaches ${coaches.size}, posts ${posts.length}`);
  for (const coach of coaches.values()) if (!coach.born || !coach.nationality || coach.note !== `article: ${posts.find(post => post.coachId === coach.id)?.team}`) console.log(`check: ${coach.name} · born ${coach.born} · ${coach.nationality} · ${coach.note} · posts ${posts.filter(post => post.coachId === coach.id).map(post => post.team).join(', ')}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
