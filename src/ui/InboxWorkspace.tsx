import { useRef, useState } from 'react'
import type { ContractRequestReply, PressAnswer, PressQuestion, PressTopic } from '../domain/relationships'
import type { SeasonState } from '../domain/season'
import { getCareerPlayer } from '../world/player-catalog'
import { getPressQuestion, PRESS_ANSWER_TEXT, PRESS_EFFECTS, PRESS_HALF_LIFE_DAYS, pressQuote, type LegacyPressAnswer } from '../world/press-policy'
import { isPressStyle, MEDIA_RULES, mediaLabel, mediaMoraleFactor, PRESS_TOPIC_TITLES, pressStyleEffect } from '../world/media'
import { getInboxItems, type InboxCategory, type InboxItem, type InboxTarget } from './inbox-items'
import { quoteInSeasonSale } from '../world/recruitment-policy'
import { formatMoney } from './money-format'
import { awaitsContractReply, getClubContractRequests } from '../world/relationships'
import { ContractRequestCard } from './ContractRequestCard'
import { Icon, type IconName } from './Icon'
import { medicalDate } from './SeasonMedicalReport'
import './inbox-workspace.css'

export interface InboxActions {
  onAnswerPress: (answer: PressAnswer) => void
  onOpen: (target: Exclude<InboxTarget, 'press'>, playerId?: string) => void
  /** Format 66: answer a player's contract request; opening talks also opens his contract offer. */
  onContractReply?: (playerId: string, reply: ContractRequestReply) => void
  /** Format 78: answer a club's offer for one of your players (`season`: in-season market; `offseason`: offseason market). */
  onBidDecision?: (offerId: string, market: 'season' | 'offseason', response: 'accept' | 'reject' | 'counter') => void
  /** Format 80: answer a national federation's job offer. */
  onNationalOffer?: (offerId: string, accept: boolean) => void
  /** Format 83: answer an offered European place for next season (by competition). */
  onEuropeanOffer?: (competitionId: string, accept: boolean) => void
}

/** Owner feedback (18 November 2026): one list of every message, newest first, with an Unread filter instead of category tabs. */
type Filter = 'all' | 'unread'
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }]
const ICONS: Record<InboxCategory, IconName> = { press: 'mail', board: 'shield', club: 'building', players: 'people' }
const OPEN_LABELS: Record<Exclude<InboxTarget, 'press'>, string> = { board: 'Open board', club: 'Open club', dynamics: 'Open squad dynamics', squad: 'Open squad', contract: 'Open contract offer', jobs: 'Open job market', bid: 'Open transfers', europe: 'Open European places', national: 'Open national team', trades: 'Open trades' }
const signed = (value: number) => `${value > 0 ? '+' : '−'}${Math.abs(value)}`

export function pressEffectText(answer: PressAnswer, topic?: PressTopic, subject?: string): string {
  if (isPressStyle(answer) && topic) {
    // Format 67: every effect of the style on this topic, before the media standing's morale factor.
    const effect = pressStyleEffect(topic, answer), parts: string[] = []
    if (effect.subject && subject) parts.push(`${subject} ${signed(effect.subject)} morale`)
    if (effect.core && effect.core === effect.others) parts.push(`${effect.subject && subject ? 'Rest of the squad' : 'Squad'} ${signed(effect.core)} morale`)
    else {
      if (effect.core) parts.push(`Regulars ${signed(effect.core)}`)
      if (effect.others) parts.push(`rest of the squad ${signed(effect.others)} morale`)
    }
    if (effect.board) parts.push(`Board ${signed(effect.board)}`)
    if (effect.supporters) parts.push(`Crowds ${signed(effect.supporters)}%`)
    if (effect.media) parts.push(`Media ${signed(effect.media)}`)
    return parts.join(' · ') || 'No effect'
  }
  const effect = PRESS_EFFECTS[answer as LegacyPressAnswer]
  if (effect.core === 0 && effect.others === 0) return 'No morale change'
  if (effect.core === effect.others) return `Whole squad ${signed(effect.core)} morale`
  return `Regulars ${signed(effect.core)}, rest of the squad ${signed(effect.others)} morale`
}

