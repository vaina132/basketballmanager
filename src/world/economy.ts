import type { ClubFinanceDefinition } from '../data/development-finances';
import type { DevelopmentPresident } from '../data/development-presidents';
import type { BackgroundLeague, CareerWorld, ClubEconomy, EconomyBand, EconomyChangeReason, EuropeanCompetition, EuropeanCompetitionKind, SeasonClubEconomy, SeasonEconomy, SeasonEconomyTable, WorldContext, WorldEconomyId } from '../domain/world';
import type { DomesticDivisions, SeasonEurope, SeasonState } from '../domain/season';
import type { RosterSnapshot } from '../domain/roster';
import type { Team } from '../domain/types';
import { DEVELOPMENT_WORLD } from '../data/development-world';
import { overallRating } from './overall-rating';
import { STAFF_BUDGET } from './staff-constants';
import { clubCountry, fullWorldClubsIn, worldOf } from './career-world';
import { seasonLeagues } from './divisions';

/**
 * Realistic money for real-club worlds (sprint 4, format 62). Every number below is a rule the owner can adjust; the
 * development world and test worlds (no `world.economy`) keep the development constants exactly.
 *
 * Sources (2025-27 money; [S] sourced, [D] derived, [E] estimate): published club budgets and league reports
 * (EuroLeague clubs' annual accounts and press reports, LNB DNCCG budgets, BBL licensing minimum, LBA/FIP and ACB
 * reports, Turkish and Greek press), salary reports by role, and league attendance reports (EuroLeague 2024-25
 * 10,589 at 84% fill; ACB 6,633; BBL 4,676 at 90%; Betclic Élite 4,139 at 94%; LBA 4,105 at 76%; Élite 2 2,785).
 * Amounts here are in euros; the game stores euro cents.
 */
