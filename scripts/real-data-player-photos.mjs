#!/usr/bin/env node
// Real player photos from Wikimedia Commons (owner decision, 22 November 2026: free Commons photos first,
// with a Credits page naming each photographer and licence).
//
// 1. Finds Wikidata items for the real pack's players: exact labels through the Wikidata query service,
//    then a search (which ignores accents) for the rest. Only basketball players (P106 = Q3665646).
// 2. Keeps a match only when the name is the same and at least one more fact agrees: the birth date,
//    a team (P54) like his club, or (for a unique name) the birth year or the nationality. A birth date
//    that disagrees rules the item out. When in doubt the player keeps the drawn avatar.
// 3. Takes the item's image (P18) and keeps it only under a free licence that allows reuse (CC0, public
//    domain, CC BY, CC BY-SA; never NC/ND or non-free) with a named author where attribution is required.
// 4. With --download: crops each photo to its top centre square, 128x128 WebP in public/photos/players/,
//    and writes src/data/player-photos.ts and real-data/player-photo-matches.json. Players of the previous map who
//    are no longer in the pack keep their photo (careers on an older pack still have them).
//
// Every response is cached in --cache, so a rerun works offline (--offline) and never repeats a request.
// Requests are spaced at least 1.1 s apart with a descriptive User-Agent, as Wikimedia asks.
//
// Usage:
//   node scripts/real-data-player-photos.mjs --pack <real-pack.json> --cache <dir> [--offline] [--download] [--report <file.json>]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const packPath = option('--pack'), cacheDir = option('--cache'), reportPath = option('--report')
const offline = args.includes('--offline'), download = args.includes('--download')
if (!packPath || !cacheDir) { console.error('Usage: node scripts/real-data-player-photos.mjs --pack <file> --cache <dir> [--offline] [--download] [--report <file>]'); process.exit(1) }

const root = resolve(import.meta.dirname, '..')
const raw = JSON.parse(readFileSync(packPath, 'utf8'))
const pack = raw.pack ?? raw
const USER_AGENT = 'CourtsideGameBot/1.0 (open-source basketball game; one-off photo credits lookup)'
const BASKETBALL_PLAYER = 'Q3665646'
const OUTPUT_SIZE = 128
const httpDir = join(cacheDir, 'http'), imageDir = join(cacheDir, 'images')
for (const dir of [httpDir, imageDir]) mkdirSync(dir, { recursive: true })

// ---- Polite, cached HTTP -------------------------------------------------------------------------
let lastRequest = 0
const sleep = ms => new Promise(done => setTimeout(done, ms))
async function cachedFetch(url, { body, binary = false, file } = {}) {
  const key = createHash('sha1').update(url + (body ?? '')).digest('hex')
  const target = file ?? join(httpDir, `${key}.${binary ? 'bin' : 'json'}`)
  if (existsSync(target) && statSync(target).size > 0) return binary ? target : JSON.parse(readFileSync(target, 'utf8'))
  if (offline) return null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const wait = lastRequest + 1100 - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequest = Date.now()
    const response = await fetch(url, body ? { method: 'POST', body, headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } } : { headers: { 'User-Agent': USER_AGENT, Accept: binary ? 'image/*' : 'application/json' } })
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after')) || 0
      const pause = Math.max(retryAfter * 1000, 5000 * 2 ** attempt)
      console.warn(`  ${response.status} from ${new URL(url).host}; waiting ${Math.round(pause / 1000)} s`)
      await sleep(pause)
      continue
    }
    if (response.status === 404 && binary) return null
    if (!response.ok) throw new Error(`${url.slice(0, 200)}: ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    writeFileSync(target, data)
    return binary ? target : JSON.parse(data.toString('utf8'))
  }
  throw new Error(`Gave up on ${url.slice(0, 200)}`)
}
const api = (host, params) => `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size))