function RichPressConference({ season, question, busy, onAnswer }: { season: SeasonState; question: PressQuestion; busy: boolean; onAnswer: (answer: PressAnswer) => void }) {
  const name = (id: string) => season.clubs.flatMap(club => club.players).find(player => player.id === id)?.name ?? getCareerPlayer(season, id).name
  const regulars = question.coreIds.map(name).join(', '), subject = question.subjectIds?.length && question.topic !== 'sale' ? name(question.subjectIds[0]!) : undefined
  const standing = question.standing ?? MEDIA_RULES.start
  return <section id="press-conference" className="inbox-press" tabIndex={-1} aria-labelledby="press-title" data-press-topic={question.topic}>
    <header><h3 id="press-title"><Icon name="mail" size={16} />Press conference · {PRESS_TOPIC_TITLES[question.topic]}</h3><span>After matchday {question.triggerRound} · <time dateTime={question.date}>{medicalDate(question.date)}</time></span></header>
    <p className="inbox-press-question">“{question.question}”</p>
    <div className="inbox-press-answers">{question.answers.map(answer => <button key={answer} className="inbox-press-answer" data-press-answer={answer} onClick={() => onAnswer(answer)} disabled={busy}>
      <strong>{PRESS_ANSWER_TEXT[answer].label}</strong><span>“{pressQuote(question.topic, answer)}”</span><small>{pressEffectText(answer, question.topic, subject)}</small>
    </button>)}</div>
    <p className="inbox-press-note" data-press-standing={standing}>Media standing {standing}/100 ({mediaLabel(standing)}): morale effects count ×{(Math.round(mediaMoraleFactor(standing) * 100) / 100).toFixed(2)}. Regulars (most minutes in the last five games): {regulars}. Morale effects fade by half every {PRESS_HALF_LIFE_DAYS / 7} weeks, board effects every four and crowd effects every three; media points stay. Nothing changes the match already prepared. If you don't answer before the next match, your assistant gives no comment and nothing changes.</p>
  </section>
}

function PressConference({ season, question, busy, onAnswer }: { season: SeasonState; question: PressQuestion; busy: boolean; onAnswer: (answer: PressAnswer) => void }) {
  if (question.subjectIds) return <RichPressConference season={season} question={question} busy={busy} onAnswer={onAnswer} />
  const regulars = question.coreIds.map(id => getCareerPlayer(season, id).name).join(', ')
  return <section id="press-conference" className="inbox-press" tabIndex={-1} aria-labelledby="press-title" data-press-topic={question.topic}>
    <header><h3 id="press-title"><Icon name="mail" size={16} />Press conference</h3><span>After matchday {question.triggerRound} · <time dateTime={question.date}>{medicalDate(question.date)}</time></span></header>
    <p className="inbox-press-question">“{question.question}”</p>
    <div className="inbox-press-answers">{question.answers.map(answer => <button key={answer} className="inbox-press-answer" data-press-answer={answer} onClick={() => onAnswer(answer)} disabled={busy}>
      <strong>{PRESS_ANSWER_TEXT[answer].label}</strong><span>“{PRESS_ANSWER_TEXT[answer].quote}”</span><small>{pressEffectText(answer)}</small>
    </button>)}</div>
    <p className="inbox-press-note">Regulars (most minutes in these games): {regulars}. Effects fade by half every {PRESS_HALF_LIFE_DAYS / 7} weeks and never change the match already prepared. If you don't answer before the next match, your assistant keeps it routine.</p>
  </section>
}


