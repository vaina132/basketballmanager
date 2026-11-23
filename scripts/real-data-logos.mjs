#!/usr/bin/env node
// Real club and competition logos (owner decision, 22 November 2026: original logos from API-Sports).
//
// Matches every club of a real pack to its API-Sports team by competition membership first, then by
// normalised names, from cached API-Sports team lists (no API calls). Downloads each matched logo once
// (images need no key), resizes it to 96x96 WebP with ImageMagick and writes src/data/real-logos.ts.
//
// Usage:
//   node scripts/real-data-logos.mjs --pack <real-pack.json> --cache <dir with t<league>.json, l<league>.json> [--download] [--report <file.json>]
// Without --download it only prints the matches for review.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const packPath = option('--pack'), cacheDir = option('--cache'), reportPath = option('--report'), download = args.includes('--download')
if (!packPath || !cacheDir) { console.error('Usage: node scripts/real-data-logos.mjs --pack <file> --cache <dir> [--download] [--report <file>]'); process.exit(1) }

const root = resolve(import.meta.dirname, '..')
const raw = JSON.parse(readFileSync(packPath, 'utf8'))
const pack = raw.pack ?? raw

// Pack competition name -> API-Sports league ID (2026-27 team lists cached by the main session).
const LEAGUES = {
  'Basketball Bundesliga': 40, EuroLeague: 120, 'Basketbol Süper Ligi': 104, 'Türkiye Basketbol Ligi': 102, 'Liga ACB': 117,
  'Primera FEB': 95, 'Lega Basket Serie A': 52, 'Serie A2': 242, 'LNB Élite': 2, 'Élite 2': 8, 'Greek Basket League': 45,
  EuroCup: 194, 'Basketball Champions League': 202, NBA: 12,
}
// Reviewed by eye where names differ too much to match automatically (pack club name -> API-Sports team ID).
// API-Sports serves the Süper Ligi logo for the TBL too; a wrong mark is worse than the plain one.
const SKIP_LEAGUE_LOGOS = new Set([102])
const MANUAL = { 'LDLC ASVEL': 26, 'Champagne Basket': 12, 'Stade Rochelais': 2311, Juvecaserta: 704 }

const STOP = new Set(['bc', 'bk', 'kk', 'sk', 'ks', 'cb', 'cd', 'ab', 'as', 'asd', 'ssd', 'sad', 'sa', 'fc', 'gs', 'bsk', 'jsk', 'basket', 'basketball', 'basketbol', 'baloncesto', 'pallacanestro', 'club', 'de', 'del', 'la', 'el', 'the', 'and', 'b', 'c', 'spor', 'kulubu', 'kulübü'])
const plain = text => text.toLowerCase().replace(/ı/g, 'i').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const tokens = text => plain(text).split(' ').filter(token => token && !STOP.has(token))
const bigrams = text => { const s = tokens(text).join(''), out = new Map(); for (let i = 0; i < s.length - 1; i += 1) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) ?? 0) + 1) } return out }
function dice(a, b) {
  const x = bigrams(a), y = bigrams(b); let overlap = 0, total = 0
  for (const [g, n] of x) { overlap += Math.min(n, y.get(g) ?? 0); total += n }
  for (const n of y.values()) total += n
  return total ? 2 * overlap / total : 0
}
function score(club, team) {
  const names = [club.name, club.shortName].filter(Boolean)
  const teamTokens = new Set(tokens(team.name))
  let best = 0
  for (const name of names) {
    const own = tokens(name)
    const shared = own.filter(token => teamTokens.has(token) || [...teamTokens].some(other => other.length >= 4 && token.length >= 4 && (other.startsWith(token) || token.startsWith(other)))).length
    const tokenScore = own.length && teamTokens.size ? shared / Math.min(own.length, teamTokens.size) : 0
    best = Math.max(best, 0.6 * tokenScore + 0.4 * dice(name, team.name))
  }
  return best
}