// ---- Names and clubs -----------------------------------------------------------------------------
const plain = text => text.toLowerCase().replace(/ı/g, 'i').replace(/ß/g, 'ss').replace(/[đð]/g, 'd').replace(/ø/g, 'o').replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
// Only full names: "E. Karakaya" or one-word names are too vague to match.
const fullName = name => { const parts = name.trim().split(/\s+/); return parts.length >= 2 && parts.every(part => !/^[A-Za-zÀ-ž]\.?$/.test(part)) && !/\./.test(parts[0]) }
const STOP = new Set(['bc', 'bk', 'kk', 'sk', 'ks', 'cb', 'cd', 'ab', 'as', 'asd', 'ssd', 'sad', 'sa', 'fc', 'gs', 'bsk', 'jsk', 'basket', 'basketball', 'basketbol', 'baloncesto', 'pallacanestro', 'club', 'de', 'del', 'la', 'el', 'the', 'and', 'b', 'c', 'spor', 'kulubu', 'men', 's', 'team', 'women'])
const tokens = text => plain(text).split(' ').filter(token => token && !STOP.has(token))
function sameClub(club, teamLabel) {
  const theirs = tokens(teamLabel)
  if (!theirs.length) return false
  return [club.name, club.shortName].filter(Boolean).some(name => {
    const own = tokens(name).filter(token => token.length >= 3)
    if (!own.length) return false
    const shared = own.filter(token => theirs.some(other => other === token || (other.length >= 5 && token.length >= 5 && (other.startsWith(token) || token.startsWith(other)))))
    return shared.length / own.length >= 0.5 && shared.some(token => token.length >= 4)
  })
}
const COUNTRY_ALIASES = { usa: ['united states', 'united states of america'], turkey: ['turkiye'], turkiye: ['turkey'], 'great britain': ['united kingdom'], england: ['united kingdom'], 'czech republic': ['czechia'], czechia: ['czech republic'], 'bosnia herzegovina': ['bosnia and herzegovina'], macedonia: ['north macedonia'], 'dr congo': ['democratic republic of the congo'], 'congo dr': ['democratic republic of the congo'], 'ivory coast': ["cote d ivoire"], russia: ['russian federation'], korea: ['south korea'] }
function sameCountry(nationality, labels) {
  const own = plain(nationality), wanted = new Set([own, ...(COUNTRY_ALIASES[own] ?? []).map(plain)])
  return labels.some(label => wanted.has(plain(label)))
}

// ---- 1. Candidates ---------------------------------------------------------------------------------
const clubs = new Map(pack.clubs.map(club => [club.id, club]))
const players = pack.players.filter(player => fullName(player.name))
console.log(`${players.length} of ${pack.players.length} players have a full name.`)
const candidateIds = new Map() // player id -> Set of Q-ids
const add = (playerId, qid) => { const set = candidateIds.get(playerId) ?? new Set(); set.add(qid); candidateIds.set(playerId, set) }

const LANGUAGES = ['en', 'mul', 'es', 'it', 'fr', 'de', 'tr', 'sr', 'hr', 'sl', 'lt', 'lv', 'pl', 'cs', 'pt', 'nl']
const byName = new Map()
for (const player of players) { const list = byName.get(player.name) ?? []; list.push(player); byName.set(player.name, list) }
const literal = text => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const names = [...byName.keys()].sort()
const sparql = query => cachedFetch('https://query.wikidata.org/sparql', { body: new URLSearchParams({ query, format: 'json' }).toString() })
const qidOf = uri => uri.split('/').pop()
for (const [index, batch] of chunks(names, 50).entries()) {
  const values = batch.flatMap(name => LANGUAGES.map(language => `${literal(name)}@${language}`)).join(' ')
  const result = await sparql(`SELECT DISTINCT ?item ?name WHERE { VALUES ?name { ${values} } ?item rdfs:label|skos:altLabel ?name . ?item wdt:P106 wd:${BASKETBALL_PLAYER} . }`)
  for (const row of result?.results.bindings ?? []) for (const player of byName.get(row.name.value) ?? []) add(player.id, qidOf(row.item.value))
  if (index % 10 === 0) console.log(`  exact labels: batch ${index + 1} of ${Math.ceil(names.length / 50)}`)
}
// Names without an exact label (often only accents differ): the Wikidata search, run by the query service.
const missing = names.filter(name => !(byName.get(name) ?? []).some(player => candidateIds.has(player.id)))
console.log(`Exact labels found candidates for ${names.length - missing.length} names; searching ${missing.length} more.`)
for (const [index, batch] of chunks(missing, 25).entries()) {
  const values = batch.map(name => `(${literal(name)} ${literal(`haswbstatement:P106=${BASKETBALL_PLAYER} inlabel:${literal(name)}`)})`).join(' ')
  const result = await sparql(`SELECT ?name ?title WHERE { VALUES (?name ?search) { ${values} } SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "Search"; mwapi:srsearch ?search; mwapi:srlimit "5" . ?title wikibase:apiOutput mwapi:title . } }`)
  for (const row of result?.results.bindings ?? []) if (/^Q\d+$/.test(row.title?.value ?? '')) for (const player of byName.get(row.name.value) ?? []) add(player.id, row.title.value)
  if (index % 10 === 0) console.log(`  search: batch ${index + 1} of ${Math.ceil(missing.length / 25)}`)
}

