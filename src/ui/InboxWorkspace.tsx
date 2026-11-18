import { useState } from 'react'
import type { ContractRequestReply, PressAnswer, PressQuestion, PressTopic } from '../domain/relationships'
import type { SeasonState } from '../domain/season'
import { getCareerPlayer } from '../world/player-catalog'
import { getPressQuestion, PRESS_ANSWER_TEXT, PRESS_EFFECTS, PRESS_HALF_LIFE_DAYS, pressQuote, type LegacyPressAnswer } from '../world/press-policy'
import { isPressStyle, MEDIA_RULES, mediaLabel, mediaMoraleFactor, PRESS_TOPIC_TITLES, pressStyleEffect } from '../world/media'
import { getInboxItems, type InboxCategory, type InboxTarget } from './inbox-items'
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
}

/** Owner feedback (18 November 2026): one list of every message, newest first, with an Unread filter instead of category tabs. */
type Filter = 'all' | 'unread'
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }]
const ICONS: Record<InboxCategory, IconName> = { press: 'mail', board: 'shield', club: 'building', players: 'people' }
const OPEN_LABELS: Record<Exclude<InboxTarget, 'press'>, string> = { board: 'Open board', club: 'Open club', dynamics: 'Open squad dynamics', squad: 'Open squad', contract: 'Open contract offer', jobs: 'Open job market' }
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

export function InboxWorkspace({ season, busy = false, onAnswerPress, onOpen, onContractReply }: InboxActions & { season: SeasonState; busy?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all')
  const readKey = inboxReadKey(season)
  const [read, setRead] = useState<Set<string>>(() => loadRead(readKey))
  const markRead = (ids: string[]) => setRead(current => { const next = new Set(current); ids.forEach(id => next.add(id)); saveRead(readKey, next); return next })
  const items = getInboxItems(season)
  const question = getPressQuestion(season)
  const requests = onContractReply ? getClubContractRequests(season, season.managedClubId, season.seasonNumber).filter(request => awaitsContractReply(season, request)) : []
  const shown = inboxList(items, filter, read)
  const waiting = items.filter(item => item.needsAction).length
  const unread = items.filter(item => !read.has(item.id)).length
  return <div className="inbox-workspace">
    <section className="panel inbox-panel" aria-labelledby="inbox-title">
      <header className="inbox-heading"><h2 id="inbox-title"><Icon name="mail" size={18} />Inbox</h2><span data-inbox-waiting={waiting}>{waiting ? `${waiting} ${waiting === 1 ? 'needs' : 'need'} action · ` : ''}{items.length} {items.length === 1 ? 'message' : 'messages'}{unread ? ` · ${unread} unread` : ''}</span></header>
      {question && !question.answered && <PressConference season={season} question={question} busy={busy} onAnswer={onAnswerPress} />}
      {requests.length > 0 && onContractReply && <div id="contract-requests" className="inbox-contract-requests" tabIndex={-1}>{requests.map(request => <ContractRequestCard key={request.id} season={season} request={request} busy={busy} onReply={onContractReply} />)}</div>}
      <div className="inbox-filters" role="group" aria-label="Filter messages">{FILTERS.map(option => <button key={option.id} className={filter === option.id ? 'selected' : ''} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label}{option.id === 'unread' && unread ? ` (${unread})` : ''}</button>)}{unread > 0 && <button className="inbox-mark-read" onClick={() => markRead(items.map(item => item.id))} disabled={busy}>Mark all read</button>}</div>
      {shown.length ? <ul className="inbox-list">{shown.map(item => <li key={item.id} data-inbox-item={item.id} data-inbox-category={item.category} data-inbox-unread={read.has(item.id) ? undefined : 'true'} className={[item.needsAction ? 'inbox-action' : '', read.has(item.id) ? '' : 'inbox-unread'].filter(Boolean).join(' ') || undefined}>
        <span className="inbox-icon" aria-hidden="true"><Icon name={ICONS[item.category]} size={18} /></span>
        <div className="inbox-text"><strong>{!read.has(item.id) && <span className="inbox-unread-dot" aria-label="Unread" />}{item.title}</strong><span>{item.detail}</span></div>
        <time dateTime={item.date}>{medicalDate(item.date)}</time>
        {item.target === 'press' ? <button className="text-button" onClick={() => { markRead([item.id]); const card = document.getElementById('press-conference'); card?.focus({ preventScroll: true }); card?.scrollIntoView({ block: 'nearest' }) }} disabled={busy}>Answer above</button> : <button className="text-button" onClick={() => { markRead([item.id]); onOpen(item.target as Exclude<InboxTarget, 'press'>, item.playerId) }} disabled={busy}>{OPEN_LABELS[item.target as Exclude<InboxTarget, 'press'>]}</button>}
      </li>)}</ul> : <p className="inbox-empty">{filter === 'unread' ? 'No unread messages.' : 'No messages in this view yet. Board reviews, press conferences, sponsor news and player concerns appear here as they happen.'}</p>}
    </section>
  </div>
}
