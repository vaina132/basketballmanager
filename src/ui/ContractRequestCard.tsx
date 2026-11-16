import type { ContractRequest, ContractRequestReply } from '../domain/relationships'
import type { SeasonState } from '../domain/season'
import { getCareerPlayer } from '../world/player-catalog'
import { quoteContractReply } from '../world/relationships'
import { seasonLabel } from '../world/season'
import { CONTRACT_REQUEST_TEXT } from '../world/relationship-rules'
import { Icon } from './Icon'
import { medicalDate } from './SeasonMedicalReport'
import './contract-request.css'

const REPLIES: readonly ContractRequestReply[] = ['talks', 'promise', 'decline']
export const CONTRACT_REQUEST_STATUS: Record<ContractRequest['status'], string> = {
  open: 'Waiting for your answer',
  ignored: 'Request ignored',
  declined: 'Request declined',
  talks: 'Renewal talks open',
  promised: 'Talks promised at season end',
  kept: 'Contract talks held',
  lapsed: 'Talks lapsed without an offer',
  broken: 'Promised talks never happened',
  renewed: 'New contract agreed',
  departed: 'Player left the club',
}

/** One sentence on where a request stands, for profile and dynamics rows. */
export function contractRequestSummary(request: ContractRequest): string {
  if (request.status === 'open') return `Answer by ${medicalDate(request.replyBy)}.`
  if (request.status === 'talks') return `Make him an offer by ${medicalDate(request.deadlineDate!)}.`
  if (request.status === 'promised') return `Make him an offer before ${medicalDate(request.deadlineDate!)}.`
  return `${CONTRACT_REQUEST_STATUS[request.status]}${request.outcomeDate ? ` · ${medicalDate(request.outcomeDate)}` : ''}${request.premiumPercent ? ` · asks ${request.premiumPercent}% more to re-sign` : ''}.`
}

/**
 * A player's contract request: while open, the three answers with their consequences; afterwards its status. Opening
 * talks also takes the manager to the player's contract offer.
 */
export function ContractRequestCard({ season, request, busy, onReply, headingLevel = 3 }: { season: SeasonState; request: ContractRequest; busy: boolean; onReply: (playerId: string, reply: ContractRequestReply) => void; headingLevel?: 3 | 4 }) {
  const player = getCareerPlayer(season, request.playerId)
  const Heading = headingLevel === 3 ? 'h3' : 'h4'
  const titleId = `contract-request-title-${request.id}`
  if (request.status !== 'open') return <p className="contract-request-status" data-contract-request={request.id} data-contract-request-status={request.status}><Icon name="mail" size={15} /><span><strong>{CONTRACT_REQUEST_STATUS[request.status]}</strong> {contractRequestSummary(request)}</span></p>
  return <section className="contract-request" data-contract-request={request.id} data-contract-request-status="open" aria-labelledby={titleId}>
    <header><Heading id={titleId}><Icon name="mail" size={16} />{player.name} asks about a new contract</Heading><span>Answer by <time dateTime={request.replyBy}>{medicalDate(request.replyBy)}</time></span></header>
    <p>{request.trigger === 'interest' ? 'Another club has made an offer for him. ' : ''}His contract ends after {seasonLabel(request.seasonNumber)} and he wants to know his future. Without an answer within {CONTRACT_REQUEST_TEXT.replyWindow} he takes it as ignored: that {CONTRACT_REQUEST_TEXT.cost('ignored')} and {CONTRACT_REQUEST_TEXT.premium('ignored')}.</p>
    <div className="contract-request-answers" role="group" aria-label={`Answers to ${player.name}`}>{REPLIES.map(reply => {
      const quote = quoteContractReply(season, request.playerId, reply, request.clubId)
      return <button key={reply} className="contract-request-answer" data-contract-reply={reply} onClick={() => onReply(request.playerId, reply)} disabled={busy || !quote.canReply} title={quote.reason ?? undefined}>
        <strong>{quote.title}</strong><span>{quote.detail}</span>
      </button>
    })}</div>
  </section>
}