// ---- 2. Item details (query service) ---------------------------------------------------------------
const items = new Map()
const allIds = [...new Set([...candidateIds.values()].flatMap(set => [...set]))].sort()
const item = qid => { if (!items.has(qid)) items.set(qid, { qid, names: new Set(), births: [], images: [], teams: new Set(), countries: new Set() }); return items.get(qid) }
for (const batch of chunks(allIds, 80)) {
  const values = batch.map(qid => `wd:${qid}`).join(' ')
  const labels = await sparql(`SELECT ?item ?name WHERE { VALUES ?item { ${values} } ?item rdfs:label|skos:altLabel ?name . FILTER(LANG(?name) IN (${LANGUAGES.map(literal).join(', ')})) }`)
  for (const row of labels?.results.bindings ?? []) item(qidOf(row.item.value)).names.add(row.name.value)
  const facts = await sparql(`SELECT ?item ?birth ?precision ?image WHERE { VALUES ?item { ${values} } ?item wdt:P106 wd:${BASKETBALL_PLAYER} . OPTIONAL { ?item p:P569 ?statement . ?statement wikibase:rank ?rank ; psv:P569 [ wikibase:timeValue ?birth ; wikibase:timePrecision ?precision ] . FILTER(?rank != wikibase:DeprecatedRank) } OPTIONAL { ?item wdt:P18 ?image } }`)
  for (const row of facts?.results.bindings ?? []) {
    const entry = item(qidOf(row.item.value))
    entry.basketball = true
    if (row.birth) { const match = /^(\d{4})-(\d\d)-(\d\d)/.exec(row.birth.value); if (match) entry.births.push({ year: Number(match[1]), date: Number(row.precision.value) >= 11 ? match.slice(1, 4).join('-') : null }) }
    if (row.image) { const file = decodeURIComponent(row.image.value.split('/Special:FilePath/').pop()).replace(/_/g, ' '); if (!entry.images.includes(file)) entry.images.push(file) }
  }
  const links = await sparql(`SELECT ?item ?kind ?label WHERE { VALUES ?item { ${values} } { ?item wdt:P54 ?link . BIND("team" AS ?kind) } UNION { ?item wdt:P27 ?link . BIND("country" AS ?kind) } ?link rdfs:label|skos:altLabel ?label . FILTER(LANG(?label) IN ("en", "mul", "es", "it", "fr", "de", "tr")) }`)
  for (const row of links?.results.bindings ?? []) item(qidOf(row.item.value))[row.kind.value === 'team' ? 'teams' : 'countries'].add(row.label.value)
}

