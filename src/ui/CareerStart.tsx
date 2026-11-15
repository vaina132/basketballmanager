import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ManagerProfile } from '../domain/manager'
import type { InjuryMode } from '../domain/types'
import type { CareerWorld } from '../domain/world'
import { DEVELOPMENT_START_DATE } from '../data/development-league'
import { worldRounds } from '../world/career-world'
import { MAX_DATA_PACK_BYTES, parseDataPack, type DataPack } from '../world/data-pack'
import { overallRating } from '../world/overall-rating'
import { careerCompetitions, worldFromPack } from '../world/real-world'
import { managerAge, MAX_MANAGER_NAME_LENGTH, MAX_MANAGER_NATIONALITY_LENGTH, validateManagerProfile } from '../world/manager'
import { Avatar } from './Avatar'
import { PositionLabel } from './PositionLabel'
import { DataPackDetails } from './DataPackDetails'
import { CountryFlag } from './CountryFlag'
import { GameSpeed } from './GameSpeed'
import { SquadStrength } from './SquadStrength'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { NATIONALITY_SUGGESTIONS } from './nationality-suggestions'
import './career-start.css'

export interface CareerSetup {
  manager: ManagerProfile
  /** The real league built from the loaded data pack; careers use real clubs only. */
  world: CareerWorld
  clubId: string
  injuryMode: InjuryMode
  seed: number
}

interface CareerSummary {
  managerName: string
  clubName: string
  date: string
}

interface CareerStartProps {
  view: 'menu' | 'new-career' | 'profile'
  busy: boolean
  /** The career is being created in the background (owner request: show progress while it starts). */
  starting?: boolean
  error: string | null
  hasSession: boolean
  currentCareer: CareerSummary | null
  savedCareer: CareerSummary | null
  savesLoading: boolean
  initialManager?: ManagerProfile | null
  onContinue: () => void
  onResume: () => void
  onNewCareer: () => void
  onLoad: () => void
  onImport: () => void
  onExhibition: () => void
  onCancel: () => void
  onExport?: () => void
  onStart: (setup: CareerSetup) => void
  onSaveProfile: (profile: ManagerProfile) => void
  /** The private real-data pack loaded on this computer (shared with real-club friendlies). */
  pack: DataPack | null
  onPackLoaded: (pack: DataPack) => void
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
const emptyManager: ManagerProfile = { name: '', dateOfBirth: '', nationality: '' }
const steps = ['Manager', 'Club', 'Review'] as const

function ageAtStart(manager: ManagerProfile): number | null {
  if (!manager.dateOfBirth) return null
  try { return managerAge(manager, DEVELOPMENT_START_DATE) } catch { return null }
}

function EntryError({ message, revision = 0 }: { message: string | null; revision?: number }) {
  const element = useRef<HTMLDivElement>(null)
  useEffect(() => { if (message) element.current?.focus({ preventScroll: false }) }, [message, revision])
  return message ? <div ref={element} id="career-start-error" className="career-start-error" role="alert" tabIndex={-1}>{message}</div> : null
}

function SavedDetails({ career }: { career: CareerSummary }) {
  return <dl className="career-start-details"><dt>Manager</dt><dd>{career.managerName || 'Manager profile not set'}</dd><dt>Club</dt><dd>{career.clubName}</dd><dt>Game date</dt><dd><time dateTime={career.date}>{formatDate(career.date)}</time></dd></dl>
}

export function CareerStart(props: CareerStartProps) {
  return <div className="career-start">
    <header className="career-start-header"><div className="career-start-brand"><Icon name="ball" size={30} /><div>COURTSIDE<small>Basketball Manager</small></div></div><span className="career-start-edition">Real clubs<br />Private data pack</span></header>
    <main className="career-start-body">
      {props.view === 'menu' ? <CareerMenu {...props} /> : <CareerForm key={props.view} {...props} profileOnly={props.view === 'profile'} />}
    </main>
  </div>
}

function CareerMenu(props: CareerStartProps) {
  const title = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!props.error) title.current?.focus({ preventScroll: true }) }, [])
  const actions: { id: string; label: string; icon: IconName; run: () => void; disabled?: boolean; primary?: boolean }[] = [
    { id: 'career-continue', label: props.savesLoading ? 'Checking saved career…' : 'Continue saved career', icon: 'play', run: props.onContinue, disabled: props.savesLoading || !props.savedCareer, primary: !!props.savedCareer },
    ...(props.hasSession ? [{ id: 'career-resume', label: props.currentCareer ? 'Resume current career' : 'Resume exhibition', icon: 'arrow' as const, run: props.onResume }] : []),
    { id: 'career-new', label: 'New career', icon: 'people', run: props.onNewCareer, primary: !props.savedCareer },
    { id: 'career-load', label: 'Load saves', icon: 'save', run: props.onLoad },
    { id: 'career-import', label: 'Import save file', icon: 'upload', run: props.onImport },
    { id: 'career-exhibition', label: 'Exhibition match', icon: 'court', run: props.onExhibition },
  ]
  return <>
    <div ref={title} className="career-start-title" tabIndex={-1}><div><h1>Main menu</h1><p>Choose a career or open a single match.</p></div></div>
    <EntryError message={props.error} />
    <div className="career-menu-layout">
      <nav className="career-menu-actions" aria-label="Game menu">{actions.map(action => <button key={action.id} id={action.id} className={`career-menu-action${action.primary ? ' primary' : ''}`} onClick={action.run} disabled={props.busy || action.disabled}><Icon name={action.icon} size={18} /><span>{action.label}</span><Icon name="chevron" size={15} /></button>)}</nav>
      <div className="career-menu-context">
        <section className="panel" aria-labelledby="career-saved-title"><header className="career-start-panel-heading"><h2 id="career-saved-title">Latest local save</h2><Icon name="save" size={16} /></header>{props.savesLoading ? <p className="career-start-empty" role="status">Reading local saves…</p> : props.savedCareer ? <SavedDetails career={props.savedCareer} /> : <p className="career-start-empty">No saved career is available. Start a new career or import a season save file.</p>}</section>
        {props.hasSession && <section className="panel" aria-labelledby="career-current-title"><header className="career-start-panel-heading"><h2 id="career-current-title">Current session</h2><span>{props.currentCareer ? 'Career' : 'Exhibition'}</span></header>{props.currentCareer ? <SavedDetails career={props.currentCareer} /> : <p className="career-start-empty">Your exhibition remains open. Resume to return to the match.</p>}{props.currentCareer && props.onExport && <div className="career-menu-panel-footer"><button id="career-export" className="text-button" onClick={props.onExport} disabled={props.busy}><Icon name="download" size={15} />Export current career</button></div>}</section>}
        <p className="career-start-footnote">One local career slot keeps the five latest checkpoints. Export a save file to keep a separate career.</p>
      </div>
    </div>
  </>
}