export const REAL_ECONOMY_RULES = Object.freeze({
  id: 'real-2026-1' as WorldEconomyId,
  /**
   * Annual budget bands in euros: [low, typical, high]. A club's place inside its band follows its squad strength (the
   * best eight's average overall rating) among the clubs of the same band and country: the weakest gets `low`, the
   * median `typical`, the strongest `high`. EuroLeague clubs use the EuroLeague bands whatever their country.
   */
  budgets: Object.freeze({
    /** [S] Real Madrid, Panathinaikos, Olympiacos, Fenerbahçe, Efes, Barcelona, Milano, Bayern, Monaco: 48M (40-70M). */
    'euroleague-top': { default: [40e6, 48e6, 70e6] },
    /** [S] Baskonia 17-23, ASVEL 19-25, Virtus 25-28, Paris 29-31, Beşiktaş 20, Žalgiris 22-29: 25M (17-38M). */
    euroleague: { default: [17e6, 25e6, 38e6] },
    /**
     * [S] EuroCup/BCL level (Unicaja 19, Tortona 14.5, Alba 11.4, Ulm/Bonn 9.2, Bourg 8.1), per country so a club is
     * placed among its own country's upper half: Spain 8/11/19, Germany 7/9/14, France 5.5/7/9, Italy 7/10/15; [E] Turkey
     * 5/8/15, Greece 3/5/9 and every other country 4/7/12 (other countries' clubs are placed among each other).
     */
    'top-upper': { Spain: [8e6, 11e6, 19e6], Germany: [7e6, 9e6, 14e6], France: [5.5e6, 7e6, 9e6], Italy: [7e6, 10e6, 15e6], Turkey: [5e6, 8e6, 15e6], Greece: [3e6, 5e6, 9e6], default: [4e6, 7e6, 12e6] },
    /** [S] typical by country with minimums (France 3.7M, Germany 3.5M licensing rule, Italy 3.7M, Turkey 1.8M); [E] highs, Spain and Greece lows. */
    'top-lower': { France: [3.7e6, 5.5e6, 7.5e6], Germany: [3.5e6, 5.5e6, 7.5e6], Italy: [3.7e6, 6e6, 8e6], Spain: [3.5e6, 6e6, 8e6], Turkey: [1.8e6, 3e6, 5e6], Greece: [2e6, 2.5e6, 4e6], default: [2e6, 4e6, 6e6] },
    /** [S] France 3.5M (2-5.75M), Italy 2.0M, Spain 1.5M (0.4-2.6M), Turkey 1.0M; [E] Germany 1.5M, Greece 0.6M and the other ranges. */
    second: { France: [2e6, 3.5e6, 5.75e6], Italy: [1e6, 2e6, 3e6], Spain: [0.4e6, 1.5e6, 2.6e6], Germany: [0.8e6, 1.5e6, 2.5e6], Turkey: [0.5e6, 1e6, 1.8e6], Greece: [0.3e6, 0.6e6, 1e6], default: [0.5e6, 1e6, 2e6] },
    /** [E] Third divisions (Spain's Segunda FEB): no published figures; about a third of the second division. */
    third: { default: [0.15e6, 0.45e6, 0.9e6] },
  } as Readonly<Record<EconomyBand, Readonly<Record<string, readonly [number, number, number]>>>>),
  /**
   * [S] Published club budgets (EUR million) from the sprint-4 finance research (2025-27 money: the latest published
   * season, mostly 2025-26; club accounts, LNB budget tables, BBL licensing reports, Italian, Spanish, Greek and Turkish
   * press). They replace the strength placement of the budget amount only: the club keeps the band its competition gives
   * it. Matched on the whole normalised club name (accents, case and punctuation ignored); several spellings per club,
   * never a partial match, so reserve sides ("Fenerbahçe II") stay unmatched. Partizan, Crvena zvezda, Maccabi, Hapoel
   * Tel Aviv and Dubai have no reliable 2026-27 figure and keep the strength rule.
   */
  knownBudgets: Object.freeze([
    [60, ['real madrid']], [57, ['panathinaikos', 'panathinaikos aktor athens', 'panathinaikos athens']], [42, ['olympiacos', 'olympiakos', 'olympiacos piraeus']],
    [44, ['fenerbahce', 'fenerbahce beko', 'fenerbahce beko istanbul']], [35, ['anadolu efes', 'efes', 'anadolu efes istanbul']], [45, ['fc barcelona', 'barcelona', 'barca']],
    [40, ['olimpia milano', 'ea7 emporio armani milano', 'armani milano', 'ax armani exchange milano']], [39, ['as monaco', 'monaco', 'as monaco basket']],
    [48, ['bayern munich', 'fc bayern munich', 'bayern munchen', 'fc bayern munchen', 'fc bayern munchen basketball']], [25, ['virtus bologna', 'virtus segafredo bologna', 'virtus olidata bologna']],
    [31, ['paris basketball', 'paris']], [25, ['ldlc asvel', 'asvel', 'asvel villeurbanne', 'ldlc asvel villeurbanne']], [29, ['zalgiris kaunas', 'zalgiris']],
    [23, ['baskonia', 'saski baskonia', 'baskonia vitoria gasteiz']], [38, ['valencia basket', 'valencia basket club']], [20, ['besiktas', 'besiktas fibabanka', 'besiktas gain']],
    [19, ['unicaja', 'unicaja malaga']], [5.9, ['basquet coruna', 'leyma coruna', 'leyma basquet coruna']], [11.4, ['alba berlin']], [9.2, ['ratiopharm ulm']],
    [9.2, ['telekom baskets bonn']], [9.1, ['ewe baskets oldenburg']], [8.2, ['jl bourg', 'jl bourg en bresse', 'jeanne d arc bourg']],
    [7.5, ['le mans sarthe', 'le mans sarthe basket', 'le mans']], [7.2, ['elan chalon', 'chalon', 'elan chalon sur saone']], [7.1, ['sig strasbourg', 'strasbourg']],
    [6.5, ['cholet basket', 'cholet']], [6.4, ['jda dijon', 'dijon', 'jda dijon basket']], [6.2, ['limoges csp', 'limoges']], [5.9, ['bcm gravelines dunkerque', 'gravelines dunkerque', 'gravelines']],
    [5.8, ['sluc nancy', 'nancy', 'sluc nancy basket']], [5.6, ['nanterre 92', 'nanterre']], [4.1, ['saint quentin', 'saint quentin basket ball']], [3.9, ['boulazac', 'boulazac basket dordogne']],
    [3.7, ['essm le portel', 'le portel']], [14.5, ['derthona tortona', 'bertram derthona tortona', 'tortona']], [11, ['reyer venezia', 'umana reyer venezia', 'venezia']],
    [10, ['napoli basket', 'napoli', 'gevi napoli basket']], [10, ['varese', 'pallacanestro varese', 'openjobmetis varese']],
    [9, ['reggiana', 'pallacanestro reggiana', 'reggio emilia', 'unahotels reggio emilia']], [7, ['cantu', 'pallacanestro cantu', 'acqua s bernardo cantu']],
    [7, ['aquila trento', 'trento', 'dolomiti energia trento', 'aquila basket trento']], [6.5, ['verona', 'tezenis verona', 'scaligera verona']], [6.1, ['apu udine', 'udine', 'old wild west udine']],
    [6, ['treviso', 'treviso basket', 'nutribullet treviso']], [6, ['trieste', 'pallacanestro trieste']], [3.7, ['scafati', 'givova scafati', 'scafati basket']], [1.7, ['bursaspor', 'bursaspor basketbol', 'bursaspor info yatirim']],
  ] as readonly (readonly [number, readonly string[]])[]),
  /** [S] AS Monaco plays in France's LNB: clubs of these countries use the named country's rules. */
  countryAliases: Object.freeze({ Monaco: 'France' } as Readonly<Record<string, string>>),
  /** [S] The EuroLeague's strongest squads form its top group: this share of its clubs (9 of 20). */
  euroleagueTopShare: 0.45,
  /** [S] Players plus head coach, gross cost to the club, % of budget. */
  wageShare: Object.freeze({ 'euroleague-top': 55, euroleague: 45, 'top-upper': 40, 'top-lower': 38, second: 35, third: 35 } as Readonly<Record<EconomyBand, number>>),
  /** [E] The head coach's part of that wage bill; it funds the staff allocation (the game's coaches) instead of player wages. */
  headCoachPercent: 8,
  /** [E] Assistants, medical, scouting and youth staff, % of budget, added to the staff allocation. */
  supportStaffPercent: 3,
  /** [E] % of budget left unspent in the balance, for transfer fees, facility upkeep and upgrades. */
  reservePercent: 3,
  /** [E] Cash at the career's start, % of budget (the season's sponsorship and funding arrive at its opening). */
  openingCashPercent: 20,
  /**
   * [S] Revenue mix, % of budget. Tickets come from the club's own gate model below; sponsorship is booked as the club's
   * sponsorship; central, public, owner and other money form its season funding, which also covers any gap between
   * the gate model and the ticket share (the owner's share covers the gap, as in reality).
   */
  revenueMix: Object.freeze({
    'euroleague-top': { tickets: 20, sponsorship: 25, central: 10, public: 1, owner: 40, other: 4 },
    euroleague: { tickets: 25, sponsorship: 35, central: 12, public: 3, owner: 20, other: 5 },
    'top-upper': { tickets: 22, sponsorship: 45, central: 5, public: 10, owner: 13, other: 5 },
    'top-lower': { tickets: 22, sponsorship: 45, central: 5, public: 15, owner: 8, other: 5 },
    second: { tickets: 22, sponsorship: 36, central: 2, public: 24, owner: 6, other: 10 },
    /** [E] as the second division. */
    third: { tickets: 22, sponsorship: 36, central: 2, public: 24, owner: 6, other: 10 },
  } as Readonly<Record<EconomyBand, RevenueMix>>),
  /** [S] Country adjustments in points; the net change is taken from other income, then sponsorship, so the mix sums to 100. */
  countryMix: Object.freeze({ Spain: { public: 10 }, Italy: { owner: 10 }, Turkey: { owner: 15 }, Greece: { owner: 15 }, Germany: { owner: -5, sponsorship: 10 } } as Readonly<Record<string, Partial<RevenueMix>>>),
  /**
   * Player wages share the club's wage bill by rank in the squad (best overall rating first), the shape of real
   * contract lists: [S] Olympiacos 2024-25, 15 contracts 3.9 / 2.1 / 1.85 / 1.65 / 1.5 / 1.25 / 1.2 / 1.1 / 1.1 / 1.0 /
   * 0.75 / 0.65 / 0.6 / 0.6 / 0.5 (EUR million, top 20% of 19.75M); Panathinaikos' best paid 2.68M of 18.5M (14.5%).
   * `wageRanks` are the twelve regulars' weights, `wageExtra` each further player's (`wageFringe` from the fifteenth);
   * a rating `wageRating` points above the regulars' average multiplies a weight by e (within `wageRatingLimits`),
   * generated players' weights are halved, and no player takes more than `wageTopShare` of the bill. Equal ratings
   * share their places' weights. The band's bench minimum (net euros, below) is each player's floor. [S] Role bands,
   * net per season:
   * EuroLeague top star 2.5-5.0M, starter 1.0-2.5M, rotation 0.5-1.2M, bench 0.15-0.5M; other EuroLeague star 1.0-2.0M,
   * starter 0.5-1.0M, rotation 0.25-0.5M, bench 0.1-0.25M; top division upper star 350-700k, starter 150-350k, rotation
   * 80-150k, bench 30-80k; lower star 150-300k, starter 80-150k, rotation 40-80k, bench 15-40k; second division star
   * 60-120k, starter 35-60k, rotation 20-35k, bench 8-20k. [E] third division bench 4k.
   */
  benchFloor: Object.freeze({ 'euroleague-top': 150_000, euroleague: 100_000, 'top-upper': 30_000, 'top-lower': 15_000, second: 8_000, third: 4_000 } as Readonly<Record<EconomyBand, number>>),
  wageRanks: Object.freeze([15, 10, 9, 8.5, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4] as const),
  wageExtra: 2.5,
  wageFringe: 1.5,
  wageRating: 80,
  wageRatingLimits: Object.freeze([0.75, 1.25] as const),
  wageGenerated: 0.5,
  wageTopShare: 0.25,
  /** [S] Gross cost to the club per euro net: Spain, Germany 2.0; Italy 2.4; France 1.9; Greece 1.5; Turkey 1.4. [E] elsewhere 1.8. */
  costPerNet: Object.freeze({ Spain: 2, Germany: 2, Italy: 2.4, France: 1.9, Greece: 1.5, Turkey: 1.4, default: 1.8 } as Readonly<Record<string, number>>),
  /**
   * Gates: average arena seats, usual fill and average ticket yield in euros per league. [S] EuroLeague 10,589 at 84%
   * (about 12,600 seats) for €30-40; ACB 6,633 for €22; BBL 4,676 at 90% for €24; Betclic Élite 4,139 at 94% for €25;
   * LBA 4,105 at 76% for €15.5; BSL about 3,000 for €10; GBL about 2,000 for €10; Élite 2 2,785 for €15; Serie A2 about
   * 2,500 for €12; Primera FEB about 2,000 for €10; TBL about 800 for €5; other second divisions about 1,500 for €8.
   * [E] fills where only attendance is published, and third divisions.
   */
  gates: Object.freeze({
    euroleague: { seats: 12_600, fill: 0.84, price: 35 },
    top: { Spain: { seats: 8_300, fill: 0.8, price: 22 }, Germany: { seats: 5_200, fill: 0.9, price: 24 }, France: { seats: 4_400, fill: 0.94, price: 25 }, Italy: { seats: 5_400, fill: 0.76, price: 15.5 }, Turkey: { seats: 5_000, fill: 0.6, price: 10 }, Greece: { seats: 4_000, fill: 0.5, price: 10 }, default: { seats: 4_300, fill: 0.7, price: 12 } },
    second: { France: { seats: 3_500, fill: 0.8, price: 15 }, Italy: { seats: 3_600, fill: 0.7, price: 12 }, Spain: { seats: 3_100, fill: 0.65, price: 10 }, Turkey: { seats: 2_000, fill: 0.4, price: 5 }, default: { seats: 2_500, fill: 0.6, price: 8 } },
    third: { default: { seats: 1_500, fill: 0.5, price: 6 } },
  } as { euroleague: Gate; top: Readonly<Record<string, Gate>>; second: Readonly<Record<string, Gate>>; third: Readonly<Record<string, Gate>> }),
  /** [S] Bigger and stronger clubs draw more (Berlin 8,277, Bayern 6,943, Göttingen 2,546 against the BBL's 4,676): seats from 55% to 170% of the league's average by strength. */
  seatSpread: Object.freeze([0.55, 1, 1.7] as const),
  /** [E] Fill moves this much either side of the league's usual fill with strength. */
  fillSpread: 0.1,
  /** [S] EuroLeague yield €30-40 by strength; [E] other leagues' default price 85-115% of the yield. */
  euroleaguePrice: Object.freeze([30, 40] as const),
  priceSpread: Object.freeze([0.85, 1.15] as const),
  /** The price control ranges up to this multiple of a club's default price (the development world: €60 against €18). */
  maxPriceMultiple: 3,
  /** [E] Home games a season besides the domestic regular season: a playoff game on average, and European home games when played. */
  playoffHomeGames: 1,
  europeanHomeGames: Object.freeze({ eurocupGroups: 4, bcl: 4 }),
  /** [E] Automatic facility upgrades and wage prepayments keep at least this share of the annual operating cost in cash. */
  operatingCushionShare: 0.5,
  /** Contract and fee limits of worlds with this economy (euros): far above any researched salary or fee. */
  limits: Object.freeze({ maxContractWage: 15_000_000, maxTransferFee: 50_000_000, maxReleaseFee: 50_000_000 }),
  /**
   * Format 72 (saved ideas level, new careers only): club money follows promotion, relegation and European places.
   * At every rollover each full-world club's target figures are worked out by the rules above from its new band
   * (its division and tier, the European competition it enters, its country) and its squad strength among the clubs
   * of that band and country (last season's latest registrations), exactly as at world creation; a published budget
   * (`knownBudgets`) is the target while the club plays in the band it had at world creation. Bands overlap, so
   * moving down a band never raises the target budget above last season's and moving up never lowers it. The club's
   * arena and usual crowd stay its own. Every amount then moves `share` of the way from last season's figure to the
   * target (rounded on the change): half the gap in the first season, three quarters after two, so relegation hurts
   * but not overnight. Agreed contracts keep their wages; the player salary budget follows the season's player wage
   * bill (`playerBill`) against the opening one. New figures are known once the season is complete (its divisions and
   * European places are decided): offseason offers and budgets for the next season use them, and its money moves by
   * them from the rollover. A season's main sponsorship deal is priced a season earlier, so when a club's sponsorship
   * figure rises its season funding also covers the rise, and a club joining the full world (no deal possible for its
   * first season) has its whole sponsorship figure added to its funding. Older careers keep the world's opening figures.
   */
  seasons: Object.freeze({ share: 0.5 }),
  /**
   * [E] Staff pay (money gaps, 16 November 2026): above the development money level a staff member's fee grows with the
   * square root of the club's money level (`staffScale`), not in proportion like facility costs, because real staff pay
   * varies far less between clubs than budgets do (an assistant coach costs a EuroLeague club about EUR 0.2-0.5M gross,
   * a mid-table domestic club EUR 60-150k). Below it fees stay in proportion (part-time staff of small clubs). Facility
   * costs, upkeep and the staff allocation keep the money level (`scale`).
   */
  staffPayExponent: 0.5,
  /**
   * [E] Automatic facility upgrades (every club run automatically, money gaps fix): an upgrade keeps the rest of the
   * season's operating costs and upkeep, less `gateCautionShare` of the gate income the figures expect for the same
   * weeks (the cash outlook's cautious scenario), plus `seasonEndCashShare` of the budget as cash at the season's end;
   * and the extra upkeep of upgraded facilities, paid every season from the budget's reserve (`reservePercent`), stays
   * within `upkeepShare` of the budget.
   */
  automaticSpending: Object.freeze({ gateCautionShare: 0.75, seasonEndCashShare: 0.1, upkeepShare: 0.02 }),
});

