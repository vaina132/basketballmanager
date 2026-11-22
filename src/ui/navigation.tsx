import { Icon, type IconName } from './Icon'

export type Page = 'home' | 'inbox' | 'squad' | 'match' | 'season' | 'training' | 'staff' | 'club' | 'board' | 'transfers' | 'medical' | 'academy' | 'calendar' | 'europe' | 'national'
/**
 * Owner feedback (18 November 2026): the budget bar shows only where money is decided: the desk, Transfers,
 * Squad > Contracts, Staff and Club (facilities and the bank).
 */
export function showsBudgetBar(page: Page, view?: string): boolean {
  // Board is a tab of Club (owner, 22 November 2026); the bar stays with facilities and the bank.
  return page === 'home' || page === 'transfers' || page === 'staff' || page === 'club' && view !== 'board' || page === 'squad' && view === 'contracts'
}
export interface NavItem { id: Page; label: string; icon: IconName }

export type SquadView = 'selection' | 'performance' | 'relationships' | 'contracts' | 'medical'
/**
 * The Squad page's views, in order. Medical joined them in the simplify pass; the wage list moved inside Contracts
 * (owner decisions, 22 November 2026).
 */
export const SQUAD_VIEWS: readonly { id: SquadView; label: string }[] = [
  { id: 'selection', label: 'Selection' },
  { id: 'performance', label: 'Statistics' },
  { id: 'relationships', label: 'Dynamics' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'medical', label: 'Medical' },
]
/**
 * Competitions' tabs (owner, 22 November 2026, evening): Calendar, League (the manager's own league), International (the
 * European competitions his club plays), European Leagues (every other domestic league, with the simulated tables of
 * countries not played) and National Teams. An NBA tab comes later, once the NBA is in the game.
 */
export type CompetitionsView = 'calendar' | 'league' | 'international' | 'leagues' | 'national'
export type TrainingView = 'plan' | 'academy'
export type ClubView = 'club' | 'board'
export interface ViewTab<T extends string> { id: T; label: string; icon: IconName }

/** Which of Competitions' tabs a career has. */
export interface CompetitionsTabs {
  /** The manager has a club, so a league of his own (an unemployed manager has none). */
  league: boolean
  /** The world plays European club competitions. */
  international: boolean
  /** The world has domestic leagues besides the manager's own (played, or with a simulated table). */
  leagues: boolean
  /** Format 80: the world has national teams. */
  national: boolean
}
/**
 * Competitions' tabs in the owner's order (22 November 2026, evening). Calendar is always there; the others only where
 * they have something to show, so no tab is a placeholder.
 */
export function competitionsViews({ league, international, leagues, national }: CompetitionsTabs): ViewTab<CompetitionsView>[] {
  return [
    { id: 'calendar', label: 'Calendar', icon: 'calendar' },
    ...(league ? [{ id: 'league' as const, label: 'League', icon: 'ball' as const }] : []),
    ...(international ? [{ id: 'international' as const, label: 'International', icon: 'star' as const }] : []),
    ...(leagues ? [{ id: 'leagues' as const, label: 'European Leagues', icon: 'globe' as const }] : []),
    ...(national ? [{ id: 'national' as const, label: 'National Teams', icon: 'target' as const }] : []),
  ]
}
/**
 * The tab shown when the one asked for is not there: an unemployed manager's League opens European Leagues, and a link
 * to European competitions in a world without them opens European Leagues too; otherwise the first tab with content.
 */
export function shownCompetitionsView(wanted: CompetitionsView, tabs: readonly { id: CompetitionsView }[]): CompetitionsView {
  const has = (view: CompetitionsView) => tabs.some(tab => tab.id === view)
  if (has(wanted)) return wanted
  const order: readonly CompetitionsView[] = wanted === 'international' || wanted === 'league' ? ['leagues', 'league', 'international'] : ['league', 'leagues', 'international']
  return order.find(has) ?? tabs[0]?.id ?? 'league'
}
/**
 * Where an old link to the Europe page lands (it was a tab before 22 November 2026, evening): International when the
 * manager's club plays a European competition this season (or he has no club, so International lists them all),
 * otherwise European Leagues, which holds the other leagues the old page listed.
 */
export function europeLinkView(clubPlaysEurope: boolean): CompetitionsView {
  return clubPlaysEurope ? 'international' : 'leagues'
}
export const TRAINING_VIEWS: readonly ViewTab<TrainingView>[] = [{ id: 'plan', label: 'Training', icon: 'training' }, { id: 'academy', label: 'Academy', icon: 'people' }]
export const CLUB_VIEWS: readonly ViewTab<ClubView>[] = [{ id: 'club', label: 'Facilities & money', icon: 'building' }, { id: 'board', label: 'Board', icon: 'shield' }]

/** A tab of a page with views. */
export type PageView = { page: 'squad'; view: SquadView } | { page: 'season'; view: CompetitionsView } | { page: 'training'; view: TrainingView } | { page: 'club'; view: ClubView }

/** Pages that became a view of another page: links to them open that view, so nothing is lost. */
export const MERGED_PAGES: Partial<Record<Page, PageView>> = {
  medical: { page: 'squad', view: 'medical' },
  calendar: { page: 'season', view: 'calendar' },
  europe: { page: 'season', view: 'international' },
  academy: { page: 'training', view: 'academy' },
  board: { page: 'club', view: 'board' },
}
/** The tab a page opens on from its menu item or a plain link (Squad keeps the view it was left on). */
const FIRST_VIEWS: Partial<Record<Page, PageView>> = { season: { page: 'season', view: 'league' }, training: { page: 'training', view: 'plan' }, club: { page: 'club', view: 'club' } }

