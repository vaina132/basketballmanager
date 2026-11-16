import type { SeasonState } from '../domain/season'
import type { Player, Position } from '../domain/types'
import { worldOf } from '../world/career-world'
import { seasonLeagues } from '../world/divisions'
import { contractForRound, contractForSeason, getAvailablePlayers } from '../world/employment-policy'
import { abilityRating, type AbilityRating } from '../world/performance-rating'
import { getCareerPlayerAge, getCareerWage } from '../world/player-catalog'
import { getInSeasonCandidates, getInSeasonTransferCandidates, requiredInSeasonTransferFee } from '../world/recruitment-policy'
import { getApplicableReleaseClause } from '../world/release-clauses'
import { getScoutingDiscovery } from '../world/scouting-discovery'
import { getPlayerKnowledge } from '../world/scouting-policy'
import { MAX_SEASON_NUMBER } from '../world/season'
import { getTransferCandidates, requiredTransferFee } from '../world/transfers-policy'

/**
 * Transfers' player search (owner, 16 November 2026: "the place where I can search and try to find the players to
 * transfer to my team"). It lists the players the existing market rules let the manager sign or approach now, within
 * the scouting rules: only identities in the club's scouting range, shortlist and reports are shown, and ratings are
 * the manager's knowledge (unscouted players stay unknown). Reading only; no rule or randomness lives here.
 */
export type TransferMarketPhase = 'season' | 'offseason' | 'closed'
export type TransferRowKind = 'season-free' | 'season-transfer' | 'offseason-free' | 'offseason-transfer'
export type TransferSort = 'rating' | 'wage' | 'fee' | 'age' | 'contract' | 'name'

export interface TransferSearchRow {
  player: Player
  kind: TransferRowKind
  /** The club holding his registration now (in-season) or his contract for next season (offseason); null for a free agent. */
  clubId: string | null
  /** The club he plays for today, if any (an offseason free agent may still finish a contract there). */
  currentClubId: string | null
  leagueId: string | null
  country: string | null
  age: number | null
  rating: AbilityRating
  /** His asking wage per year. */
  wage: number
  /** The selling club's asking fee; null for a free agent. */
  fee: number | null
  releaseFee: number | null
  /** The last season of the contract a buyer would take over; null for a free agent. */
  contractEnds: number | null
}

export interface TransferSearchFilters {
  query: string
  position: Position | 'all'
  minAge: number | null
  maxAge: number | null
  /** Lowest star rating the manager's estimate could reach; 0 for any (unknown ratings then stay listed). */
  minStars: number
  maxWage: number | null
  maxFee: number | null
  /** Contracts ending by this season (free agents included); null for any. */
  contractEndsBy: number | null
  /** 'all', 'country:<name>', 'league:<id>' or 'free'. */
  league: string
  freeOnly: boolean
  sort: TransferSort
}

export const DEFAULT_TRANSFER_FILTERS: TransferSearchFilters = { query: '', position: 'all', minAge: null, maxAge: null, minStars: 0, maxWage: null, maxFee: null, contractEndsBy: null, league: 'all', freeOnly: false, sort: 'rating' }

export interface TransferSearch {
  phase: TransferMarketPhase
  rows: TransferSearchRow[]
  /** Signable or approachable players before the scouting range is applied. */
  marketCount: number
  /** Whether the scouting range limits the list (scouting enabled). */
  scouted: boolean
}

export function transferMarketPhase(season: SeasonState): TransferMarketPhase {
  if (!season.employment.enabledSince) return 'closed'
  if (season.status === 'active') return 'season'
  const nextYear = season.seasonNumber + 1
  return nextYear <= MAX_SEASON_NUMBER && season.employment.market?.seasonNumber === nextYear ? 'offseason' : 'closed'
}

