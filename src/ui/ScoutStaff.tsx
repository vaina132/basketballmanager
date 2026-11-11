import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { Scout } from '../domain/scouts'
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts'
import { availableScouts, getClubScouts, MAX_SCOUTS, quoteScoutHire, scoutRating } from '../world/scout-policy'
import { remainingStaffBudget, staffCommitted } from '../world/staff-policy'
import { getScoutingCapacity } from '../world/scouting-policy'
import { getScoutingDiscovery, scoutDiscoveryContribution, scoutDiscoveryGain } from '../world/scouting-discovery'
import { getDevelopmentPlayer } from '../data/development-players'
import { ScoutPortrait } from './ScoutPortrait'
import { StaffStars } from './StaffRating'
import { Icon } from './Icon'

export interface ScoutStaffProps {
  season: SeasonState
  busy?: boolean
  onEnableScouts: () => void
  onHireScout: (scoutId: string) => void
  onReleaseScout: (contractId: string) => void
  onScoutRenewal: (contractId: string, renew: boolean) => void
  onOpenScouting: () => void
}

const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
const scoutById = (id: string) => DEVELOPMENT_SCOUTS.find(scout => scout.id === id)!
const skillLabels = { evaluation: 'Player assessment', reporting: 'Report clarity' }

function ScoutSkills({ scout }: { scout: Scout }) {
  return <dl className="staff-skill-list compact scout-skill-list">{(['evaluation', 'reporting'] as const).map(skill => <div key={skill}><dt>{skillLabels[skill]}</dt><dd><span className="staff-skill-bar" aria-hidden="true"><span style={{ width: `${scout.skills[skill] * 10}%` }} /></span><span className="staff-skill-value" aria-label={`${scout.skills[skill] / 2} out of 5 stars`}>{(scout.skills[skill] / 2).toFixed(1)}</span></dd></div>)}</dl>
}