/** Read messages are remembered per career in this browser only; they never change the career. */
export function inboxReadKey(season: Pick<SeasonState, 'seed' | 'managedClubId'> & { manager?: { name?: string } | null }): string {
  return `courtside.inbox.read.${season.seed}.${season.manager?.name ?? ''}`
}
function loadRead(key: string): Set<string> {
  try { const value = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]'); return new Set(Array.isArray(value) ? value.filter(id => typeof id === 'string') : []) } catch { return new Set() }
}
function saveRead(key: string, ids: Set<string>): void {
  try { globalThis.localStorage?.setItem(key, JSON.stringify([...ids].slice(-2000))) } catch { /* the browser may block storage; messages then stay unread */ }
}
/** Every message, newest first (a message waiting for a decision first on the same day). */
export function inboxList<T extends { id: string; date: string; needsAction: boolean }>(items: readonly T[], filter: Filter, read: ReadonlySet<string>): T[] {
  return items.filter(item => filter === 'all' || !read.has(item.id)).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.needsAction) - Number(a.needsAction) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Owner feedback (22 November 2026): the message chosen first, before any click: a waiting press conference, else the first decision, else the newest. */
export function defaultInboxSelection<T extends { id: string; target: InboxTarget; needsAction: boolean }>(list: readonly T[]): T | undefined {
  return list.find(item => item.target === 'press' && item.needsAction) ?? list.find(item => item.needsAction) ?? list[0]
}

/** Marking messages read: the browser-only read set with these ids added. */
export function withRead(read: ReadonlySet<string>, ids: readonly string[]): Set<string> { const next = new Set(read); ids.forEach(id => next.add(id)); return next }
/** The list as filtered and the message open on the right; the open message stays in the Unread view after it is marked read. */
export function inboxView<T extends { id: string; date: string; needsAction: boolean; target: InboxTarget }>(items: readonly T[], filter: Filter, read: ReadonlySet<string>, selectedId: string | null): { shown: T[]; selected: T | undefined } {
  const shown = inboxList(items, filter, selectedId ? new Set([...read].filter(id => id !== selectedId)) : read)
  return { shown, selected: shown.find(item => item.id === selectedId) ?? defaultInboxSelection(shown) }
}

/**
 * Owner feedback (22 November 2026): two panes, like a mail program. The list on the left holds date, short title and
 * the unread dot; the chosen message opens on the right with its full text and actions. Choosing a message marks it
 * read. On a phone the list opens the message full width with a Back button.
 */
/** Owner feedback (22 November 2026): a club's offer for one of your players, with Accept, Counter and Decline. */
function BidDecision({ season, item, busy, onDecision }: { season: SeasonState; item: InboxItem; busy: boolean; onDecision: NonNullable<InboxActions['onBidDecision']> }) {
  const offerId = item.offerId!, market = item.market!
  const offer = market === 'season' ? season.recruitment.offers.find(entry => entry.id === offerId) : season.market.windows.flatMap(window => window.offers).find(entry => entry.id === offerId)
  if (!offer?.transfer) return null
  const transfer = offer.transfer, loan = transfer.mode === 'loan'
  let canAccept = true, reason: string | null = null, canCounter = !loan && transfer.fee < transfer.requiredFee
  if (market === 'season') { const quote = quoteInSeasonSale(season, offerId); canAccept = quote.canAccept; reason = quote.acceptReason; canCounter = quote.canCounter }
  const buyer = season.clubs.find(club => club.id === offer.clubId)?.name ?? 'The club'
  return <div className="inbox-bid" data-inbox-bid={offerId} data-bid-kind={loan ? 'loan' : 'transfer'}>
    <dl><div><dt>{loan ? 'Loan fee' : 'Transfer fee'}</dt><dd>{formatMoney(transfer.fee)}</dd></div><div><dt>From</dt><dd>{buyer}</dd></div>{!loan && <div><dt>Asking fee</dt><dd>{formatMoney(transfer.requiredFee)}</dd></div>}</dl>
    <p className="inbox-bid-note">{loan ? 'He plays for them until the season ends and they pay his wages. His contract with you continues next season.' : 'The fee goes to Spending left and his wages leave your Wages left once he signs.'}</p>
    <div className="inbox-bid-actions">
      <button className="button primary small" data-bid-accept={offerId} onClick={() => onDecision(offerId, market, 'accept')} disabled={busy || !canAccept}>Accept<Icon name="check" size={14} /></button>
      {canCounter && <button className="button small" data-bid-counter={offerId} onClick={() => onDecision(offerId, market, 'counter')} disabled={busy}>Ask {formatMoney(transfer.requiredFee)}</button>}
      <button className="button small" data-bid-decline={offerId} onClick={() => onDecision(offerId, market, 'reject')} disabled={busy}>Decline</button>
    </div>
    {!canAccept && reason && <p className="inbox-bid-note">{reason}</p>}
  </div>
}