type RevenueMix = { tickets: number; sponsorship: number; central: number; public: number; owner: number; other: number };
type Gate = { seats: number; fill: number; price: number };
const PER_MILLE = 1000;
const CENTS = 100;
const bandFor = <T>(table: Readonly<Record<string, T>>, country: string): T => table[country] ?? table.default!;
const lerp = (low: number, high: number, t: number) => low + (high - low) * t;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The world's economy, or null for the development economy. Never falls back to another world. */
export function worldEconomy(context: WorldContext | undefined): WorldEconomyId | null {
  return context?.world?.economy ?? null;
}

const economyIndexes = new WeakMap<CareerWorld, Map<string, ClubEconomy>>();
/** A club's opening figures (the world's, season one), or null in worlds without an economy. */
function openingEconomy(world: CareerWorld, clubId: string): ClubEconomy | null {
  if (!world.economy) return null;
  let index = economyIndexes.get(world);
  if (!index) { index = new Map(world.finances.flatMap(item => item.economy ? [[item.clubId, item.economy] as const] : [])); economyIndexes.set(world, index); }
  return index.get(clubId) ?? null;
}

/**
 * Format 72: a club's stored figures for a season after the first: the latest table up to that season that lists it
 * (a later season than the last table reads the last one; a club outside the full world keeps its last figures).
 */