const clubs = new Map(pack.clubs.map(club => [club.id, club]))
const matches = new Map() // club id -> { team, score, competition }
const unmatched = []
const leagueLogos = {}
for (const competition of pack.competitions) {
  const leagueId = LEAGUES[competition.name]
  if (!leagueId) { console.warn(`No API-Sports league for ${competition.name}`); continue }
  const teams = JSON.parse(readFileSync(join(cacheDir, `t${leagueId}.json`), 'utf8')).response
  const league = JSON.parse(readFileSync(join(cacheDir, `l${leagueId}.json`), 'utf8')).response[0]
  leagueLogos[competition.id] = { leagueId, name: competition.name, logo: league.logo }
  // Greedy one-to-one assignment inside the competition, best pairs first.
  const pairs = []
  for (const clubId of competition.clubIds) {
    const club = clubs.get(clubId), manual = MANUAL[club.name]
    for (const team of teams) pairs.push({ clubId, team, score: manual ? (manual === team.id ? 2 : -1) : score(club, team) })
  }
  pairs.sort((a, b) => b.score - a.score)
  const usedClubs = new Set(), usedTeams = new Set()
  for (const pair of pairs) {
    if (usedClubs.has(pair.clubId) || usedTeams.has(pair.team.id) || pair.score < 0.35) continue
    usedClubs.add(pair.clubId); usedTeams.add(pair.team.id)
    const earlier = matches.get(pair.clubId)
    if (earlier && earlier.team.id !== pair.team.id) console.warn(`Conflict: ${clubs.get(pair.clubId).name} -> ${earlier.team.name} (${earlier.team.id}) in ${earlier.competition} but ${pair.team.name} (${pair.team.id}) in ${competition.name}`)
    if (!earlier || pair.score > earlier.score) matches.set(pair.clubId, { team: pair.team, score: pair.score, competition: competition.name })
  }
  for (const clubId of competition.clubIds) if (!usedClubs.has(clubId) && !matches.has(clubId)) unmatched.push({ clubId, name: clubs.get(clubId).name, competition: competition.name, leftover: teams.filter(team => !usedTeams.has(team.id)).map(team => team.name) })
}

const rows = [...matches].map(([clubId, match]) => ({ clubId, club: clubs.get(clubId).name, country: clubs.get(clubId).country, teamId: match.team.id, team: match.team.name, score: Number(match.score.toFixed(2)), competition: match.competition }))
rows.sort((a, b) => a.score - b.score)
for (const row of rows) console.log(`${row.score.toFixed(2)}  ${row.club}  ->  ${row.team} (${row.teamId})  [${row.competition}]`)
const stillUnmatched = unmatched.filter(item => !matches.has(item.clubId))
console.log(`\nMatched ${rows.length} of ${pack.clubs.length} clubs; unmatched in competitions: ${stillUnmatched.length}`)
for (const item of stillUnmatched) console.log(`UNMATCHED ${item.name} [${item.competition}] leftover: ${item.leftover.join(', ')}`)
const outside = pack.clubs.filter(club => !matches.has(club.id) && !pack.competitions.some(c => c.clubIds.includes(club.id)))
if (outside.length) console.log(`Clubs in no competition: ${outside.map(club => club.name).join(', ')}`)
if (reportPath) writeFileSync(reportPath, JSON.stringify({ rows, unmatched: stillUnmatched, leagues: leagueLogos }, null, 2))