export function InboxWorkspace({ season, busy = false, onAnswerPress, onOpen, onContractReply, onBidDecision, onNationalOffer, onEuropeanOffer, initialSelectedId = null }: InboxActions & { season: SeasonState; busy?: boolean; initialSelectedId?: string | null }) {
  const [filter, setFilter] = useState<Filter>('all')
  const readKey = inboxReadKey(season)
  const [read, setRead] = useState<Set<string>>(() => loadRead(readKey))
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [opened, setOpened] = useState(false)
  const readerRef = useRef<HTMLElement>(null)
  const markRead = (ids: string[]) => setRead(current => { const next = withRead(current, ids); saveRead(readKey, next); return next })
  const items = getInboxItems(season)
  const question = getPressQuestion(season)
  const requests = onContractReply ? getClubContractRequests(season, season.managedClubId, season.seasonNumber).filter(request => awaitsContractReply(season, request)) : []
  const { shown, selected } = inboxView(items, filter, read, selectedId)
  const waiting = items.filter(item => item.needsAction).length
  const unread = items.filter(item => !read.has(item.id)).length
  const choose = (id: string) => {
    setSelectedId(id); setOpened(true); markRead([id])
    requestAnimationFrame(() => readerRef.current?.focus({ preventScroll: globalThis.matchMedia?.('(min-width: 761px)').matches ?? true }))
  }
  const back = () => {
    setOpened(false)
    const id = selected?.id ?? ''
    requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('[data-inbox-item]')].find(row => row.dataset.inboxItem === id)?.querySelector<HTMLElement>('button')?.focus())
  }
  const request = selected ? requests.find(item => item.id === selected.id) : undefined
  const pressOpen = selected?.target === 'press' && question && !question.answered ? question : null
  const player = selected?.playerId ? season.clubs.find(club => club.id === season.managedClubId)?.players.find(member => member.id === selected.playerId) : undefined
  return <div className="inbox-workspace" data-inbox-opened={opened ? 'true' : 'false'}>
    <section className="panel inbox-panel" aria-labelledby="inbox-title">
      <header className="inbox-heading"><h2 id="inbox-title"><Icon name="mail" size={18} />Messages</h2><span data-inbox-waiting={waiting}>{waiting ? `${waiting} ${waiting === 1 ? 'needs' : 'need'} action · ` : ''}{items.length} {items.length === 1 ? 'message' : 'messages'}{unread ? ` · ${unread} unread` : ''}</span></header>
      <div className="inbox-panes">
        <div className="inbox-list-pane">
          <div className="inbox-filters" role="group" aria-label="Filter messages">{FILTERS.map(option => <button key={option.id} className={filter === option.id ? 'selected' : ''} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label}{option.id === 'unread' && unread ? ` (${unread})` : ''}</button>)}{unread > 0 && <button className="inbox-mark-read" onClick={() => markRead(items.map(item => item.id))} disabled={busy}>Mark all read</button>}</div>
          {shown.length ? <ul className="inbox-list" aria-label="Messages">{shown.map(item => <li key={item.id} data-inbox-item={item.id} data-inbox-category={item.category} data-inbox-unread={read.has(item.id) ? undefined : 'true'} className={[item.needsAction ? 'inbox-action' : '', read.has(item.id) ? '' : 'inbox-unread', selected?.id === item.id ? 'inbox-selected' : ''].filter(Boolean).join(' ') || undefined}>
            <button className="inbox-row" aria-current={selected?.id === item.id ? 'true' : undefined} aria-controls="inbox-reader" onClick={() => choose(item.id)}>
              <span className="inbox-icon" aria-hidden="true"><Icon name={ICONS[item.category]} size={16} /></span>
              <span className="inbox-text"><strong>{!read.has(item.id) && <span className="inbox-unread-dot" role="img" aria-label="Unread" />}{item.title}</strong><time dateTime={item.date}>{medicalDate(item.date)}{item.needsAction ? ' · Action needed' : ''}</time></span>
            </button>
          </li>)}</ul> : <p className="inbox-empty">{filter === 'unread' ? 'No unread messages.' : 'No messages in this view yet. Board reviews, press conferences, sponsor news and player concerns appear here as they happen.'}</p>}
        </div>
        <article id="inbox-reader" ref={readerRef} className="inbox-reader" tabIndex={-1} aria-label={selected ? selected.title : 'No message chosen'} data-inbox-selected={selected?.id}>
          {selected ? <>
            <button className="text-button inbox-back" onClick={back}><Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} />Back to messages</button>
            {!pressOpen && <header className="inbox-reader-heading"><span className="inbox-icon" aria-hidden="true"><Icon name={ICONS[selected.category]} size={18} /></span><div><h3>{selected.title}</h3><time dateTime={selected.date}>{medicalDate(selected.date)}</time></div></header>}
            {pressOpen ? <PressConference season={season} question={pressOpen} busy={busy} onAnswer={onAnswerPress} />
              : <p className="inbox-reader-text">{selected.detail}</p>}
            {selected.target === 'bid' && selected.needsAction && onBidDecision && <BidDecision season={season} item={selected} busy={busy} onDecision={onBidDecision} />}
            {selected.target === 'national' && selected.needsAction && selected.offerId && onNationalOffer && <div className="inbox-bid" data-national-offer={selected.offerId}><div className="inbox-bid-actions">
              <button className="button primary small" data-national-accept={selected.offerId} onClick={() => onNationalOffer(selected.offerId!, true)} disabled={busy}>Accept<Icon name="check" size={14} /></button>
              <button className="button small" data-national-decline={selected.offerId} onClick={() => onNationalOffer(selected.offerId!, false)} disabled={busy}>Decline</button>
            </div></div>}
            {selected.target === 'europe' && selected.needsAction && selected.offerId && onEuropeanOffer && <div className="inbox-bid" data-european-offer={selected.offerId}><div className="inbox-bid-actions">
              <button className="button primary small" data-european-accept={selected.offerId} onClick={() => onEuropeanOffer(selected.offerId!, true)} disabled={busy}>Accept<Icon name="check" size={14} /></button>
              <button className="button small" data-european-decline={selected.offerId} onClick={() => onEuropeanOffer(selected.offerId!, false)} disabled={busy}>Decline</button>
            </div></div>}
            {request && onContractReply && <div id="contract-requests" className="inbox-contract-requests" tabIndex={-1}><ContractRequestCard season={season} request={request} busy={busy} onReply={onContractReply} /></div>}
            <div className="inbox-reader-actions">
              {selected.target !== 'press' && <button className="button small" onClick={() => onOpen(selected.target as Exclude<InboxTarget, 'press'>, selected.playerId)} disabled={busy}>{OPEN_LABELS[selected.target as Exclude<InboxTarget, 'press'>]}<Icon name="chevron" size={14} /></button>}
              {player && selected.target !== 'squad' && <button className="button small" onClick={() => onOpen('squad', player.id)} disabled={busy}>Open player · {player.name}</button>}
            </div>
          </> : <p className="inbox-empty">Choose a message to read it here.</p>}
        </article>
      </div>
    </section>
  </div>
}