function seasonEconomyEntry(seasons: SeasonEconomy, clubId: string, seasonNumber: number): SeasonClubEconomy | null {
  for (let index = Math.min(seasonNumber - 2, seasons.seasons.length - 1); index >= 0; index -= 1) {
    const entry = seasons.seasons[index]?.clubs[clubId];
    if (entry) return entry;
  }
  return null;
}

/**
 * A club's economy figures, or null in worlds without an economy (the development constants apply). Format 72: a
 * context naming its season and carrying the career's per-season figures reads that season's; any other context (and
 * every older career) reads the world's opening figures.
 */
export function clubEconomy(context: WorldContext | undefined, clubId: string): ClubEconomy | null {
  const world = context?.world;
  if (!context || !world?.economy) return null;
  const seasons = context.economySeasons, year = context.seasonNumber;
  if (seasons && year !== undefined && year > 1) {
    const entry = seasonEconomyEntry(seasons, clubId, year);
    if (entry) return entry;
  }
  return openingEconomy(world, clubId);
}

/**
 * A catalog amount (staff fee or allocation, facility cost or upkeep, cushion, board threshold) at the club's money
 * level, rounded to `step` cents. Unchanged in worlds without an economy.
 */
export function scaledMoney(context: WorldContext | undefined, clubId: string, amount: number, step = 10_000): number {
  const economy = clubEconomy(context, clubId);
  if (!economy || amount === 0) return amount;
  return Math.max(step, Math.round(amount * economy.scale / PER_MILLE / step) * step);
}

/**
 * A context reading the money figures of `seasonNumber` (format 72): the latest figures known up to that season. The
 * context itself when it already names that season.
 */
export function moneyAt<T extends WorldContext>(context: T, seasonNumber: number | undefined): T | WorldContext {
  if (seasonNumber === undefined || seasonNumber === context.seasonNumber || !context.economySeasons) return context;
  return { ...(context.world ? { world: context.world } : {}), ...(context.dataPackId ? { dataPackId: context.dataPackId } : {}), seasonNumber, economySeasons: context.economySeasons };
}

/**
 * Format 72: the latest season whose money figures a context knows. A completed season has decided the next season's
 * figures (`foreseeEconomy` stores them), so a context of a complete season knows one season further.
 */
export function knownMoneySeason(context: WorldContext & { status?: SeasonState['status'] }, fallback: number): number {
  const year = context.seasonNumber ?? fallback;
  return context.status === 'complete' ? year + 1 : year;
}

/**
 * The cash automatic control keeps back (facility upgrades, wage prepayments). Spendable cash protects wages and
 * fees but not operating costs; the development cushions are about one season of the development club's operating
 * cost, whose ticket income alone covers it. Real clubs' gates cover far less, so with an economy the cushion is at
 * least `operatingCushionShare` of the club's annual operating cost (format 62).
 */
export function automationCushion(context: WorldContext | undefined, clubId: string, amount: number): number {
  const economy = clubEconomy(context, clubId);
  if (!economy) return amount;
  return Math.max(scaledMoney(context, clubId, amount), Math.round(economy.operatingCost * REAL_ECONOMY_RULES.operatingCushionShare / 10_000) * 10_000);
}

/** The per-mille multiplier of staff fees for a per-mille money level: the level itself up to 1000 (the development level), then its `staffPayExponent` power. */
export const staffScale = (scale: number): number => scale <= PER_MILLE ? scale : Math.round(PER_MILLE * (scale / PER_MILLE) ** REAL_ECONOMY_RULES.staffPayExponent);

/**
 * A staff member's season fee for a club, unchanged in worlds without an economy. Format 62 put it at the club's money
 * level; since the money gaps fix (16 November 2026) it follows `staffScale` (the square root of a level above the
 * development one), rounded to EUR 100.
 */
export function staffFee(context: WorldContext | undefined, clubId: string, fee: number): number {
  const economy = clubEconomy(context, clubId);
  if (!economy || fee === 0) return fee;
  return Math.max(10_000, Math.round(fee * staffScale(economy.scale) / PER_MILLE / 10_000) * 10_000);
}

/**
 * The wage of a cheap squad player at a club's level (format 62's researched bench minimum of its band, at its country's
 * gross cost, in EUR 500 steps), from the figures of the context's season; null in worlds without an economy.
 */
export function benchWage(context: WorldContext | undefined, clubId: string): number | null {
  const economy = clubEconomy(context, clubId);
  if (!economy || !context?.world) return null;
  return Math.round(REAL_ECONOMY_RULES.benchFloor[economy.band] * bandFor(REAL_ECONOMY_RULES.costPerNet, moneyCountry(context.world, clubId)) * CENTS / 50_000) * 50_000;
}
const moneyCountries = new WeakMap<CareerWorld, Map<string, string>>();
/** A club's country for its money rules (its league's, a next division's or 'Other'; Monaco plays by France's), cached per world. */
function moneyCountry(world: CareerWorld, clubId: string): string {
  let index = moneyCountries.get(world);
  if (!index) { index = new Map(); moneyCountries.set(world, index); }
  let country = index.get(clubId);
  if (country === undefined) {
    const found = clubCountry(world, clubId) ?? world.lowerDivisions?.find(list => 'clubIds' in list && list.clubIds.includes(clubId))?.country ?? 'Other';
    country = REAL_ECONOMY_RULES.countryAliases[found] ?? found;
    index.set(clubId, country);
  }
  return country;
}

/** Best-eight average overall rating (as in career setup). */
function strengthOf(players: readonly Team['players'][number][]): number {
  const best = players.map(player => overallRating(player.attributes, player.position)).sort((a, b) => b - a).slice(0, 8);
  return best.length ? best.reduce((sum, value) => sum + value, 0) / best.length : 0;
}

/** Percentile of each member by strength within its group (weakest 0, strongest 1, a lone club 0.5; equal squads share their average place). */
function percentiles(groups: Map<string, string[]>, strength: ReadonlyMap<string, number>): Map<string, number> {
  const result = new Map<string, number>();
  for (const members of groups.values()) {
    const sorted = [...members].sort((a, b) => strength.get(a)! - strength.get(b)!);
    for (let start = 0; start < sorted.length;) {
      let end = start;
      while (end + 1 < sorted.length && strength.get(sorted[end + 1]!) === strength.get(sorted[start]!)) end += 1;
      const place = (start + end) / 2;
      for (let index = start; index <= end; index += 1) result.set(sorted[index]!, sorted.length > 1 ? place / (sorted.length - 1) : 0.5);
      start = end + 1;
    }
  }
  return result;
}
const addTo = (groups: Map<string, string[]>, key: string, clubId: string) => { const list = groups.get(key) ?? []; list.push(clubId); groups.set(key, list); };

/** The revenue mix of a band in a country, adjusted so it still sums to 100. */
export function revenueMixFor(band: EconomyBand, country: string): RevenueMix {
  const mix = { ...REAL_ECONOMY_RULES.revenueMix[band] };
  const change = REAL_ECONOMY_RULES.countryMix[country] ?? {};
  for (const [key, points] of Object.entries(change) as [keyof RevenueMix, number][]) mix[key] += points;
  let excess = Object.values(mix).reduce((sum, value) => sum + value, 0) - 100;
  for (const key of ['other', change.sponsorship ? 'central' : 'sponsorship'] as const) { const taken = Math.min(excess, mix[key]); mix[key] -= taken; excess -= taken; }
  return mix;
}