if (download) {
  const clubDir = join(root, 'public/logos/clubs'), competitionDir = join(root, 'public/logos/competitions'), tmp = join(root, '.local-data/logo-downloads')
  for (const dir of [clubDir, competitionDir, tmp]) mkdirSync(dir, { recursive: true })
  const fetchImage = async (url, file) => {
    if (existsSync(file) && statSync(file).size > 0) return true
    const response = await fetch(url)
    if (response.status === 404) return false
    if (!response.ok) throw new Error(`${url}: ${response.status}`)
    writeFileSync(file, Buffer.from(await response.arrayBuffer()))
    return true
  }
  // Trimmed of empty margins, fitted into 96x96 with transparent padding, small WebP.
  const toWebp = (source, target) => execFileSync('convert', [source, '-trim', '+repage', '-background', 'none', '-resize', '96x96', '-gravity', 'center', '-extent', '96x96', '-strip', '-quality', '82', '-define', 'webp:alpha-quality=90', target])
  const clubLogos = {}, competitionLogos = {}, missing = []
  const ordered = [...rows].sort((a, b) => a.club.localeCompare(b.club)), sources = new Map(), digests = new Map()
  for (const row of ordered) {
    const source = join(tmp, `team-${row.teamId}.png`)
    if (!await fetchImage(`https://media.api-sports.io/basketball/teams/${row.teamId}.png`, source)) { missing.push(`${row.club} (no image)`); continue }
    const digest = createHash('md5').update(readFileSync(source)).digest('hex')
    sources.set(row.clubId, { source, digest }); digests.set(digest, (digests.get(digest) ?? new Set()).add(row.teamId))
  }
  for (const row of ordered) {
    const found = sources.get(row.clubId)
    if (!found) continue
    // The same picture for several different teams is API-Sports' "image not available" placeholder.
    if (digests.get(found.digest).size >= 3) { missing.push(`${row.club} (placeholder)`); continue }
    toWebp(found.source, join(clubDir, `${row.clubId}.webp`))
    clubLogos[row.clubId] = `${row.clubId}.webp`
  }
  for (const [competitionId, { leagueId }] of Object.entries(leagueLogos)) {
    if (SKIP_LEAGUE_LOGOS.has(leagueId)) continue
    const source = join(tmp, `league-${leagueId}.png`)
    if (!await fetchImage(`https://media.api-sports.io/basketball/leagues/${leagueId}.png`, source)) { missing.push(`competition ${leagueId}`); continue }
    toWebp(source, join(competitionDir, `${competitionId}.webp`))
    competitionLogos[competitionId] = `${competitionId}.webp`
  }
  const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
  const body = `// Generated by scripts/real-data-logos.mjs from API-Sports team and league logos. Do not edit by hand.
// The logos are trademarks of their clubs and competitions (see public/logos/README.md).

/** Real-pack club ID -> logo file in public/logos/clubs/. */
export const REAL_CLUB_LOGOS: Readonly<Record<string, string>> = ${JSON.stringify(sorted(clubLogos), null, 2)}

/** Real-pack competition ID -> logo file in public/logos/competitions/. */
export const REAL_COMPETITION_LOGOS: Readonly<Record<string, string>> = ${JSON.stringify(sorted(competitionLogos), null, 2)}
`
  writeFileSync(join(root, 'src/data/real-logos.ts'), body)
  // The reviewed matches, kept so later packs and the tests can check the map against them.
  const reviewed = ordered.map(row => ({ clubId: row.clubId, club: row.club, apiSportsTeamId: row.teamId, apiSportsTeam: row.team, logo: Object.hasOwn(clubLogos, row.clubId) }))
  const leagues = Object.entries(leagueLogos).map(([competitionId, item]) => ({ competitionId, competition: item.name, apiSportsLeagueId: item.leagueId, logo: Object.hasOwn(competitionLogos, competitionId) }))
  writeFileSync(join(root, 'real-data/club-logo-matches.json'), `${JSON.stringify({ source: 'API-Sports team lists 2026-27, matched 22 November 2026', clubs: reviewed, competitions: leagues }, null, 1)}\n`)
  if (missing.length) console.log(`No image at API-Sports for: ${missing.join(', ')}`)
  console.log(`Wrote ${Object.keys(clubLogos).length} club and ${Object.keys(competitionLogos).length} competition logos.`)
}