/**
 * Competitions > National Teams: the national-team links (Inbox, the national team page's "Competitions" link, and
 * "National team" while the manager has no national job). A link to a tab names it, so navigating cannot reset it.
 */
export const NATIONAL_TEAMS_LINK: PageView = Object.freeze({ page: 'season', view: 'national' })

/** Where a link to a page lands: a merged page opens its tab on the page that holds it; a link to a tab opens that tab. */
export function resolveNavigation(target: Page | PageView): { page: Page; view: PageView | null } {
  if (typeof target !== 'string') return { page: target.page, view: target }
  const view = MERGED_PAGES[target] ?? FIRST_VIEWS[target] ?? null
  return { page: view?.page ?? target, view }
}

/** A page's tabs, in the pattern of Squad's views and Transfers' tabs: a labelled group of pressed/unpressed buttons. */
export function PageViewTabs<T extends string>({ label, idPrefix, views, current, onChange, disabled = false }: { label: string; idPrefix: string; views: readonly (ViewTab<T> | { id: T; label: string; icon?: IconName })[]; current: T; onChange: (view: T) => void; disabled?: boolean }) {
  return <div className="squad-view-controls page-view-controls"><div className="segmented" role="group" aria-label={label}>{views.map(view => <button key={view.id} id={`${idPrefix}-${view.id}`} data-page-view={view.id} aria-pressed={current === view.id} className={current === view.id ? 'selected' : ''} onClick={() => onChange(view.id)} disabled={disabled}>{view.icon && <Icon name={view.icon} size={14} />}{view.label}</button>)}</div></div>
}

/** Page titles use the menu's own words (simplify pass, owner, 22 November 2026). */
export const PAGE_NAMES: Record<Page, string> = { home: 'Desk', inbox: 'Inbox', squad: 'Squad', match: 'Match center', season: 'Competitions', training: 'Training', academy: 'Academy', medical: 'Medical', staff: 'Staff', club: 'Club', board: 'Board', transfers: 'Transfers', calendar: 'Calendar', europe: 'Europe', national: 'National team' }

const ITEMS: Record<Page, NavItem> = {
  home: { id: 'home', label: 'Desk', icon: 'home' },
  inbox: { id: 'inbox', label: 'Inbox', icon: 'mail' },
  squad: { id: 'squad', label: 'Squad', icon: 'people' },
  match: { id: 'match', label: 'Match center', icon: 'court' },
  transfers: { id: 'transfers', label: 'Transfers', icon: 'swap' },
  training: { id: 'training', label: 'Training', icon: 'training' },
  staff: { id: 'staff', label: 'Staff', icon: 'staff' },
  club: { id: 'club', label: 'Club', icon: 'building' },
  // The board panel's own heading uses the shield (owner, 16 November 2026: the board deserves its own menu item).
  board: { id: 'board', label: 'Board', icon: 'shield' },
  season: { id: 'season', label: 'Competitions', icon: 'ball' },
  calendar: { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  europe: { id: 'europe', label: 'Europe', icon: 'star' },
  academy: { id: 'academy', label: 'Academy', icon: 'people' },
  medical: { id: 'medical', label: 'Medical', icon: 'medical' },
  national: { id: 'national', label: 'National team', icon: 'target' },
}

/**
 * The left menu, ordered by use in small groups (owner, 16 November 2026: a short menu for a swifter game; nothing that
 * exists is hidden). An exhibition match has only the desk, squad, match and competitions.
 */
export function mainNavigation({ career, national = false }: { career: boolean; national?: boolean }): NavItem[][] {
  if (!career) return [[ITEMS.home], [ITEMS.squad, ITEMS.match], [ITEMS.season]]
  // Owner decisions (22 November 2026): Medical is a view of Squad; Calendar and Europe are tabs of Competitions,
  // Academy a tab of Training and Board a tab of Club (MERGED_PAGES): 14 menu items became 9.
  return [
    [ITEMS.home, ITEMS.inbox],
    // Owner feedback (22 November 2026): scouting lives inside Transfers; scouts are hired on Staff.
    [ITEMS.squad, ITEMS.match, ITEMS.transfers, ITEMS.training, ITEMS.staff],
    // Format 80: the national team's page only while the manager coaches one.
    [ITEMS.club, ITEMS.season, ...(national ? [ITEMS.national] : [])],
  ]
}

/**
 * Without a club: the desk with job offers, the inbox and the world's competitions (Calendar and Europe are its tabs).
 * Format 80: the national team's page with a national job, and the Match center while his national game is open.
 */
export function unemployedNavigation(national = false, nationalMatch = false): NavItem[][] {
  return [[ITEMS.home, ITEMS.inbox], [...(nationalMatch ? [ITEMS.match] : []), ITEMS.season, ...(national ? [ITEMS.national] : [])]]
}

/** The left menu's buttons; a thin rule separates the groups. */
export function MainNavigation({ groups, current, disabled, onNavigate }: { groups: readonly NavItem[][]; current: Page; disabled: boolean; onNavigate: (page: Page) => void }) {
  return <nav aria-label="Main navigation" className="main-nav">
    {groups.flatMap((group, index) => [
      ...(index ? [<span key={`divider-${index}`} className="nav-divider" aria-hidden="true" />] : []),
      ...group.map(item => <button key={item.id} className={`nav-item ${current === item.id ? 'active' : ''}`} data-nav={item.id} onClick={() => onNavigate(item.id)} disabled={disabled} aria-label={item.label} title={item.label} aria-current={current === item.id ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span>{current === item.id && <span className="nav-current-dot" />}</button>),
    ])}
  </nav>
}