/** A club name for matching published budgets: lower case, no accents or punctuation, single spaces. */
export const normalClubName = (name: string): string => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const knownBudgetIndex = new Map(REAL_ECONOMY_RULES.knownBudgets.flatMap(([budget, names]) => names.map(name => [name, budget] as const)));
/** A club's published budget in euros (`knownBudgets`), or null when none is known. */
export const knownClubBudget = (name: string): number | null => { const budget = knownBudgetIndex.get(normalClubName(name)); return budget === undefined ? null : budget * 1e6; };

/**
 * Each player's season wage (club cost, cents, in €500 steps) sharing `bill` by rank in the squad (see `wageRanks`),
 * never below `floor` per player, the best paid at most `wageTopShare` of the bill. `generated` names generated players.
 */
export function shareWageBill(players: readonly Team['players'][number][], bill: number, floor: number, generated: ReadonlySet<string> = new Set()): Record<string, number> {
  const rules = REAL_ECONOMY_RULES;
  const ratings = players.map(player => overallRating(player.attributes, player.position));
  const order = players.map((_, index) => index).sort((a, b) => ratings[b]! - ratings[a]!);
  const rankWeight = (rank: number) => rank < rules.wageRanks.length ? rules.wageRanks[rank]! : rank < 14 ? rules.wageExtra : rules.wageFringe;
  // Equal ratings share the weights of the places they hold together.
  const place = new Array<number>(players.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && ratings[order[end + 1]!] === ratings[order[start]!]) end += 1;
    let total = 0;
    for (let rank = start; rank <= end; rank += 1) total += rankWeight(rank);
    for (let rank = start; rank <= end; rank += 1) place[order[rank]!] = total / (end - start + 1);
    start = end + 1;
  }
  const regulars = order.slice(0, rules.wageRanks.length).map(index => ratings[index]!);
  const average = regulars.reduce((sum, value) => sum + value, 0) / regulars.length;
  const [lowest, highest] = rules.wageRatingLimits;
  const weights = players.map((player, index) => place[index]! * clamp(Math.exp((ratings[index]! - average) / rules.wageRating), lowest, highest) * (generated.has(player.id) ? rules.wageGenerated : 1));
  const sum = weights.reduce((total, value) => total + value, 0);
  let shares = weights.map(value => value / sum);
  // No single player takes more than the top share; the rest keep their proportions.
  const best = shares.indexOf(Math.max(...shares));
  if (shares[best]! > rules.wageTopShare) { const rest = 1 - shares[best]!; shares = shares.map((value, index) => index === best ? rules.wageTopShare : value * (1 - rules.wageTopShare) / rest); }
  // Players below the floor get the floor; the others share what is left in proportion (a few passes settle it).
  const minimum = Math.min(floor, bill / players.length / 2);
  let amounts = shares.map(value => value * bill);
  for (let pass = 0; pass < 4; pass += 1) {
    const floored = amounts.map(value => value <= minimum);
    const free = bill - floored.filter(Boolean).length * minimum, flexible = amounts.reduce((total, value, index) => total + (floored[index] ? 0 : value), 0);
    amounts = amounts.map((value, index) => floored[index] ? minimum : value * free / flexible);
  }
  const limit = rules.limits.maxContractWage * CENTS;
  return Object.fromEntries(players.map((player, index) => {
    const wage = amounts[index]!;
    // Larger wages round to €5,000, smaller ones to €500 (the contract wage step).
    const step = wage >= 10_000_000 ? 500_000 : 50_000;
    return [player.id, clamp(Math.round(wage / step) * step, 500_000, limit)];
  }));
}

/** Where a club plays in a season, for its money: country, division tier, league (null outside any) and league size. */
interface EconomyPlace { country: string; tier: number; league: string | null; size: number }
/** Every club's place, band, European competition and placements within its band and gate groups. */
interface EconomyLayout {
  place: Map<string, EconomyPlace>;
  band: Map<string, EconomyBand>;
  competition: Map<string, EuropeanCompetition>;
  budgetT: Map<string, number>;
  gateT: Map<string, number>;
}
interface EconomyLayoutInput {
  leagues: readonly { id: string; country: string; tier: number; clubIds: readonly string[] }[];
  /** Next-division members (the world's lists at its creation, each season's members later). */
  lower: readonly { country: string; tier: number; clubIds: readonly string[] }[];
  background: readonly BackgroundLeague[];
  /** European competitions with this season's entrants. */
  competitions: readonly EuropeanCompetition[];
  /** Every club of the world, in world order. */
  clubIds: readonly string[];
  strength: ReadonlyMap<string, number>;
  countryOf: (clubId: string) => string | null;
}

/**
 * Bands and placements (format 62, reused by format 72 each season): the EuroLeague's strongest share is its top group;
 * other top-division clubs are upper half when they play the EuroCup or BCL, have no domestic league in the world, or
 * rank in the upper half of their league by strength. Budgets are placed within band and country, gates within league
 * (EuroLeague clubs among themselves).
 */
function economyLayout(input: EconomyLayoutInput): EconomyLayout {
  const rules = REAL_ECONOMY_RULES, { leagues, strength } = input;
  const lowest = (country: string) => { const own = leagues.filter(league => league.country === country); return own.find(league => league.tier === Math.max(...own.map(item => item.tier))); };
  // Each club's country, tier and the league it plays (or would join) in.
  const place = new Map<string, EconomyPlace>();
  for (const league of leagues) for (const clubId of league.clubIds) place.set(clubId, { country: league.country, tier: league.tier, league: league.id, size: league.clubIds.length });
  for (const list of input.lower) for (const clubId of list.clubIds) place.set(clubId, { country: list.country, tier: list.tier, league: `lower-${list.country}`, size: lowest(list.country)?.clubIds.length ?? list.clubIds.length });
  for (const league of input.background) for (const clubId of league.clubIds) if (!place.has(clubId)) place.set(clubId, { country: league.country, tier: 1, league: league.id, size: league.clubIds.length });
  for (const competition of input.competitions) for (const clubId of competition.clubIds) if (!place.has(clubId)) place.set(clubId, { country: competition.countries?.[clubId] ?? input.countryOf(clubId) ?? 'Other', tier: 1, league: null, size: 1 });
  for (const clubId of input.clubIds) if (!place.has(clubId)) place.set(clubId, { country: input.countryOf(clubId) ?? 'Other', tier: 1, league: null, size: 1 });
  for (const item of place.values()) item.country = rules.countryAliases[item.country] ?? item.country;
  // A club's European competition: the first that lists it.
  const competition = new Map<string, EuropeanCompetition>();
  for (const entry of input.competitions) for (const clubId of entry.clubIds) if (!competition.has(clubId)) competition.set(clubId, entry);
  const kindOf = (clubId: string) => competition.get(clubId)?.kind ?? null;

  const band = new Map<string, EconomyBand>();
  const euroleague = input.clubIds.filter(clubId => kindOf(clubId) === 'euroleague').sort((a, b) => strength.get(b)! - strength.get(a)! || (a < b ? -1 : 1));
  euroleague.forEach((clubId, index) => band.set(clubId, index < Math.round(euroleague.length * rules.euroleagueTopShare) ? 'euroleague-top' : 'euroleague'));
  const byLeague = new Map<string, string[]>();
  for (const [clubId, item] of place) if (item.league) addTo(byLeague, item.league, clubId);
  for (const [clubId, item] of place) {
    if (band.has(clubId)) continue;
    if (item.tier >= 3) { band.set(clubId, 'third'); continue; }
    if (item.tier === 2) { band.set(clubId, 'second'); continue; }
    const members = item.league ? [...byLeague.get(item.league)!].sort((a, b) => strength.get(b)! - strength.get(a)! || (a < b ? -1 : 1)) : [];
    band.set(clubId, !item.league || kindOf(clubId) || members.indexOf(clubId) < members.length / 2 ? 'top-upper' : 'top-lower');
  }

  const budgetGroups = new Map<string, string[]>(), gateGroups = new Map<string, string[]>();
  for (const [clubId, item] of place) {
    const own = band.get(clubId)!, euro = own === 'euroleague-top' || own === 'euroleague';
    // Within a band, clubs are placed among their own country's clubs; countries without their own range share one group.
    const country = rules.budgets[own][item.country] ? item.country : 'default';
    addTo(budgetGroups, `${own}/${euro ? '' : country}`, clubId);
    addTo(gateGroups, euro ? 'euroleague' : item.league ?? `${item.country}-${item.tier}`, clubId);
  }
  return { place, band, competition, budgetT: percentiles(budgetGroups, strength), gateT: percentiles(gateGroups, strength) };
}

