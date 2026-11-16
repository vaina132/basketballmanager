import { useState } from 'react'
import type { ContractRequestReply, PressAnswer, PressQuestion } from '../domain/relationships'
import type { SeasonState } from '../domain/season'
import { getCareerPlayer } from '../world/player-catalog'
import { getPressQuestion, PRESS_ANSWER_TEXT, PRESS_EFFECTS, PRESS_HALF_LIFE_DAYS } from '../world/press-policy'
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

type Filter = 'all' | 'action' | InboxCategory
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'action', label: 'Needs action' }, { id: 'press', label: 'Press' }, { id: 'board', label: 'Board' }, { id: 'players', label: 'Players' }, { id: 'club', label: 'Club' }]
const ICONS: Record<InboxCategory, IconName> = { press: 'mail', board: 'shield', club: 'building', players: 'people' }
const OPEN_LABELS: Record<Exclude<InboxTarget, 'press'>, string> = { board: 'Open board', club: 'Open club', dynamics: 'Open squad dynamics', squad: 'Open squad', contract: 'Open contract offer' }
const signed = (value: number) => `${value > 0 ? '+' : '−'}${Math.abs(value)}`

export function pressEffectText(answer: PressAnswer): string {
  const effect = PRESS_EFFECTS[answer]
  if (effect.core === 0 && effect.others === 0) return 'No morale change'
  if (effect.core === effect.others) return `Whole squad ${signed(effect.core)} morale`
  return `Regulars ${signed(effect.core)}, rest of the squad ${signed(effect.others)} morale`
}

function PressConference({ season, question, busy, onAnswer }: { season: SeasonState; question: PressQuestion; busy: boolean; onAnswer: (answer: PressAnswer) => void }) {
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

export function InboxWorkspace({ season, busy = false, onAnswerPress, onOpen, onContractReply }: InboxActions & { season: SeasonState; busy?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all')
  const items = getInboxItems(season)
  const question = getPressQuestion(season)
  const requests = onContractReply ? getClubContractRequests(season, season.managedClubId, season.seasonNumber).filter(request => awaitsContractReply(season, request)) : []
  const shown = items.filter(item => filter === 'all' || (filter === 'action' ? item.needsAction : item.category === filter))
  const waiting = items.filter(item => item.needsAction).length
  return <div className="inbox-workspace">
    <section className="panel inbox-panel" aria-labelledby="inbox-title">
      <header className="inbox-heading"><h2 id="inbox-title"><Icon name="mail" size={18} />Inbox</h2><span data-inbox-waiting={waiting}>{waiting ? `${waiting} ${waiting === 1 ? 'needs' : 'need'} action · ` : ''}{items.length} {items.length === 1 ? 'message' : 'messages'}</span></header>
      {question && !question.answered && <PressConference season={season} question={question} busy={busy} onAnswer={onAnswerPress} />}
      {requests.length > 0 && onContractReply && <div id="contract-requests" className="inbox-contract-requests" tabIndex={-1}>{requests.map(request => <ContractRequestCard key={request.id} season={season} request={request} busy={busy} onReply={onContractReply} />)}</div>}
      <div className="inbox-filters" role="group" aria-label="Filter messages">{FILTERS.map(option => <button key={option.id} className={filter === option.id ? 'selected' : ''} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label}</button>)}</div>
      {shown.length ? <ul className="inbox-list">{shown.map(item => <li key={item.id} data-inbox-item={item.id} data-inbox-category={item.category} className={item.needsAction ? 'inbox-action' : ''}>
        <span className="inbox-icon" aria-hidden="true"><Icon name={ICONS[item.category]} size={18} /></span>
        <div className="inbox-text"><strong>{item.title}</strong><span>{item.detail}</span></div>
        <time dateTime={item.date}>{medicalDate(item.date)}</time>
        {item.target === 'press' ? <button className="text-button" onClick={() => { const card = document.getElementById('press-conference'); card?.focus({ preventScroll: true }); card?.scrollIntoView({ block: 'nearest' }) }} disabled={busy}>Answer above</button> : <button className="text-button" onClick={() => onOpen(item.target as Exclude<InboxTarget, 'press'>, item.playerId)} disabled={busy}>{OPEN_LABELS[item.target as Exclude<InboxTarget, 'press'>]}</button>}
      </li>)}</ul> : <p className="inbox-empty">{filter === 'action' ? 'Nothing needs your decision right now.' : 'No messages in this view yet. Board reviews, press conferences, sponsor news and player concerns appear here as they happen.'}</p>}
    </section>
  </div>
}