export function getTransferSearch(season: SeasonState): TransferSearch {
  const phase = transferMarketPhase(season)
  const nextYear = season.seasonNumber + 1
  const groups: [TransferRowKind, readonly Player[]][] = phase === 'season'
    ? [['season-free', getInSeasonCandidates(season)], ['season-transfer', getInSeasonTransferCandidates(season)]]
    : phase === 'offseason' ? [['offseason-free', getAvailablePlayers(season)], ['offseason-transfer', season.market.enabledSince ? getTransferCandidates(season) : []]] : []
  // The own squad's unrenewed players are renewals, on Squad > Contracts, not transfer targets.
  const ownSquad = new Set(season.clubs.find(club => club.id === season.managedClubId)?.players.map(player => player.id) ?? [])
  const candidates = groups.flatMap(([kind, players]) => players.filter(player => !ownSquad.has(player.id)).map(player => ({ kind, player })))
  const scouted = season.scouting.enabledSince !== null
  const visible = scouted ? new Set(getScoutingDiscovery(season).playerIds) : null
  const listed = visible ? candidates.filter(entry => visible.has(entry.player.id)) : candidates
  const leagues = seasonLeagues(worldOf(season), season.divisions)
  const leagueOf = (clubId: string | null) => clubId ? leagues.find(league => league.clubIds.includes(clubId)) ?? null : null
  const clubOfPlayer = new Map(season.clubs.flatMap(club => club.players.map(player => [player.id, club.id] as const)))
  const currentClubOf = (playerId: string) => clubOfPlayer.get(playerId) ?? null
  const rows = listed.map(({ kind, player }): TransferSearchRow => {
    const contract = kind === 'season-transfer' ? contractForRound(season.employment, player.id, season.seasonNumber, season.round) : kind === 'offseason-transfer' ? contractForSeason(season.employment, player.id, nextYear) : null
    const currentClubId = currentClubOf(player.id)
    const clubId = contract?.clubId ?? null
    const league = leagueOf(clubId ?? currentClubId)
    return {
      player, kind, clubId, currentClubId, leagueId: league?.id ?? null, country: league?.country ?? null,
      age: getCareerPlayerAge(season, player.id, season.date),
      rating: abilityRating(getPlayerKnowledge(season, player.id), { position: player.position }),
      wage: getCareerWage(season, player.id),
      fee: kind === 'season-transfer' ? requiredInSeasonTransferFee(season, player.id) : kind === 'offseason-transfer' ? requiredTransferFee(season, player.id) : null,
      releaseFee: kind === 'season-transfer' ? getApplicableReleaseClause(season, player.id).fee : contract?.releaseFee ?? null,
      contractEnds: contract?.endsSeason ?? null,
    }
  })
  return { phase, rows, marketCount: candidates.length, scouted }
}

export function filterTransferRows(rows: readonly TransferSearchRow[], filters: TransferSearchFilters): TransferSearchRow[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return rows.filter(row => {
    if (query && !row.player.name.toLocaleLowerCase().includes(query)) return false
    if (filters.position !== 'all' && row.player.position !== filters.position) return false
    if ((filters.minAge !== null || filters.maxAge !== null) && (row.age === null || filters.minAge !== null && row.age < filters.minAge || filters.maxAge !== null && row.age > filters.maxAge)) return false
    if (filters.minStars > 0 && (row.rating.max === null || row.rating.max < filters.minStars)) return false
    if (filters.maxWage !== null && row.wage > filters.maxWage) return false
    if (filters.maxFee !== null && (row.fee ?? 0) > filters.maxFee) return false
    if (filters.contractEndsBy !== null && row.contractEnds !== null && row.contractEnds > filters.contractEndsBy) return false
    if (filters.freeOnly && row.fee !== null) return false
    if (filters.league === 'free' && row.clubId !== null) return false
    if (filters.league.startsWith('league:') && row.leagueId !== filters.league.slice(7)) return false
    if (filters.league.startsWith('country:') && row.country !== filters.league.slice(8)) return false
    return true
  })
}

/** Unknown ratings and ages stay last in every order. */
export function sortTransferRows(rows: readonly TransferSearchRow[], sort: TransferSort): TransferSearchRow[] {
  const byName = (left: TransferSearchRow, right: TransferSearchRow) => left.player.name.localeCompare(right.player.name, 'en') || left.player.id.localeCompare(right.player.id, 'en')
  const nullsLast = (left: number | null, right: number | null) => left === null ? right === null ? 0 : 1 : right === null ? -1 : left - right
  const compare: Record<TransferSort, (left: TransferSearchRow, right: TransferSearchRow) => number> = {
    // Best first by the conservative estimate, then its upper bound (as Scouting's rating order).
    rating: (left, right) => nullsLast(left.rating.low === null ? null : -left.rating.low, right.rating.low === null ? null : -right.rating.low) || (right.rating.high ?? 0) - (left.rating.high ?? 0),
    wage: (left, right) => left.wage - right.wage,
    fee: (left, right) => (left.fee ?? 0) - (right.fee ?? 0),
    age: (left, right) => nullsLast(left.age, right.age),
    contract: (left, right) => (left.contractEnds ?? 0) - (right.contractEnds ?? 0),
    name: () => 0,
  }
  return [...rows].sort((left, right) => compare[sort](left, right) || byName(left, right))
}