/** A budget in euros placed by strength within its band and country (`t` from 0, the weakest, to 1, the strongest). */
function placedBudget(band: EconomyBand, country: string, t: number): number {
  const [low, typical, high] = bandFor(REAL_ECONOMY_RULES.budgets[band], country);
  return t < 0.5 ? lerp(low, typical, t * 2) : lerp(typical, high, t * 2 - 1);
}
/** A budget in euros as stored: rounded to EUR 10,000, in cents. */
const budgetCents = (euros: number): number => Math.round(euros / 10_000) * 10_000 * CENTS;

/** Gate: seats around the league's average by strength, a usual crowd within them, and the league's ticket yield. */
function gateFor(place: EconomyPlace, band: EconomyBand, g: number): { capacity: number; referenceDemand: number; ticketPrice: number } {
  const rules = REAL_ECONOMY_RULES, euro = band === 'euroleague-top' || band === 'euroleague';
  const gate = euro ? rules.gates.euroleague : bandFor(place.tier >= 3 ? rules.gates.third : place.tier === 2 ? rules.gates.second : rules.gates.top, place.country);
  const [small, middle, large] = rules.seatSpread;
  const capacity = clamp(Math.round(gate.seats * (g < 0.5 ? lerp(small, middle, g * 2) : lerp(middle, large, g * 2 - 1)) / 100) * 100, 500, 60_000);
  const referenceDemand = clamp(Math.round(capacity * clamp(gate.fill + rules.fillSpread * (g - 0.5), 0.2, 0.98) / 100) * 100, 100, capacity);
  const ticketPrice = Math.max(3, Math.round(euro ? lerp(rules.euroleaguePrice[0], rules.euroleaguePrice[1], g) : gate.price * lerp(rules.priceSpread[0], rules.priceSpread[1], g))) * CENTS;
  return { capacity, referenceDemand, ticketPrice };
}

/**
 * A club's season figures from its budget (cents), band, place, European competition and gate: sponsorship and season
 * funding that balance the budget with the expected gate, the player wage bill, operating costs, opening cash and the
 * scale for catalog amounts.
 */
function clubFigures(band: EconomyBand, place: EconomyPlace, competition: EuropeanCompetition | undefined, budget: number, gate: { capacity: number; referenceDemand: number; ticketPrice: number }): { economy: ClubEconomy; playerBill: number } {
  const rules = REAL_ECONOMY_RULES, { capacity, referenceDemand, ticketPrice } = gate;
  // Expected gate income: delegated pricing sells out at the price where the usual crowd fills the arena.
  const kind = competition?.kind ?? null;
  const european = !competition?.format ? 0 : kind === 'euroleague' ? competition.clubIds.length - 1 : kind === 'eurocup' ? Math.max(1, competition.clubIds.length / rules.europeanHomeGames.eurocupGroups - 1) : rules.europeanHomeGames.bcl;
  const homeGames = (place.league ? place.size - 1 + rules.playoffHomeGames : 0) + european;
  const tickets = Math.round(homeGames * capacity * ticketPrice * (referenceDemand / capacity) ** (1 / 1.4));
  const mix = revenueMixFor(band, place.country);
  const sponsorship = Math.round(budget * mix.sponsorship / 100 / 10_000) * 10_000;
  const funding = Math.max(0, Math.round((budget - sponsorship - tickets) / 10_000) * 10_000);
  // Costs: player wages, the staff allocation (head coach and support staff), a reserve and operating costs.
  const wageBill = budget * rules.wageShare[band] / 100;
  const playerBill = Math.round(wageBill * (100 - rules.headCoachPercent) / 100);
  const staff = wageBill * rules.headCoachPercent / 100 + budget * rules.supportStaffPercent / 100;
  const operatingCost = Math.max(0, Math.round((budget - playerBill - staff - budget * rules.reservePercent / 100) / 10_000) * 10_000);
  return {
    economy: { band, budget, sponsorship, funding, openingCash: Math.round(budget * rules.openingCashPercent / 100 / 10_000) * 10_000, ticketPrice, operatingCost, scale: Math.max(1, Math.round(staff / STAFF_BUDGET * PER_MILLE)) },
    playerBill,
  };
}

/** The player wage bill (cents) a club's figures fund, as `withRealEconomy` sets it from the budget and band. */
export function playerBillOf(economy: ClubEconomy): number {
  const wageBill = economy.budget * REAL_ECONOMY_RULES.wageShare[economy.band] / 100;
  return Math.round(wageBill * (100 - REAL_ECONOMY_RULES.headCoachPercent) / 100);
}

/**
 * Format 62: a real-club world whose money follows researched club budgets. Every club (chosen leagues, next
 * divisions, unchosen top divisions and European-only entrants) gets a band, a budget placed by squad strength, player
 * wages sharing the band's wage bill, a gate (seats, usual crowd, default ticket price), sponsorship and season
 * funding that balance the budget, operating costs, opening cash and a scale for catalog amounts. `countryOf` names a
 * European-only entrant's country when the world does not record it.
 */
