import { useEffect, useRef, useState } from 'react'
import type { Team } from '../domain/types'
import { matchdayTeam, MAX_DATA_PACK_BYTES, parseDataPack, type DataPack } from '../world/data-pack'
import { Icon } from './Icon'
import './real-club-friendly.css'

interface RealClubFriendlyProps {
  pack: DataPack | null
  busy?: boolean
  onPackLoaded: (pack: DataPack) => void
  onStart: (home: Team, away: Team, pack: DataPack) => void
  onClose: () => void
}

/** A friendly between two real clubs from a private data pack on this computer; nothing is uploaded. */
export function RealClubFriendly({ pack, busy = false, onPackLoaded, onStart, onClose }: RealClubFriendlyProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const firstControl = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [home, setHome] = useState('')
  const [away, setAway] = useState('')

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!element.open) element.showModal()
    firstControl.current?.focus({ preventScroll: true })
    return () => { element.close(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    if (!pack) return
    const clubs = pack.clubs.filter(club => club.playerIds.length >= 5 && pack.competitions.some(competition => competition.clubIds.includes(club.id))).sort((a, b) => a.name.localeCompare(b.name))
    setHome(current => clubs.some(club => club.id === current) ? current : clubs[0]?.id || ''); setAway(current => clubs.some(club => club.id === current) ? current : clubs[1]?.id || '')
  }, [pack])

  async function load(file: File | undefined) {
    if (!file) return
    setError(null); setLoading(true)
    try {
      if (file.size > MAX_DATA_PACK_BYTES) throw new Error('This data pack cannot be used: the file is larger than 20 MB.')
      onPackLoaded(await parseDataPack(await file.text()))
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'This data pack cannot be used.') }
    finally { setLoading(false); if (fileInput.current) fileInput.current.value = '' }
  }

  const options = pack ? pack.competitions.map(competition => ({ competition, clubs: competition.clubIds.map(id => pack.clubs.find(club => club.id === id)!).sort((a, b) => a.name.localeCompare(b.name)) })) : []
  const clubName = (id: string) => pack?.clubs.find(club => club.id === id)?.name ?? ''
  const select = (id: string, label: string, value: string, change: (value: string) => void) => <label className="real-friendly-club" htmlFor={id}>{label}<select id={id} value={value} onChange={event => change(event.target.value)} disabled={busy || loading}>
    {options.map(({ competition, clubs }) => <optgroup key={competition.id} label={`${competition.name} ${competition.season}`}>{clubs.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}</optgroup>)}
  </select></label>

  return <dialog ref={dialog} id="real-club-friendly" className="real-friendly" aria-labelledby="real-friendly-title" aria-describedby="real-friendly-help" onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="real-friendly-heading"><h2 id="real-friendly-title"><Icon name="court" size={17} />Real-club friendly</h2><button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button></header>
    <div className="real-friendly-body">
      <p id="real-friendly-help">Play a friendly between two real clubs from a private data pack on this computer. The pack stays in this browser and is never uploaded.</p>
      <div className="real-friendly-load">
        <input ref={fileInput} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Choose a data pack file" onChange={event => { void load(event.target.files?.[0]) }} />
        <button ref={firstControl} id="load-data-pack" className="button" onClick={() => fileInput.current?.click()} disabled={busy || loading}><Icon name="upload" size={15} />{pack ? 'Load another pack' : 'Load data pack…'}</button>
        {loading && <span role="status">Checking the pack…</span>}
        {pack && !loading && <span data-pack-version={pack.version}>Pack {pack.version} · {pack.season} · {pack.clubs.length} clubs · {pack.players.length} players</span>}
      </div>
      {error && <p className="real-friendly-error" role="alert">{error}</p>}
      {pack && <>
        <div className="real-friendly-clubs">{select('friendly-home', 'Home', home, setHome)}{select('friendly-away', 'Away', away, setAway)}</div>
        {home && home === away && <p className="real-friendly-error" role="alert">Choose two different clubs.</p>}
        <p className="real-friendly-note">Each club fields up to twelve players. Unverified abilities and physical details remain estimates. Players use neutral figures; clubs without verified colours appear in grey.</p>
      </>}
    </div>
    <footer className="real-friendly-actions">
      <button className="text-button" onClick={onClose} disabled={busy}>Cancel</button>
      <button id="start-real-friendly" className="button primary" disabled={!pack || !home || !away || home === away || busy || loading || !options.some(group => group.clubs.some(club => club.id === home)) || !options.some(group => group.clubs.some(club => club.id === away))} onClick={() => pack && onStart(matchdayTeam(pack, home), matchdayTeam(pack, away), pack)}>{pack && home && away && home !== away ? `Start ${clubName(home)} vs ${clubName(away)}` : 'Start friendly'}</button>
    </footer>
  </dialog>
}