// ---- 3. Matching -----------------------------------------------------------------------------------
function evaluate(player, entry) {
  if (!entry.basketball || ![...entry.names].some(name => plain(name) === plain(player.name))) return null
  const evidence = []
  let contradiction = false
  const births = entry.births
  if (births.length && player.birthDate) {
    const packYear = Number(player.birthDate.slice(0, 4))
    if (births.some(birth => birth.date === player.birthDate)) evidence.push('birth date')
    else if (births.some(birth => !birth.date && Math.abs(birth.year - packYear) <= 1)) evidence.push('birth year')
    // Same year, another day: a typing slip on one side is likelier than a namesake, but it proves nothing.
    else if (!births.some(birth => birth.year === packYear)) contradiction = true
  } else if (births.length && Number.isFinite(player.age)) {
    // Ages without a birth date come from older provider seasons (often 2-3 years behind), so the age only
    // rules an item out when it is far off; it never counts as agreement.
    if (!births.some(birth => birth.year >= 2021 - player.age && birth.year <= 2026 - player.age)) contradiction = true
  }
  const club = clubs.get(player.clubId)
  if (club && [...entry.teams].some(label => sameClub(club, label))) evidence.push('team')
  if (player.nationality && sameCountry(player.nationality, [...entry.countries])) evidence.push('nationality')
  return { qid: entry.qid, evidence, contradiction, strong: evidence.includes('birth date') || evidence.includes('team') }
}
const matches = [], skipped = { noCandidate: 0, ambiguous: 0, weak: 0, contradiction: 0, sharedItem: 0 }
for (const player of players) {
  const results = [...(candidateIds.get(player.id) ?? [])].map(qid => items.get(qid)).filter(Boolean).map(entry => evaluate(player, entry)).filter(Boolean)
  if (!results.length) { skipped.noCandidate += 1; continue }
  const passing = results.filter(result => !result.contradiction && result.evidence.length)
  if (passing.length !== 1) { skipped[passing.length ? 'ambiguous' : results.some(result => result.contradiction) ? 'contradiction' : 'weak'] += 1; if (process.env.DEBUG_PHOTOS) console.log('SKIP', player.name, player.birthDate ?? player.age, player.nationality, clubs.get(player.clubId)?.name, JSON.stringify(results.map(r => [r.qid, r.evidence, r.contradiction, items.get(r.qid).births]))); continue }
  const [best] = passing
  if (!best.strong && results.length !== 1) { skipped.ambiguous += 1; continue }
  matches.push({ player, ...best })
}
const itemUse = new Map()
for (const match of matches) itemUse.set(match.qid, (itemUse.get(match.qid) ?? 0) + 1)
const unique = matches.filter(match => itemUse.get(match.qid) === 1)
skipped.sharedItem = matches.length - unique.length
console.log(`Matched ${unique.length} players to Wikidata items. Skipped: ${JSON.stringify(skipped)}`)

