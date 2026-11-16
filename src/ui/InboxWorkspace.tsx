import { useState } from 'react'
import type { PressAnswer, PressQuestion, PressTopic } from '../domain/relationships'
import type { SeasonState } from '../domain/season'
import { getCareerPlayer } from '../world/player-catalog'
import { getPressQuestion, PRESS_ANSWER_TEXT, PRESS_EFFECTS, PRESS_HALF_LIFE_DAYS, pressQuote, type LegacyPressAnswer } from '../world/press-policy'
import { isPressStyle, MEDIA_RULES, mediaLabel, mediaMoraleFactor, PRESS_TOPIC_TITLES, pressStyleEffect } from '../world/media'
import { getInboxItems, type InboxCategory, type InboxTarget } from './inbox-items'
import { Icon, type IconName } from './Icon'
import { medicalDate } from './SeasonMedicalReport'
import './inbox-workspace.css'

export interface InboxActions {
  onAnswerPress: (answer: PressAnswer) => void
  onOpen: (target: Exclude<InboxTarget, 'press'>, playerId?: string) => void
}

type Filter = 'all' | 'action' | InboxCategory
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'action', label: 'Needs action' }, { id: 'press', label: 'Press' }, { id: 'board', label: 'Board' }, { id: 'players', label: 'Players' }, { id: 'club', label: 'Club' }]
const ICONS: Record<InboxCategory, IconName> = { press: 'mail', board: 'shield', club: 'building', players: 'people' }
const OPEN_LABELS: Record<Exclude<InboxTarget, 'press'>, string> = { board: 'Open board', club: 'Open club', dynamics: 'Open squad dynamics', squad: 'Open squad' }
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

export function InboxWorkspace({ season, busy = false, onAnswerPress, onOpen }: InboxActions & { season: SeasonState; busy?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all')
  const items = getInboxItems(season)
  const question = getPressQuestion(season)
  const shown = items.filter(item => filter === 'all' || (filter === 'action' ? item.needsAction : item.category === filter))
  const waiting = items.filter(item => item.needsAction).length
  return <div className="inbox-workspace">
    <section className="panel inbox-panel" aria-labelledby="inbox-title">
      <header className="inbox-heading"><h2 id="inbox-title"><Icon name="mail" size={18} />Inbox</h2><span data-inbox-waiting={waiting}>{waiting ? `${waiting} ${waiting === 1 ? 'needs' : 'need'} action · ` : ''}{items.length} {items.length === 1 ? 'message' : 'messages'}</span></header>
      {question && !question.answered && <PressConference season={season} question={question} busy={busy} onAnswer={onAnswerPress} />}
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