export function withRealEconomy(world: CareerWorld, countryOf: (clubId: string) => string | null = () => null): CareerWorld {
  const rules = REAL_ECONOMY_RULES;
  const strength = new Map(world.clubs.map(club => [club.id, strengthOf(club.players)]));
  const layout = economyLayout({
    leagues: world.domesticLeagues ?? [], lower: (world.lowerDivisions ?? []).flatMap(list => 'clubIds' in list ? [list] : []), background: world.backgroundLeagues ?? [],
    competitions: world.europeanCompetitions ?? [], clubIds: world.clubs.map(club => club.id), strength, countryOf,
  });
  const capitals = DEVELOPMENT_WORLD.presidents.map(president => president.seasonCapital);

  const wages: Record<string, number> = {};
  const finances: ClubFinanceDefinition[] = world.finances.map(definition => {
    const clubId = definition.clubId, item = layout.place.get(clubId)!, own = layout.band.get(clubId)!;
    const club = world.clubs.find(entry => entry.id === clubId)!;
    // A published budget replaces the strength placement (the band stays the competition's).
    const budget = budgetCents(knownClubBudget(club.name) ?? placedBudget(own, item.country, layout.budgetT.get(clubId)!));
    const gate = gateFor(item, own, layout.gateT.get(clubId)!);
    const { economy, playerBill } = clubFigures(own, item, layout.competition.get(clubId), budget, gate);
    const floor = rules.benchFloor[own] * bandFor(rules.costPerNet, item.country) * CENTS;
    Object.assign(wages, shareWageBill(club.players, playerBill, floor, new Set(club.players.filter(player => world.playerProfiles[player.id]?.source === 'generated').map(player => player.id))));
    return { ...definition, capacity: gate.capacity, referenceDemand: gate.referenceDemand, economy };
  });
  const scaleOf = new Map(finances.map(item => [item.clubId, item.economy!.scale]));
  const presidents: DevelopmentPresident[] = world.presidents.map((president, index) => ({ ...president, seasonCapital: Math.max(10_000, Math.round(capitals[index % capitals.length]! * scaleOf.get(president.clubId)! / PER_MILLE / 10_000) * 10_000) }));
  return { ...world, economy: rules.id, wages: { ...world.wages, ...wages }, finances, presidents };
}

/** Bands from the smallest to the largest money level: the direction of a change between seasons. */
const BAND_RANK: Readonly<Record<EconomyBand, number>> = Object.freeze({ third: 0, second: 1, 'top-lower': 2, 'top-upper': 3, euroleague: 4, 'euroleague-top': 5 });
const strengthCache = new WeakMap<readonly Team['players'][number][], number>();
const cachedStrength = (players: readonly Team['players'][number][]): number => {
  let value = strengthCache.get(players);
  if (value === undefined) { value = strengthOf(players); strengthCache.set(players, value); }
  return value;
};

/** Each club's squad strength after a season: its latest registration that season, else its world squad. */
function strengthAfter(world: CareerWorld, rosters: readonly RosterSnapshot[] | undefined): Map<string, number> {
  const latest = new Map<string, RosterSnapshot>();
  for (const roster of rosters ?? []) { const last = latest.get(roster.clubId); if (!last || roster.fromRound >= last.fromRound) latest.set(roster.clubId, roster); }
  return new Map(world.clubs.map(club => [club.id, cachedStrength(latest.get(club.id)?.players ?? club.players)]));
}

/**
 * A season's layout: the season's divisions, next-division members (each list's clubs and the country's clubs that
 * dropped out of the full world, less those now in a division), unchosen top divisions and the season's European entrants.
 */
function seasonLayout(world: CareerWorld, divisions: DomesticDivisions | undefined, europe: SeasonEurope | undefined, strength: ReadonlyMap<string, number>): EconomyLayout {
  const leagues = seasonLeagues(world, divisions), inLeague = new Set(leagues.flatMap(league => league.clubIds));
  const opening = world.domesticLeagues ?? [];
  const lower = (world.lowerDivisions ?? []).flatMap(list => 'clubIds' in list ? [{ country: list.country, tier: list.tier, clubIds: [...new Set([...list.clubIds, ...opening.filter(league => league.country === list.country).flatMap(league => league.clubIds)])].filter(clubId => !inLeague.has(clubId)) }] : []);
  const competitions = (world.europeanCompetitions ?? []).map(competition => { const entry = europe?.entrants.find(item => item.competitionId === competition.id); return entry ? { ...competition, clubIds: entry.clubIds } : competition; });
  return economyLayout({ leagues, lower, background: world.backgroundLeagues ?? [], competitions, clubIds: world.clubs.map(club => club.id), strength, countryOf: clubId => clubCountry(world, clubId) });
}

/** Why a club's band changed between two seasons' places. */
function changeReasons(before: { tier: number; kind: EuropeanCompetitionKind | null; band: EconomyBand }, after: { tier: number; kind: EuropeanCompetitionKind | null; band: EconomyBand }): EconomyChangeReason[] {
  const reasons: EconomyChangeReason[] = [];
  if (after.tier < before.tier) reasons.push('promoted');
  else if (after.tier > before.tier) reasons.push('relegated');
  if (before.kind !== after.kind) {
    if (before.kind) reasons.push(`left-${before.kind}`);
    if (after.kind) reasons.push(`joined-${after.kind}`);
  }
  if (!reasons.length && before.band !== after.band) reasons.push('band');
  return reasons;
}

/** What a season's figures are computed from: the world, every completed season and this season's divisions, places and exchanges. */
export type EconomySeasonsContext = WorldContext & Pick<SeasonState, 'seasonNumber' | 'history'> & Partial<Pick<SeasonState, 'divisions' | 'europe' | 'background' | 'rosters'>>;
/** The next season's divisions and European entrants, decided by a complete season (`nextSeasonDivisions`, `europeanPlacesAfter`). */
export interface EconomyForesight { divisions: DomesticDivisions | undefined; europe: SeasonEurope | undefined }

/**
 * Format 72: every season's club figures from the second season to the current one, derived only from recorded
 * evidence (the world, each season's divisions and European entrants, the clubs joining or leaving the full world and
 * each completed season's latest registrations), so a save re-derives them exactly. See `REAL_ECONOMY_RULES.seasons`.
 * With `next` (a complete season), the next season's figures follow as well, from this season's registrations and the
 * divisions and places it decided: exactly the table the rollover computes.
 */