// ---- 4. Images and licences ------------------------------------------------------------------------
const withImage = unique.map(match => ({ ...match, image: items.get(match.qid).images[0] })).filter(match => match.image)
console.log(`${withImage.length} matched players have an image on Wikidata.`)
const fileInfo = new Map()
for (const batch of chunks([...new Set(withImage.map(match => match.image))].sort(), 50)) {
  const result = await cachedFetch(api('commons.wikimedia.org', { action: 'query', titles: batch.map(name => `File:${name}`).join('|'), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '330', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|UsageTerms|AttributionRequired|NonFree|Copyrighted' }))
  const normalized = new Map((result?.query?.normalized ?? []).map(item => [item.to, item.from]))
  for (const page of result?.query?.pages ?? []) {
    const info = page.imageinfo?.[0]
    if (info) fileInfo.set((normalized.get(page.title) ?? page.title).replace(/^File:/, ''), { ...info, title: page.title })
  }
}
const text = html => (html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
const FREE_LICENCE = /^(cc0( 1\.0)?|public domain|pd[- ].*|cc by(-sa)? \d\.\d( [a-z]{2,3})?)$/i
function licenceOf(info) {
  const meta = info.extmetadata ?? {}, value = key => text(meta[key]?.value)
  const licence = value('LicenseShortName'), url = (meta.LicenseUrl?.value ?? '').trim(), author = value('Artist')
  if (!licence || /\b(nc|nd)\b|non-?commercial|no ?deriv|fair use|non-?free/i.test(licence) || value('NonFree') === 'true') return { reason: `licence ${licence || 'missing'}` }
  if (!FREE_LICENCE.test(licence)) return { reason: `licence ${licence}` }
  const publicDomain = /^(cc0|public domain|pd)/i.test(licence)
  if (!publicDomain && (!author || !/^https?:\/\/creativecommons\.org\//.test(url))) return { reason: 'no author or licence link' }
  if (!/^image\/(jpeg|png|webp|tiff)$/.test(info.mime ?? '') || info.width < 120 || info.height < 120) return { reason: 'not a usable photo' }
  return { licence, url: url || null, author: author ? author.replace(/^User:/i, '').slice(0, 120) : 'Unknown author', shareAlike: /-sa\b/i.test(licence) }
}
const accepted = [], rejected = {}
for (const match of withImage) {
  const info = fileInfo.get(match.image)
  if (!info) { rejected['no file info'] = (rejected['no file info'] ?? 0) + 1; continue }
  const licence = licenceOf(info)
  if (licence.reason) { rejected[licence.reason] = (rejected[licence.reason] ?? 0) + 1; continue }
  accepted.push({ ...match, info, ...licence })
}
console.log(`${accepted.length} photos have a free licence. Rejected: ${JSON.stringify(rejected)}`)
const licenceMix = {}
for (const item of accepted) licenceMix[item.licence] = (licenceMix[item.licence] ?? 0) + 1
console.log(`Licences: ${JSON.stringify(licenceMix)}`)
const rows = accepted.map(item => ({ playerId: item.player.id, name: item.player.name, club: clubs.get(item.player.clubId)?.name ?? null, wikidata: item.qid, evidence: item.evidence, file: item.image, licence: item.licence, author: item.author }))
if (reportPath) writeFileSync(reportPath, JSON.stringify({ skipped, rejected, licenceMix, rows }, null, 2))

// ---- 5. Files ------------------------------------------------------------------------------------
if (download) {
  const outDir = join(root, 'public/photos/players')
  mkdirSync(outDir, { recursive: true })
  const photos = {}
  for (const [index, item] of [...accepted].sort((a, b) => a.player.id.localeCompare(b.player.id)).entries()) {
    const source = join(imageDir, `${createHash('sha1').update(item.image).digest('hex')}.img`)
    const fetched = await cachedFetch(item.info.thumburl ?? item.info.url, { binary: true, file: source })
    if (!fetched) continue
    const target = join(outDir, `${item.player.id}.webp`)
    // Top centre square (head and shoulders in most portraits), 128x128, small WebP.
    try { execFileSync('convert', [`${source}[0]`, '-auto-orient', '-resize', `${OUTPUT_SIZE}x${OUTPUT_SIZE}^`, '-gravity', 'North', '-extent', `${OUTPUT_SIZE}x${OUTPUT_SIZE}`, '-strip', '-quality', '78', target]) } catch { console.warn(`  could not convert ${item.image}`); continue }
    photos[item.player.id] = { player: item.player.name, author: item.author, licence: item.licence, licenceUrl: item.url, commonsFile: item.info.title.replace(/^File:/, '') }
    if (index % 100 === 0) console.log(`  photos: ${index + 1} of ${accepted.length}`)
  }
  // Players who left the pack (a later world dropped them) keep the photo they had: careers started on an older pack
  // still have them (added 22 November 2026, world-10). Their rows come from the current map and matches file.
  const packIds = new Set(pack.players.map(player => player.id)), keptRows = []
  const mapPath = join(root, 'src/data/player-photos.ts'), matchesPath = join(root, 'real-data/player-photo-matches.json')
  if (existsSync(mapPath)) {
    const source = readFileSync(mapPath, 'utf8')
    const oldLicences = JSON.parse(/const LICENCES[^=]*= (\[.*\])\n/.exec(source)?.[1] ?? '[]')
    const oldMatches = existsSync(matchesPath) ? JSON.parse(readFileSync(matchesPath, 'utf8')).players : []
    for (const [, id, row] of source.matchAll(/^ {2}("player-[^"]+"): (\[.*\]),$/gm)) {
      const playerId = JSON.parse(id), [player, author, licence, commonsFile] = JSON.parse(row)
      if (packIds.has(playerId) || Object.hasOwn(photos, playerId) || !existsSync(join(outDir, `${playerId}.webp`))) continue
      photos[playerId] = { player, author, licence: oldLicences[licence][0], licenceUrl: oldLicences[licence][1], commonsFile }
      const match = oldMatches.find(item => item.playerId === playerId)
      if (match) keptRows.push({ playerId, name: match.name, wikidata: match.wikidata, evidence: match.evidence, file: match.commonsFile })
    }
    if (keptRows.length) console.log(`Kept ${keptRows.length} photos of players no longer in this pack.`)
  }
  rows.push(...keptRows)
  // Photos of players no longer matched are removed so the folder and the map agree.
  for (const file of readdirSync(outDir)) if (file.endsWith('.webp') && !Object.hasOwn(photos, file.replace(/\.webp$/, ''))) rmSync(join(outDir, file))
  // Compact form (the map ships in the game bundle): licences listed once, file and page URL derived.
  const licences = [...new Map(Object.values(photos).map(photo => [`${photo.licence}|${photo.licenceUrl}`, [photo.licence, photo.licenceUrl]])).values()].sort((x, y) => x[0].localeCompare(y[0]))
  const licenceIndex = new Map(licences.map(([name, url], index) => [`${name}|${url}`, index]))
  const compact = Object.fromEntries(Object.entries(photos).sort(([x], [y]) => x.localeCompare(y)).map(([id, photo]) => [id, [photo.player, photo.author, licenceIndex.get(`${photo.licence}|${photo.licenceUrl}`), photo.commonsFile]]))
  const body = `// Generated by scripts/real-data-player-photos.mjs from Wikimedia Commons. Do not edit by hand.
// Each photo was cropped and resized from the Commons file named here; see public/photos/README.md.

export type PlayerPhoto = {
  /** Player name, for the Credits list. */
  player: string
  /** File in public/photos/players/. */
  file: string
  /** Photographer or author, as named on Commons. */
  author: string
  /** Licence short name, as on Commons (CC0, public domain, CC BY or CC BY-SA). */
  licence: string
  /** Licence deed, when the licence has one. */
  licenceUrl: string | null
  /** The Commons file page. */
  source: string
  /** CC BY-SA: the cropped photo stays under the same licence. */
  shareAlike?: true
}

/** [licence short name, licence deed URL]. */
const LICENCES: readonly (readonly [string, string | null])[] = ${JSON.stringify(licences)}

/** Real-pack player ID -> [player name, author, licence index, Commons file name]. */
const PHOTOS: Readonly<Record<string, readonly [string, string, number, string]>> = {
${Object.entries(compact).map(([id, row]) => `  ${JSON.stringify(id)}: ${JSON.stringify(row)},`).join('\n')}
}

/** Real-pack player ID -> photo. */
export const PLAYER_PHOTOS: Readonly<Record<string, PlayerPhoto>> = Object.fromEntries(Object.entries(PHOTOS).map(([id, [player, author, licence, file]]) => {
  const [name, url] = LICENCES[licence]!
  return [id, { player, file: \`\${id}.webp\`, author, licence: name, licenceUrl: url, source: \`https://commons.wikimedia.org/wiki/File:\${encodeURIComponent(file.replace(/ /g, '_'))}\`, ...(/-SA\\b/i.test(name) ? { shareAlike: true as const } : {}) }]
}))
`
  writeFileSync(join(root, 'src/data/player-photos.ts'), body)
  writeFileSync(join(root, 'real-data/player-photo-matches.json'), `${JSON.stringify({ source: 'Wikidata and Wikimedia Commons, matched 22 November 2026', players: rows.filter(row => Object.hasOwn(photos, row.playerId)).sort((a, b) => a.playerId.localeCompare(b.playerId)).map(({ playerId, name, wikidata, evidence, file }) => ({ playerId, name, wikidata, evidence, commonsFile: file })) }, null, 1)}\n`)
  const bytes = readdirSync(outDir).reduce((sum, file) => sum + statSync(join(outDir, file)).size, 0)
  console.log(`Wrote ${Object.keys(photos).length} photos, ${(bytes / 1024 / 1024).toFixed(2)} MB.`)
}