function CareerForm(props: CareerStartProps & { profileOnly: boolean }) {
  const [manager, setManager] = useState<ManagerProfile>(() => ({ ...(props.initialManager ?? emptyManager) }))
  const [step, setStep] = useState(0)
  const leagues = useMemo(() => props.pack ? careerCompetitions(props.pack) : [], [props.pack])
  const [competitionId, setCompetitionId] = useState('')
  const [extraCountries, setExtraCountries] = useState<string[]>([])
  const league = leagues.find(item => item.id === competitionId) ?? leagues[0] ?? null
  const countries = [...new Set(leagues.map(item => item.country ?? 'Other'))].sort()
  const countryLeagues = leagues.filter(item => (item.country ?? 'Other') === (league?.country ?? 'Other')).sort((a, b) => a.tier - b.tier)
  const built = useMemo(() => { try { return { world: props.pack && league ? worldFromPack(props.pack, leagues.filter(item => item.country === league.country || extraCountries.includes(item.country ?? 'Other')).map(item => item.id)) : null, error: null } } catch (error) { return { world: null, error: error instanceof Error ? error.message : 'The selected leagues could not be loaded.' } } }, [props.pack, league, leagues, extraCountries])
  const world = built.world
  const [clubId, setClubId] = useState('')
  const [packError, setPackError] = useState<string | null>(null)
  const [packLoading, setPackLoading] = useState(false)
  const packInput = useRef<HTMLInputElement>(null)
  const [issue, setIssue] = useState<{ message: string; revision: number } | null>(null)
  const title = useRef<HTMLDivElement>(null)
  const club = world ? world.clubs.find(team => team.id === clubId && league?.clubIds.includes(team.id)) ?? world.clubs.find(team => league?.clubIds.includes(team.id))! : null
  const squadRating = (team: CareerWorld['clubs'][number]) => { const best = team.players.map(player => overallRating(player.attributes, player.position)).sort((a, b) => b - a).slice(0, 8); return Math.round(best.reduce((sum, value) => sum + value, 0) / best.length) }

  async function loadPack(selected: File | undefined) {
    if (!selected) return
    setPackError(null)
    if (selected.size > MAX_DATA_PACK_BYTES) { setPackError('This file is too large to be a data pack.'); return }
    setPackLoading(true)
    try {
      const loaded = await parseDataPack(await selected.text())
      if (!careerCompetitions(loaded).length) throw new Error('This data pack has no supported domestic league to play a career in.')
      setCompetitionId(''); setClubId(''); setExtraCountries([]); setIssue(null); props.onPackLoaded(loaded)
    } catch (error) { setPackError(error instanceof Error ? error.message : 'This file could not be read as a data pack.') }
    finally { setPackLoading(false); if (packInput.current) packInput.current.value = '' }
  }
  const age = ageAtStart(manager)
  const error = props.error ?? issue?.message ?? null

  useEffect(() => { if (!error) title.current?.focus({ preventScroll: false }) }, [step])

  function reportError(error: unknown) {
    setIssue(previous => ({ message: error instanceof Error ? error.message : 'Check the career details and try again.', revision: (previous?.revision ?? 0) + 1 }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (props.busy) return
    try {
      const validManager = validateManagerProfile(manager, DEVELOPMENT_START_DATE)
      setManager(validManager)
      if (props.profileOnly) { setIssue(null); props.onSaveProfile(validManager); return }
      if (step === 0) { setIssue(null); setStep(1); return }
      if (step === 1 && (!world || !club)) throw new Error('Load your real-data pack and choose a league and a club.')
      if (step === 1) { setIssue(null); setStep(2); return }
      // Owner (15 November 2026): every career uses the realistic injury model and a fresh random career; no setup options.
      setIssue(null)
      props.onStart({ manager: validManager, world: world!, clubId: club!.id, injuryMode: 'standard', seed: crypto.getRandomValues(new Uint32Array(1))[0]! })
    } catch (error) { reportError(error) }
  }

  function changeManager(field: keyof ManagerProfile, value: string) {
    setManager(previous => ({ ...previous, [field]: value }))
    setIssue(null)
  }

  return <>
    <div ref={title} className="career-start-title" tabIndex={-1}><div><h1>{props.profileOnly ? 'Manager profile' : 'New career'}</h1><p>{props.profileOnly ? 'Set the identity used throughout your career.' : `${world?.name ?? 'Real clubs'} · ${formatDate(DEVELOPMENT_START_DATE)}`}</p></div></div>
    {!props.profileOnly && <ol className="career-steps" aria-label="New career setup">{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={index < step ? 'career-step-complete' : undefined}><span className="career-step-number" aria-hidden="true">{index < step ? <Icon name="check" size={14} /> : index + 1}</span><span>{label}</span></li>)}</ol>}
    <EntryError message={error} revision={issue?.revision} />
    <form className="career-setup-form" onSubmit={submit} noValidate>
      <fieldset disabled={props.busy}>
        {(props.profileOnly || step === 0) && <div className="career-identity-layout">
          <section className="panel" aria-labelledby="career-manager-title"><header className="career-start-panel-heading"><h2 id="career-manager-title">Your manager</h2><Icon name="people" size={17} /></header><div className="career-identity-fields">
            <div className="career-start-field career-start-field-wide"><label htmlFor="manager-name">Manager name</label><input id="manager-name" name="manager-name" autoComplete="name" value={manager.name} onChange={event => changeManager('name', event.target.value)} maxLength={MAX_MANAGER_NAME_LENGTH} aria-describedby="manager-name-help" required /><small id="manager-name-help">The name shown in your career.</small></div>
            <div className="career-start-field"><label htmlFor="manager-birth-date">Date of birth</label><input id="manager-birth-date" name="manager-birth-date" type="date" autoComplete="bday" value={manager.dateOfBirth} onChange={event => changeManager('dateOfBirth', event.target.value)} aria-describedby="manager-age" required /><small id="manager-age" className="career-identity-age" aria-live="polite">{age === null ? 'Age 18–100 at career start.' : `${age} years old on ${formatDate(DEVELOPMENT_START_DATE)}.`}</small></div>
            <div className="career-start-field"><label htmlFor="manager-nationality">Nationality</label><input id="manager-nationality" name="manager-nationality" list="manager-nationality-options" autoComplete="off" placeholder="Type to find a nationality" value={manager.nationality} onChange={event => changeManager('nationality', event.target.value)} maxLength={MAX_MANAGER_NATIONALITY_LENGTH} aria-describedby="manager-nationality-help" required /><datalist id="manager-nationality-options">{NATIONALITY_SUGGESTIONS.map(item => <option key={item.nationality} value={item.nationality} label={item.place} />)}</datalist><small id="manager-nationality-help">Choose a suggestion or enter your own nationality. Multiple nationalities are welcome.</small></div>
          </div></section>
          <section className="panel" aria-labelledby="career-world-title"><header className="career-start-panel-heading"><h2 id="career-world-title">{props.profileOnly ? 'Profile details' : 'Career start'}</h2></header>{props.profileOnly ? <p className="career-start-empty">Your name and nationality identify your manager. Age is calculated from your date of birth. Editing this profile preserves your club and career progress.</p> : <><dl className="career-start-details"><dt>Competition</dt><dd>{world?.name ?? 'Real clubs, chosen in the next step'}</dd><dt>Opening day</dt><dd><time dateTime={DEVELOPMENT_START_DATE}>{formatDate(DEVELOPMENT_START_DATE)}</time></dd>{world && <><dt>Format</dt><dd>{world.clubs.length} clubs · {worldRounds(world)} matchdays</dd></>}<dt>Season</dt><dd>2026/27</dd></dl><p className="career-start-subnote">Real clubs, players and ratings from your private data pack. Wages, contract lengths, budgets, arenas, presidents and sponsors are fictional estimates.</p></>}</section>
        </div>}

        {!props.profileOnly && step === 1 && (!props.pack || !world || !club ? <div className="career-pack-layout">
          <section className="panel" aria-labelledby="career-pack-title"><header className="career-start-panel-heading"><h2 id="career-pack-title">Real club data</h2><Icon name="upload" size={17} /></header>
            <div className="career-pack-body">
              <p>Choose your club data file to load real clubs and players. The file stays on this computer.</p>
              <input ref={packInput} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => void loadPack(event.target.files?.[0])} />
              <button id="career-load-pack" type="button" className="button primary" disabled={packLoading} onClick={() => packInput.current?.click()}><Icon name="upload" size={16} />{packLoading ? 'Checking data pack…' : props.pack ? 'Load another data pack' : 'Load data pack'}</button>
              {packError && <p id="career-pack-error" className="career-pack-error" role="alert">{packError}</p>}
              {props.pack && !world && !packError && <p className="career-pack-error" role="alert">{built.error ?? 'This data pack has no league a career can be played in.'}</p>}
            </div>
          </section>
        </div> : <div className="career-club-layout">
          <section className="panel" aria-labelledby="career-club-title"><header className="career-start-panel-heading"><h2 id="career-club-title">Choose your club</h2><span data-career-pack={props.pack.version}>Pack {props.pack.version}</span></header>
            <div className="career-country-options" role="group" aria-label="Choose country">{countries.map(country => <button key={country} type="button" aria-pressed={(league?.country ?? 'Other') === country} onClick={() => { setCompetitionId(leagues.find(item => (item.country ?? 'Other') === country)!.id); setClubId('') }}><CountryFlag country={country} decorative /><span>{country}</span></button>)}</div>
            {countryLeagues.length > 1 && <div className="career-start-field career-league-field"><label htmlFor="career-league">League</label><select id="career-league" value={league!.id} onChange={event => { setCompetitionId(event.target.value); setClubId('') }}>{countryLeagues.map(item => <option key={item.id} value={item.id}>{item.name} · Division {item.tier}</option>)}</select></div>}
            <fieldset className="career-country-options"><legend>Playable countries</legend>{countries.map(country => <label key={country}><input type="checkbox" checked={country === (league?.country ?? 'Other') || extraCountries.includes(country)} disabled={country === (league?.country ?? 'Other')} onChange={event => setExtraCountries(previous => event.target.checked ? [...previous, country] : previous.filter(item => item !== country))} /><CountryFlag country={country} decorative /><span>{country}</span></label>)}</fieldset>
            <p className="career-league-summary">{world.domesticLeagues?.length ?? 1} leagues · {world.clubs.length} clubs · {worldRounds(world)} weeks. Each selected country includes its available divisions.</p>
            <GameSpeed clubs={world.clubs.length} weeks={worldRounds(world)} />
            <div className="career-club-options" role="radiogroup" aria-labelledby="career-club-title">{world.clubs.filter(team => league?.clubIds.includes(team.id)).map(team => <label className={`career-club-option${club.id === team.id ? ' selected' : ''}`} key={team.id}><input type="radio" name="career-club" data-career-club={team.id} value={team.id} checked={club.id === team.id} onChange={() => setClubId(team.id)} /><span className="career-club-code" style={{ color: team.color }}>{team.shortName}</span><span><strong>{team.name}</strong><small>{team.players.length} players</small><SquadStrength value={squadRating(team)} clubName={team.name} /></span></label>)}</div>
            <button type="button" className="text-button career-pack-change" onClick={() => packInput.current?.click()} disabled={packLoading}>Load another data pack</button>
            <DataPackDetails pack={props.pack} />
            <input ref={packInput} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => void loadPack(event.target.files?.[0])} />
            {packError && <p className="career-pack-error" role="alert">{packError}</p>}
          </section>
          <section className="panel" aria-labelledby="career-roster-title"><header className="career-start-panel-heading"><h2 id="career-roster-title">{club.name}</h2><span>First team</span></header><div className="career-start-roster-scroll" tabIndex={0} role="region" aria-label={`${club.name} roster preview`}><table className="career-start-roster"><thead><tr><th scope="col">Player</th><th scope="col">Position</th><th scope="col">Overall</th><th scope="col">Height</th></tr></thead><tbody>{club.players.map(player => <tr key={player.id}><td><span className="career-start-player"><span aria-hidden="true"><Avatar player={player} color={club.color} size={30} /></span><span>{player.name}<small>#{player.number}</small></span></span></td><td><PositionLabel position={player.position} profile={world.playerProfiles[player.id]} /></td><td>{overallRating(player.attributes, player.position)}</td><td>{player.heightCm} cm</td></tr>)}</tbody></table></div></section>
        </div>)}

        {!props.profileOnly && step === 2 && <>
          <div className="career-review-layout">
            <section className="panel" aria-labelledby="career-review-title"><header className="career-start-panel-heading"><h2 id="career-review-title">Career details</h2><Icon name="people" size={17} /></header><dl className="career-start-details"><dt>Manager</dt><dd>{manager.name}</dd><dt>Date of birth</dt><dd>{formatDate(manager.dateOfBirth)} · age {age}</dd><dt>Nationality</dt><dd>{manager.nationality}</dd><dt>Club</dt><dd>{club?.name}</dd><dt>Competition</dt><dd>{world?.name}</dd><dt>Opening day</dt><dd><time dateTime={DEVELOPMENT_START_DATE}>{formatDate(DEVELOPMENT_START_DATE)}</time></dd></dl><p className="career-start-subnote">Real clubs and players from your private data pack; wages, contract lengths, budgets, arenas, presidents and sponsors are fictional estimates. The career keeps its own copy of the league, so it never needs the file again.</p></section>
            <section className="panel" aria-labelledby="career-options-title"><header className="career-start-panel-heading"><h2 id="career-options-title">Leagues in your career</h2><Icon name="settings" size={17} /></header><div className="career-review-options"><ul className="career-review-leagues">{world?.domesticLeagues?.map(item => <li key={item.id}><CountryFlag country={item.country} decorative /><span>{item.name}</span><small>{item.clubIds.length} clubs</small></li>)}</ul>{world && <GameSpeed clubs={world.clubs.length} weeks={worldRounds(world)} />}</div></section>
          </div>
          {props.starting && <div className="career-starting" role="status" aria-live="polite"><span className="career-starting-spinner" aria-hidden="true" /><div><strong>Preparing your career…</strong><span>Building squads, schedules, finances and staff for {world?.clubs.length ?? 'all'} clubs. With several countries this can take up to a minute.</span></div></div>}
          <p className="career-start-storage-note">Starting a career makes it the current local save. Load saves opens the five latest checkpoints. Export a save file from the main menu to keep a separate career.</p>
        </>}

        <footer className="career-setup-footer"><div>{!props.profileOnly && step > 0 && <button id="career-back" type="button" className="button" onClick={() => { setIssue(null); setStep(previous => previous - 1) }}>Back</button>}<button id="career-cancel" type="button" className="text-button" onClick={props.onCancel}>{props.profileOnly ? 'Cancel' : 'Main menu'}</button></div><button id={props.profileOnly ? 'career-save-profile' : step === 2 ? 'career-start' : 'career-next'} type="submit" className="button primary">{props.starting ? 'Preparing career…' : props.busy ? 'Please wait…' : props.profileOnly ? 'Save profile' : step === 2 ? 'Start career' : `Continue to ${steps[step + 1]!.toLowerCase()}`}<Icon name={props.profileOnly ? 'save' : 'arrow'} size={16} /></button></footer>
      </fieldset>
    </form>
  </>
}