export function computeEconomySeasons(context: EconomySeasonsContext, next?: EconomyForesight): SeasonEconomyTable[] {
  if (next) {
    // The completed season as the rollover archives it: its divisions, European entrants and registrations.
    const archive = { seasonNumber: context.seasonNumber, divisions: context.divisions, europe: context.europe, rosters: context.rosters ?? [], fixtures: [] } as unknown as SeasonState['history'][number];
    return computeEconomySeasons({ ...context, seasonNumber: context.seasonNumber + 1, history: [...context.history, archive], divisions: next.divisions, europe: next.europe });
  }
  const world = worldOf(context);
  if (!world.economy || context.seasonNumber < 2) return [];
  const share = REAL_ECONOMY_RULES.seasons.share;
  const divisionsOf = (year: number) => year === context.seasonNumber ? context.divisions : context.history[year - 1]?.divisions;
  const europeOf = (year: number) => year === context.seasonNumber ? context.europe : context.history[year - 1]?.europe;
  const definitions = new Map(world.finances.map(definition => [definition.clubId, definition]));
  const names = new Map(world.clubs.map(club => [club.id, club.name]));
  // The figures each club moves from: its latest stored season, else the world's opening figures.
  const latest = new Map<string, ClubEconomy & { playerBill?: number }>(world.finances.flatMap(definition => definition.economy ? [[definition.clubId, definition.economy] as const] : []));
  let previous = seasonLayout(world, divisionsOf(1), europeOf(1), strengthAfter(world, undefined));
  const tables: SeasonEconomyTable[] = [];
  const move = (from: number, to: number, step: number) => from + Math.round((to - from) * share / step) * step;
  for (let year = 2; year <= context.seasonNumber; year += 1) {
    const archive = context.history[year - 2];
    if (!archive) throw new Error('Club money needs every completed season.');
    const layout = seasonLayout(world, divisionsOf(year), europeOf(year), strengthAfter(world, archive.rosters));
    const clubs: Record<string, SeasonClubEconomy> = {};
    const members = new Set(fullWorldClubsIn(context, year - 1).map(club => club.id));
    for (const club of fullWorldClubsIn(context, year)) {
      const clubId = club.id, item = layout.place.get(clubId)!, band = layout.band.get(clubId)!, prior = latest.get(clubId)!;
      const opening = openingEconomy(world, clubId)!, known = knownClubBudget(names.get(clubId)!);
      // A published budget describes the club at its opening level; elsewhere the strength placement applies.
      let budget = budgetCents(known !== null && band === opening.band ? known : placedBudget(band, item.country, layout.budgetT.get(clubId)!));
      if (BAND_RANK[band] < BAND_RANK[prior.band]) budget = Math.min(budget, prior.budget);
      else if (BAND_RANK[band] > BAND_RANK[prior.band]) budget = Math.max(budget, prior.budget);
      // The club's own arena and usual crowd, at its new league's ticket yield.
      const definition = definitions.get(clubId)!;
      const gate = { capacity: definition.capacity, referenceDemand: definition.referenceDemand, ticketPrice: gateFor(item, band, layout.gateT.get(clubId)!).ticketPrice };
      const target = clubFigures(band, item, layout.competition.get(clubId), budget, gate);
      const before = previous.place.get(clubId)!;
      const sponsorship = Math.max(0, move(prior.sponsorship, target.economy.sponsorship, 10_000));
      // Money gaps fix: a season's main sponsorship deal is priced a season earlier, so when the sponsorship figure rises
      // the season's funding also covers the rise; a club joining the full world could sign no deal for its first season.
      const lag = members.has(clubId) ? Math.max(0, sponsorship - prior.sponsorship) : sponsorship;
      clubs[clubId] = {
        band,
        budget: Math.max(1_000_000, move(prior.budget, target.economy.budget, 1_000_000)),
        sponsorship,
        funding: Math.max(0, move(prior.funding, target.economy.funding, 10_000)) + lag,
        openingCash: Math.max(0, move(prior.openingCash, target.economy.openingCash, 10_000)),
        ticketPrice: Math.max(100, move(prior.ticketPrice, target.economy.ticketPrice, 100)),
        operatingCost: Math.max(0, move(prior.operatingCost, target.economy.operatingCost, 10_000)),
        scale: Math.max(1, move(prior.scale, target.economy.scale, 1)),
        playerBill: Math.max(0, move(prior.playerBill ?? playerBillOf(prior), target.playerBill, 10_000)),
        target: target.economy.budget,
        reasons: changeReasons({ tier: before.tier, kind: previous.competition.get(clubId)?.kind ?? null, band: previous.band.get(clubId)! }, { tier: item.tier, kind: layout.competition.get(clubId)?.kind ?? null, band }),
      };
    }
    for (const [clubId, entry] of Object.entries(clubs)) latest.set(clubId, entry);
    tables.push({ seasonNumber: year, clubs });
    previous = layout;
  }
  return tables;
}

/** Format 72: a new career's per-season figures, in real-data worlds whose career starts with club finances. */
export function createEconomySeasons(): SeasonEconomy {
  return { model: 'economy-seasons-1', seasons: [] };
}

/**
 * At a rollover (format 72 careers): the new season's figures, before any money of the new season moves. Ticket plans
 * stay within the new price range (three times the club's new default price).
 */
export function growEconomy(state: SeasonState): SeasonState {
  if (!state.economySeasons) return state;
  const next: SeasonState = { ...state, economySeasons: { ...state.economySeasons, seasons: computeEconomySeasons(state) } };
  if (!next.finance.enabledSince) return next;
  const limit = (clubId: string) => (clubEconomy(next, clubId)?.ticketPrice ?? 0) * REAL_ECONOMY_RULES.maxPriceMultiple;
  const plans = Object.fromEntries(Object.entries(next.finance.plans).map(([clubId, plan]) => [clubId, plan.price > limit(clubId) ? { ...plan, price: limit(clubId) } : plan]));
  const roundPrices = Object.fromEntries(Object.entries(next.finance.roundPrices).map(([clubId, price]) => [clubId, Math.min(price, limit(clubId))]));
  return { ...next, finance: { ...next.finance, plans, roundPrices } };
}

/**
 * Format 72: the player salary budget's multiple of its opening amount for contracts of `seasonNumber`: that season's
 * player wage bill against the opening one, from the figures known by `knownThrough` (a later season reads the latest
 * known figures). 1 for every career without per-season figures.
 */
export function salaryBudgetRatio(context: WorldContext & { status?: SeasonState['status'] }, clubId: string, seasonNumber: number, knownThrough = knownMoneySeason(context, seasonNumber)): number {
  const world = context.world;
  if (!world?.economy || !context.economySeasons) return 1;
  const year = Math.min(seasonNumber, knownThrough);
  const entry = year > 1 ? seasonEconomyEntry(context.economySeasons, clubId, year) : null, opening = openingEconomy(world, clubId);
  return entry && opening ? entry.playerBill / playerBillOf(opening) : 1;
}

/** Format 72: a club's band and budget this season and last, with the reasons for the change (null without per-season figures). */
export function economyChange(context: WorldContext & { seasonNumber: number }, clubId: string): { band: EconomyBand; budget: number; target: number; previous: ClubEconomy | null; reasons: readonly EconomyChangeReason[] } | null {
  const world = context.world;
  if (!world?.economy || !context.economySeasons) return null;
  const current = clubEconomy(context, clubId);
  if (!current) return null;
  const entry = context.seasonNumber > 1 ? context.economySeasons.seasons[context.seasonNumber - 2]?.clubs[clubId] ?? null : null;
  const previous = context.seasonNumber > 1 ? clubEconomy({ ...context, seasonNumber: context.seasonNumber - 1 }, clubId) : null;
  return { band: current.band, budget: current.budget, target: entry?.target ?? current.budget, previous, reasons: entry?.reasons ?? [] };
}

/** The money fields a world with an economy carries on each club's finance definition. */
export const CLUB_ECONOMY_KEYS = ['band', 'budget', 'sponsorship', 'funding', 'openingCash', 'ticketPrice', 'operatingCost', 'scale'] as const;
export const ECONOMY_BANDS: readonly EconomyBand[] = ['euroleague-top', 'euroleague', 'top-upper', 'top-lower', 'second', 'third'];
/** The largest single amount a club economy may carry (EUR 200 million), well inside safe integers. */
export const MAX_ECONOMY_AMOUNT = 20_000_000_000;
