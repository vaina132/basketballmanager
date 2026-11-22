import { Icon, type IconName } from './Icon'

export type Page = 'home' | 'inbox' | 'squad' | 'match' | 'season' | 'training' | 'staff' | 'club' | 'board' | 'transfers' | 'medical' | 'academy' | 'calendar' | 'europe'
/**
 * Owner feedback (18 November 2026): the budget bar shows only where money is decided: the desk, Transfers,
 * Squad > Contracts, Staff and Club (facilities and the bank).
 */
export function showsBudgetBar(page: Page, squadView?: string): boolean {
  return page === 'home' || page === 'transfers' || page === 'staff' || page === 'club' || page === 'squad' && squadView === 'contracts'
}
export interface NavItem { id: Page; label: string; icon: IconName }

export type SquadView = 'selection' | 'performance' | 'relationships' | 'payroll' | 'contracts' | 'medical'
/** The Squad page's views, in order. Medical joined them in the simplify pass (owner, 22 November 2026). */
export const SQUAD_VIEWS: readonly { id: SquadView; label: string }[] = [
  { id: 'selection', label: 'Selection' },
  { id: 'performance', label: 'Statistics' },
  { id: 'relationships', label: 'Dynamics' },
  { id: 'payroll', label: 'Wages' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'medical', label: 'Medical' },
]
/** Pages that became a view of another page: links to them open that view, so nothing is lost. */
export const MERGED_PAGES: Partial<Record<Page, { page: Page; squadView: SquadView }>> = { medical: { page: 'squad', squadView: 'medical' } }

/** Page titles use the menu's own words (simplify pass, owner, 22 November 2026). */
export const PAGE_NAMES: Record<Page, string> = { home: 'Desk', inbox: 'Inbox', squad: 'Squad', match: 'Match center', season: 'Competitions', training: 'Training', academy: 'Academy', medical: 'Medical', staff: 'Staff', club: 'Club', board: 'Board', transfers: 'Transfers', calendar: 'Calendar', europe: 'Europe' }

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
}

/**
 * The left menu, ordered by use in small groups (owner, 16 November 2026: a short menu for a swifter game; nothing that
 * exists is hidden). An exhibition match has only the desk, squad, match and competitions.
 */
export function mainNavigation({ career, europe }: { career: boolean; europe: boolean }): NavItem[][] {
  if (!career) return [[ITEMS.home], [ITEMS.squad, ITEMS.match], [ITEMS.season]]
  return [
    [ITEMS.home, ITEMS.inbox],
    // Owner feedback (22 November 2026): scouting lives inside Transfers; scouts are hired on Staff.
    [ITEMS.squad, ITEMS.match, ITEMS.transfers, ITEMS.training, ITEMS.staff],
    [ITEMS.club, ITEMS.board],
    [ITEMS.season, ITEMS.calendar, ...(europe ? [ITEMS.europe] : [])],
    // Simplify pass (owner, 22 November 2026): Medical is a view of Squad.
    [ITEMS.academy],
  ]
}

/** Without a club: the desk with job offers, the inbox and the world's competitions. */
export function unemployedNavigation({ europe }: { europe: boolean }): NavItem[][] {
  return [[ITEMS.home, ITEMS.inbox], [ITEMS.season, ITEMS.calendar, ...(europe ? [ITEMS.europe] : [])]]
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