export function ScoutStaff({ season, busy = false, onEnableScouts, onHireScout, onReleaseScout, onScoutRenewal, onOpenScouting }: ScoutStaffProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('rating-desc')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [releaseId, setReleaseId] = useState<string | null>(null)
  const selectedRegion = useRef<HTMLElement>(null)
  const releaseRegion = useRef<HTMLDivElement>(null)
  const selectedTrigger = useRef<HTMLButtonElement | null>(null)
  const releaseTrigger = useRef<HTMLButtonElement | null>(null)
  const club = season.clubs.find(item => item.id === season.managedClubId)!
  const enabled = season.scouts.enabledSince !== null
  const enableReason = !season.finance.enabledSince || !season.scouting.enabledSince ? 'Enable club finances and scouting before recruiting scouts.' : season.status === 'complete' ? 'Start next season to recruit scouts.' : null
  const contracts = getClubScouts(season)
  const discovery = getScoutingDiscovery(season)
  const released = season.scouts.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === season.seasonNumber && contract.releasedRound !== null)
  const available = availableScouts(season)
  const candidates = available.filter(scout => scout.name.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) => {
    const value = sort.startsWith('rating') ? scoutRating(left) - scoutRating(right) : left.fee - right.fee
    return (sort.endsWith('desc') ? -value : value) || left.name.localeCompare(right.name, 'en')
  })
  const pages = Math.max(1, Math.ceil(candidates.length / 6)), visiblePage = Math.min(page, pages - 1)
  const selected = available.find(scout => scout.id === selectedId) ?? null
  const quote = selected ? quoteScoutHire(season, selected.id) : null
  const discoveryGain = selected ? scoutDiscoveryGain(season, selected) : null
  const releasing = contracts.find(contract => contract.id === releaseId) ?? null
  const releasedScout = releasing ? scoutById(releasing.scoutId) : null
  const assignments = season.scouting.clubs[club.id]!.assignments
  const releasedAssignment = releasing ? assignments.find(assignment => assignment.observer?.contractId === releasing.id) : null

  useEffect(() => {
    if (!selectedId) return
    if (!selected) { setSelectedId(null); document.getElementById('scout-current-title')?.focus({ preventScroll: true }); return }
    selectedRegion.current?.focus({ preventScroll: true }); selectedRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, selected?.id])
  useEffect(() => {
    if (!releaseId) return
    if (!releasing) { setReleaseId(null); document.getElementById('scout-current-title')?.focus({ preventScroll: true }); return }
    releaseRegion.current?.focus({ preventScroll: true }); releaseRegion.current?.scrollIntoView({ block: 'nearest' })
  }, [releaseId, releasing?.id])
  function closeSelected() { setSelectedId(null); selectedTrigger.current?.focus({ preventScroll: true }) }
  function closeRelease() { setReleaseId(null); releaseTrigger.current?.focus({ preventScroll: true }) }
  function review(scout: Scout, trigger: HTMLButtonElement) {
    selectedTrigger.current = trigger
    if (selectedId === scout.id) { selectedRegion.current?.focus({ preventScroll: true }); selectedRegion.current?.scrollIntoView({ block: 'nearest' }) }
    else setSelectedId(scout.id)
  }

  return <div className="staff-workspace scout-staff-workspace">
    <section className="staff-current panel" aria-labelledby="scout-current-title"><header className="staff-heading"><div><h2 id="scout-current-title" tabIndex={-1}>Scouting staff</h2><span>{season.scouting.enabledSince ? <>{getScoutingCapacity(season)} observations &middot; Scouting range {discovery.networkOutsideCount}/{discovery.totalOutsideCount} outside players</> : 'Scouting not enabled'}</span></div><div className="scout-header-actions"><span className="staff-slot-count"><span aria-hidden="true">{Array.from({ length: MAX_SCOUTS }, (_, index) => <i className={index < contracts.length ? 'filled' : ''} key={index} />)}</span>{contracts.length} / {MAX_SCOUTS}</span><button className="button small" onClick={onOpenScouting} disabled={busy}>Assign observations<Icon name="search" size={14} /></button></div></header>
      {!enabled ? <div className="scout-enable"><Icon name="search" size={28} /><div><strong>Recruit scouts for your club</strong><p>Scouts reveal more players, add an observation slot and strengthen reports.</p></div><button id="enable-scouts" className="button primary" onClick={onEnableScouts} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'scout-enable-reason' : undefined}>Enable scout recruitment</button>{enableReason && <p id="scout-enable-reason">{enableReason}</p>}</div> : <div className="staff-roster">{contracts.map(contract => {
        const scout = scoutById(contract.scoutId), assignment = assignments.find(item => item.observer?.contractId === contract.id)
        return <article className="staff-owned-card scout-owned-card" key={contract.id} data-scout-contract={contract.id}><div className="staff-owned-identity"><ScoutPortrait scout={scout} color={club.color} size={70} /><div><span className="staff-role">Scout</span><h3>{scout.name}</h3><StaffStars rating={scoutRating(scout)} /><span className="staff-card-fee">{money(scout.fee)} <small>/ season</small></span></div></div><ScoutSkills scout={scout} /><div className="scout-current-job"><Icon name="search" size={15} /><span>Range contribution: up to {scoutDiscoveryContribution(scout)} players</span></div><div className="scout-current-job"><Icon name={assignment ? 'search' : 'check'} size={15} /><span>{assignment ? <>Watching <strong>{getDevelopmentPlayer(assignment.playerId).name}</strong></> : season.status === 'complete' ? 'Available next season' : 'Available for an observation'}</span></div><div className="staff-contract-controls"><label className="staff-renew"><input type="checkbox" data-scout-renewal={contract.id} checked={contract.renew} onChange={event => onScoutRenewal(contract.id, event.target.checked)} disabled={busy} aria-label={`Renew ${scout.name} next season`} />Renew next season</label><button className="text-button" data-release-scout={contract.id} aria-label={`Release ${scout.name}`} onClick={event => { releaseTrigger.current = event.currentTarget; setReleaseId(contract.id) }} disabled={busy}>Release</button></div></article>
      })}{Array.from({ length: Math.max(0, MAX_SCOUTS - contracts.length) }, (_, index) => <button className="staff-vacancy scout-vacancy" key={index} onClick={() => { document.getElementById('scout-search')?.focus(); document.getElementById('scout-recruitment-title')?.scrollIntoView({ block: 'nearest' }) }} disabled={busy}><span className="staff-vacancy-image" aria-hidden="true"><Icon name="search" size={34} /><span>+</span></span><span><strong>Vacant scout position</strong><small>More players &middot; one extra observation</small><span className="staff-vacancy-action">Find a scout<Icon name="chevron" size={13} /></span></span></button>)}</div>}
      {releasing && releasedScout && <div ref={releaseRegion} id="scout-release-confirmation" className="staff-release-confirmation" tabIndex={-1} role="group" aria-label={`Release ${releasedScout.name}`} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); closeRelease() } }}><ScoutPortrait scout={releasedScout} size={42} /><div className="staff-release-copy"><strong>Release {releasedScout.name}?</strong><p>{money(releasedScout.fee)} remains committed. No refund.{releasedAssignment && <> The pending observation of <strong>{getDevelopmentPlayer(releasedAssignment.playerId).name}</strong> will be cancelled.</>} Reports and followed players are kept; discovery range may shrink.</p></div><div className="staff-release-actions"><button id="confirm-release-scout" className="button" onClick={() => onReleaseScout(releasing.id)} disabled={busy}>Confirm release</button><button className="text-button" onClick={closeRelease} disabled={busy}>Cancel</button></div></div>}
      <details className="staff-explainer"><summary>Scout roles &amp; appointment terms</summary><p>Better scouts expand the player identities available in Discover and improve report quality. Each scout also observes one player per matchday. Range expansion uses assessment and reporting skills, up to the remaining player pool. Previously followed players stay visible after staff changes; discovering a name does not reveal his ability. Two club observations remain available without hired scouts. All staff roles share the staff budget. The full season fee is charged when hired; released fees are retained. Renewals are checked against the next season's budget and available cash.</p></details>
    </section>
    {enabled && <>
      {selected && quote && <section ref={selectedRegion} id="scout-candidate-detail" className="staff-candidate-detail panel" tabIndex={-1} aria-labelledby="scout-candidate-title" data-selected-scout={selected.id} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); closeSelected() } }}><header className="staff-heading"><div><h2 id="scout-candidate-title">Recruit {selected.name}</h2><span>Scout &middot; one extra observation per matchday</span></div><button className="text-button" aria-label="Close scout details" onClick={closeSelected} disabled={busy}><Icon name="close" size={14} />Close</button></header><div className="staff-candidate-body"><div className="staff-candidate-profile"><div className="staff-profile-portrait"><ScoutPortrait scout={selected} color={club.color} size={100} /><StaffStars rating={scoutRating(selected)} /></div><ScoutSkills scout={selected} /></div><div className="staff-hire-controls"><div className="staff-offer-fee"><span>Season fee</span><strong>{money(quote.fee)}</strong></div><div className="staff-after-hire"><span>{quote.remainingBudget >= quote.fee ? 'Remaining staff budget after hire' : 'Staff budget shortfall'}</span><strong data-scout-budget-after={quote.remainingBudget - quote.fee}>{money(Math.abs(quote.remainingBudget - quote.fee))}</strong></div><div className="staff-after-hire"><span>New players in Discover</span><strong data-scout-discovery-gain={discoveryGain?.newPlayers}>+{discoveryGain?.newPlayers}</strong></div><span className="staff-renewal-note">Scouting range {discovery.networkOutsideCount + (discoveryGain?.rangeIncrease ?? 0)}/{discovery.totalOutsideCount} outside players after hire</span><span className="staff-renewal-note"><Icon name="check" size={14} />Renewal selected for next season</span>{quote.reason && <p id="scout-hire-reason" className="staff-hire-reason">{quote.reason}</p>}<button id="hire-scout" className="button primary" onClick={() => onHireScout(selected.id)} disabled={busy || !quote.canHire} aria-describedby={quote.reason ? 'scout-hire-reason' : undefined}><Icon name="staff" size={16} />Hire for {money(quote.fee)}</button><details className="staff-payment-details"><summary>Payment details</summary><dl><div><dt>Staff fees committed</dt><dd>{money(staffCommitted(season, club.id))}</dd></div><div><dt>Staff allocation remaining</dt><dd>{money(quote.remainingAllocation)}</dd></div><div><dt>Remaining staff budget</dt><dd data-scout-staff-budget={quote.remainingBudget}>{money(remainingStaffBudget(season, club.id))}</dd></div></dl><p>The full fee is paid now. Training coaches, scouts, fitness coaches, physios and the assistant coach share this season's staff allocation.</p></details></div></div></section>}
      <section className="staff-recruitment panel" aria-labelledby="scout-recruitment-title"><header className="staff-heading"><h2 id="scout-recruitment-title">Available scouts</h2><span>{candidates.length} scouts</span></header><div className="staff-recruitment-filters"><label htmlFor="scout-search"><Icon name="search" size={16} /><span className="sr-only">Find scout</span><input id="scout-search" type="search" placeholder="Find a scout" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} disabled={busy} /></label><label htmlFor="scout-sort"><span>Sort</span><select id="scout-sort" value={sort} onChange={event => { setSort(event.target.value); setPage(0) }} disabled={busy}><option value="rating-desc">Best overall</option><option value="fee-asc">Lowest fee</option><option value="fee-desc">Highest fee</option></select></label></div><div className="staff-candidate-grid">{candidates.slice(visiblePage * 6, visiblePage * 6 + 6).map(scout => {
        const candidateQuote = quoteScoutHire(season, scout.id)
        const gain = scoutDiscoveryGain(season, scout)
        return <article className={`staff-candidate-card${selectedId === scout.id ? ' staff-selected-candidate' : ''}`} key={scout.id}><button className="staff-candidate-identity" data-candidate-scout={scout.id} aria-label={`Review ${scout.name}`} aria-expanded={selectedId === scout.id} aria-controls="scout-candidate-detail" onClick={event => review(scout, event.currentTarget)} disabled={busy}><ScoutPortrait scout={scout} size={64} /><span><strong>{scout.name}</strong><StaffStars rating={scoutRating(scout)} /><small data-scout-range-gain={gain.newPlayers}>+{gain.newPlayers} players in Discover &middot; +1 observation</small></span><Icon name="chevron" size={15} /></button><ScoutSkills scout={scout} /><div className="staff-candidate-footer"><span className="staff-card-fee">{money(scout.fee)} <small>/ season</small></span><button className={`button small${candidateQuote.canHire ? ' primary' : ''}`} onClick={event => review(scout, event.currentTarget)} disabled={busy} aria-label={`${candidateQuote.canHire ? 'Recruit' : 'Review'} ${scout.name}`}>{candidateQuote.canHire ? 'Recruit' : 'View scout'}<Icon name="chevron" size={13} /></button></div>{!candidateQuote.canHire && <span className="staff-card-status">{contracts.length >= MAX_SCOUTS ? 'No vacant position' : season.status === 'complete' ? 'Recruit next season' : 'Outside current budget'}</span>}</article>
      })}{!candidates.length && <p className="staff-empty">No available scouts match this search.</p>}</div>{candidates.length > 0 && <nav className="staff-candidate-pages" aria-label="Available scouts pages"><span aria-live="polite">{visiblePage * 6 + 1}&ndash;{Math.min(visiblePage * 6 + 6, candidates.length)} of {candidates.length}</span><div><button className="button small" disabled={busy || visiblePage === 0} onClick={() => setPage(visiblePage - 1)} aria-label="Previous scouts"><Icon name="chevron" size={13} />Previous</button><span>{visiblePage + 1} / {pages}</span><button className="button small" disabled={busy || visiblePage >= pages - 1} onClick={() => setPage(visiblePage + 1)} aria-label="Next scouts">Next<Icon name="chevron" size={13} /></button></div></nav>}</section>
      {released.length > 0 && <details className="staff-released panel"><summary>Released scouts this season <span>{released.length}</span></summary><div className="staff-released-list">{released.map(contract => <div key={contract.id}><ScoutPortrait scout={scoutById(contract.scoutId)} size={36} /><strong>{scoutById(contract.scoutId).name}</strong><span>Matchday {contract.releasedRound}</span><span>{money(scoutById(contract.scoutId).fee)} retained</span></div>)}</div></details>}
    </>}
  </div>
}
