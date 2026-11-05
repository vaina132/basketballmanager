import { describe, expect, it } from 'vitest';
import type { MatchState, Side } from '../src/domain/types';
import { attackingDirection, canSubstituteNow, cancelSubstitution, cancelTimeoutRequest, createMatch, defensiveFoulShotClock, isPlayerEligible, remainingTimeouts, requestTimeout, setAutoSubstitutions, setInjuryMode, simulateToEnd, simulateToQuarterEnd, stepMatch, substitutePlayer } from '../src/engine/match';

const other = (side: Side): Side => side === 'home' ? 'away' : 'home';
const fixture = (seed = 42) => setInjuryMode(createMatch(seed), 'off');
function live(seed = 42): MatchState { const state = fixture(seed); state.status = 'playing'; state.phase = 'live-ball'; state.stoppage = null; state.clockSeconds = 580; state.stepCount = 1; return state; }
function transition(configure: (state: MatchState) => void, predicate: (state: MatchState) => boolean): MatchState {
  for (let seed = 1; seed <= 2000; seed += 1) { const state = fixture(seed); configure(state); const next = stepMatch(state); if (predicate(next)) return next; }
  throw new Error('No scenario matched within the fixed seed range.');
}
function fullWindow(state: MatchState): void { state.phase = 'dead-ball'; state.stoppage = { reason: 'whistle', substitutionSides: ['home', 'away'], timeoutSides: ['home', 'away'] }; }

describe('FIBA-2024 clock and penalty subset', () => {
  it('turns an expired shot clock into a turnover without a fabricated shot', () => {
    const state = live(); state.shotClockSeconds = 1; state.frontcourt = true; const offense = state.possession;
    const next = stepMatch(state);
    expect(next.clockSeconds).toBe(579); expect(next.shotClockSeconds).toBe(24); expect(next.possession).toBe(other(offense));
    expect(next.events.at(-1)?.type).toBe('shot-clock'); expect(next.score).toEqual({home: 0, away: 0});
    expect(Object.values(next.stats).reduce((n,s)=>n+s.fieldGoalsAttempted,0)).toBe(0);
  });
  it('reacts to fourteen seconds instead of blindly using a full-possession action plan', () => {
    let violations = 0, shots = 0;
    for(let seed=1; seed<=200;seed++) { const state=fixture(seed);state.shotClockSeconds=14;state.frontcourt=true;state.tactics[state.possession].tempo=0;
      const next=stepMatch(state); violations += Number(next.events.some(e=>e.type==='shot-clock')); shots += Number(next.events.some(e=>e.type==='shot'));
    }
    expect(violations).toBeGreaterThan(0); expect(violations).toBeLessThan(30); expect(shots).toBeGreaterThan(100);
  });
  it('uses fourteen on an offensive rim rebound and twenty-four on new defensive control', () => {
    const offensive=transition(s=>{s.frontcourt=true;}, s=>s.events.at(-1)?.text.includes('offensive rebound')===true && !s.events.some(e=>e.type==='shot'&&e.text.includes('blocks')));
    expect(offensive.shotClockSeconds).toBe(14); expect(offensive.frontcourt).toBe(true); expect(offensive.stoppage).toBeNull();
    const defensive=transition(()=>{}, s=>s.events.at(-1)?.text.includes('defensive rebound')===true);
    expect(defensive.shotClockSeconds).toBe(24); expect(defensive.frontcourt).toBe(false);
  });
  it('does not reset the clock for an offensive recovery of a block that missed the rim', () => {
    const next=transition(s=>{s.frontcourt=true;}, s=>s.events.some(e=>e.type==='shot'&&e.text.includes('blocks')) && s.events.at(-1)?.text.includes('offensive rebound')===true);
    expect(next.shotClockSeconds).toBe(24-(600-next.clockSeconds));
  });
  it('applies the defensive-foul frontcourt floor and backcourt reset', () => {
    expect(defensiveFoulShotClock(7,true)).toBe(14); expect(defensiveFoulShotClock(19,true)).toBe(19); expect(defensiveFoulShotClock(7,false)).toBe(24);
  });
  it('awards two free throws on the fifth non-shooting defensive foul', () => {
    const next=transition(s=>{s.teamFouls[other(s.possession)]=4;}, s=>s.events.some(e=>e.type==='foul'&&e.text.includes('non-shooting')));
    expect(next.freeThrows?.total).toBe(2); expect(next.phase).toBe('free-throws'); expect(next.teamFouls[other(next.possession)]).toBe(5);
  });
  it('does not award bonus free throws for a team-control offensive foul', () => {
    const next=transition(s=>{s.teamFouls[s.possession]=4;}, s=>s.events.some(e=>e.type==='foul'&&e.text.includes('team-control')));
    expect(next.freeThrows).toBeNull(); expect(next.phase).toBe('dead-ball');
  });
  it('resets quarter fouls but carries fourth-quarter fouls through overtime', () => {
    const state=fixture();state.phase='period-end';state.clockSeconds=0;state.status='playing';state.teamFouls={home:4,away:3};
    const next=stepMatch(state); expect(next.period).toBe(2); expect(next.teamFouls.home).toBeLessThanOrEqual(1);expect(next.teamFouls.away).toBeLessThanOrEqual(1);
    state.period=4;const overtime=stepMatch(state); expect(overtime.period).toBe(5);expect(overtime.teamFouls.home).toBeGreaterThanOrEqual(4);expect(overtime.teamFouls.away).toBeGreaterThanOrEqual(3);
  });
  it('completes outstanding free throws at the period horn before ending the period', () => {
    const state=live();state.period=4;state.clockSeconds=0;state.phase='free-throws';state.score={home:10,away:8};
    state.freeThrows={side:'home',shooterId:state.lineups.home[0]!,total:3,remaining:3};fullWindow(state);state.phase='free-throws';
    const first=stepMatch(state);expect(first.status).toBe('playing');expect(first.freeThrows?.remaining).toBe(2);expect(first.clockSeconds).toBe(0);
    const end=simulateToQuarterEnd(first);expect(end.status).toBe('finished');expect(end.period).toBe(4);expect(end.freeThrows).toBeNull();
    expect(end.events.filter(e=>e.type==='free-throw')).toHaveLength(3);expect(end.events.at(-1)?.type).toBe('final');
  });
  it('uses the possession arrow for period starts and reverses court direction after halftime', () => {
    const state=fixture(); const arrow=state.possessionArrow;state.phase='period-end';state.clockSeconds=0;state.status='playing';
    const next=stepMatch(state); expect(next.possessionArrow).toBe(other(arrow));
    expect(attackingDirection({period:1},'home')).toBe(1);expect(attackingDirection({period:3},'home')).toBe(-1);expect(attackingDirection({period:6},'away')).toBe(1);
  });
  it('retains remaining clock on a held ball when the arrow retains offensive control', () => {
    const next=transition(s=>{s.frontcourt=true;s.possessionArrow=s.possession;}, s=>s.events.at(-1)?.type==='held-ball');
    expect(next.shotClockSeconds).toBe(24-(600-next.clockSeconds));expect(next.frontcourt).toBe(true);
  });
});

describe('legal coaching opportunities and exclusions', () => {
  it('queues live-ball substitutions without changing court time or randomness and applies them at a whistle', () => {
    const state=live(), out=state.lineups.home[0]!, incoming=state.home.players[5]!.id;
    const queued=substitutePlayer(state,'home',out,incoming);expect(queued.lineups.home).toContain(out);expect(queued.pendingSubstitutions.home).toHaveLength(1);expect(queued.rngState).toBe(state.rngState);expect(queued.stats).toEqual(state.stats);
    fullWindow(queued); const applied=substitutePlayer(queued,'home',out,incoming);expect(applied.lineups.home).toContain(incoming);expect(applied.pendingSubstitutions.home).toHaveLength(0);
    const cancelled=cancelSubstitution(queued,'home',out);expect(cancelled.pendingSubstitutions.home).toHaveLength(0);
  });
  it('prevents an immediate substitution reversal until a clock-running phase', () => {
    const state=fixture(),out=state.lineups.home[0]!,incoming=state.home.players[5]!.id;
    const changed=substitutePlayer(state,'home',out,incoming), reversal=substitutePlayer(changed,'home',incoming,out);
    expect(reversal.lineups.home).toContain(incoming);expect(reversal.pendingSubstitutions.home).toHaveLength(1);
  });
  it('protects the pending free-throw shooter from an ordinary substitution', () => {
    const state=live(),shooter=state.lineups.home[0]!,incoming=state.home.players[5]!.id;fullWindow(state);state.phase='free-throws';state.freeThrows={side:'home',shooterId:shooter,total:2,remaining:2};
    const queued=substitutePlayer(state,'home',shooter,incoming);expect(queued.lineups.home).toContain(shooter);expect(queued.pendingSubstitutions.home).toHaveLength(1);expect(canSubstituteNow(queued,'home',shooter)).toBe(false);
  });
  it('stops watched, quarter and instant progression until a fifth-foul replacement is supplied', () => {
    const state=live(),out=state.lineups.home[0]!;state.stats[out]!.fouls=5;const stopped=stepMatch(state);
    expect(stopped.requiredSubstitutions).toEqual([{side:'home',playerId:out,reason:'fouled-out'}]);expect(stopped.clockSeconds).toBe(state.clockSeconds);
    expect(stepMatch(stopped).stats).toEqual(stopped.stats);expect(simulateToEnd(stopped)).toBe(stopped);expect(simulateToQuarterEnd(stopped)).toBe(stopped);
    const resumed=substitutePlayer(stopped,'home',out,state.home.players[5]!.id);expect(resumed.requiredSubstitutions).toHaveLength(0);expect(resumed.lineups.home).not.toContain(out);
    const next=stepMatch(resumed);expect(next.stats[out]!.secondsPlayed).toBe(state.stats[out]!.secondsPlayed);expect(isPlayerEligible(next,out)).toBe(false);
    expect(()=>substitutePlayer(next,'home',next.lineups.home[0]!,out)).toThrow(/excluded/);
  });
  it('requires the excluded-player replacement before granting a requested timeout', () => {
    const state=live(),out=state.lineups.home[0]!;state.stats[out]!.fouls=5;fullWindow(state);
    const stopped=requestTimeout(stepMatch(state),'home');expect(stopped.timeoutRequested.home).toBe(true);expect(stopped.timeoutUsage.home.firstHalf).toBe(0);
    const resumed=substitutePlayer(stopped,'home',out,state.home.players[5]!.id);expect(resumed.timeoutUsage.home.firstHalf).toBe(1);
    expect(resumed.events.findIndex(e=>e.type==='substitution')).toBeLessThan(resumed.events.findIndex(e=>e.type==='timeout'));
  });
  it('lets the saved assistant replace excluded players without another sporting engine', () => {
    const state=live(),out=state.lineups.home[0]!;state.stats[out]!.fouls=5;
    const delegated=setAutoSubstitutions(state,'home',true);expect(delegated.requiredSubstitutions).toHaveLength(0);expect(delegated.lineups.home).not.toContain(out);expect(delegated.rngState).toBe(state.rngState);
  });
  it('gives the bench meaningful minutes under the same saved assistant policy in a full match', () => {
    let reserveSeconds=0;
    for(let seed=1;seed<=8;seed++) {
      const end=simulateToEnd(setAutoSubstitutions(fixture(seed),'home',true));
      for(const side of ['home','away'] as const) reserveSeconds+=end[side].players.slice(5).reduce((sum,p)=>sum+end.stats[p.id]!.secondsPlayed,0);
    }
    expect(reserveSeconds/(8*2)).toBeGreaterThan(1800);
  });
  it('opens reciprocal opportunities when the receiving team uses an automatic late-game rotation', () => {
    const state=live();state.period=4;state.clockSeconds=100;state.possession='away';state.stoppage={reason:'made-basket',substitutionSides:['away'],timeoutSides:['away']};
    state.stats[state.lineups.away[0]!]!.condition=60;
    const homeOut=state.lineups.home[0]!,homeIn=state.home.players[5]!.id;
    const changed=substitutePlayer(state,'home',homeOut,homeIn);
    expect(changed.lineups.away).not.toContain(state.lineups.away[0]!);expect(changed.lineups.home).toContain(homeIn);expect(changed.pendingSubstitutions.home).toHaveLength(0);
  });
  it('plays short-handed with two eligible players and defaults only below two', () => {
    const state=live();for(const p of state.home.players.slice(2))state.stats[p.id]!.fouls=5;
    const next=stepMatch(state);expect(next.status).toBe('playing');expect(next.lineups.home).toHaveLength(2);expect(next.courtSeconds.home).toBe((state.clockSeconds-next.clockSeconds)*2);
    state.stats[state.home.players[1]!.id]!.fouls=5;const ended=stepMatch(state);expect(ended.status).toBe('finished');expect(ended.result).toEqual({winner:'away',kind:'default',officialScore:{home:0,away:2}});expect(ended.score).toEqual({home:0,away:0});
  });
  it('retains the actual score on default when the winning team was already ahead', () => {
    const state=live();state.score={home:8,away:12};for(const p of state.home.players.slice(1))state.stats[p.id]!.fouls=5;
    expect(stepMatch(state).result?.officialScore).toEqual({home:8,away:12});
  });
  it('removes an excluded player at the final horn without asking for a post-game replacement', () => {
    const ended=transition(s=>{s.period=4;s.clockSeconds=1;s.score={home:10,away:2};for(const id of [...s.lineups.home,...s.lineups.away])s.stats[id]!.fouls=4;}, s=>s.status==='finished'&&s.events.some(e=>e.type==='foul-out'));
    expect(ended.result?.kind).toBe('normal');expect(ended.requiredSubstitutions).toHaveLength(0);
    for(const side of ['home','away'] as const)expect(ended.lineups[side].every(id=>isPlayerEligible(ended,id))).toBe(true);
  });
  it('allows the non-scoring team to request a timeout after a made basket and reciprocal late-game substitutions', () => {
    const state=live();state.period=4;state.clockSeconds=100;state.possession='home';state.stoppage={reason:'made-basket',substitutionSides:['home'],timeoutSides:['home']};
    expect(canSubstituteNow(state,'away')).toBe(false);
    const awayQueued=substitutePlayer(state,'away',state.lineups.away[0]!,state.away.players[5]!.id);
    const changed=substitutePlayer(awayQueued,'home',state.lineups.home[0]!,state.home.players[5]!.id);
    expect(changed.pendingSubstitutions.away).toHaveLength(0);expect(changed.lineups.away).toContain(state.away.players[5]!.id);
    expect(requestTimeout(changed,'away').timeoutUsage.away.secondHalf).toBe(1);
  });
});

describe('timeouts and match injury settings', () => {
  it('queues before tipoff and during live play, without spending an allowance or providing recovery', () => {
    const initial=fixture(), before=requestTimeout(initial,'home');expect(before.timeoutUsage.home.firstHalf).toBe(0);expect(before.timeoutRequested.home).toBe(true);
    const state=live();state.stats[state.lineups.home[0]!]!.condition=70;
    const queued=requestTimeout(state,'home');expect(queued.stats).toEqual(state.stats);expect(queued.clockSeconds).toBe(state.clockSeconds);expect(queued.rngState).toBe(state.rngState);
    expect(cancelTimeoutRequest(queued,'home').timeoutRequested.home).toBe(false);
    fullWindow(queued);const granted=stepMatch(queued);expect(granted.timeoutUsage.home.firstHalf).toBe(1);
  });
  it('uses separate half/overtime allowances and limits the last two minutes to two timeouts', () => {
    const state=fixture();expect(remainingTimeouts(state,'home')).toBe(2);state.timeoutUsage.home.firstHalf=2;expect(remainingTimeouts(state,'home')).toBe(0);
    state.period=3;expect(remainingTimeouts(state,'home')).toBe(3);state.period=4;state.clockSeconds=120;expect(remainingTimeouts(state,'home')).toBe(2);
    state.timeoutUsage.home.secondHalf=2;state.timeoutUsage.home.lateFourth=2;expect(remainingTimeouts(state,'home')).toBe(0);
    state.period=5;expect(remainingTimeouts(state,'home')).toBe(1);state.timeoutUsage.home.overtime=1;expect(remainingTimeouts(state,'home')).toBe(0);
  });
  it('holds a critical injury and assigns pending free throws to the mandatory replacement', () => {
    const state=live(),out=state.lineups.home[0]!,incoming=state.home.players[5]!.id;state.injuries[out]={kind:'ankle',occurredAtSeconds:20};state.freeThrows={side:'home',shooterId:out,total:2,remaining:2};state.phase='free-throws';fullWindow(state);state.phase='free-throws';
    const stopped=stepMatch(state);expect(stopped.requiredSubstitutions[0]?.reason).toBe('injured');
    const changed=substitutePlayer(stopped,'home',out,incoming);expect(changed.freeThrows?.shooterId).toBe(incoming);expect(changed.substitutionLocks).toContain(incoming);
    const after=stepMatch(changed);expect(after.stats[out]!.freeThrowsAttempted).toBe(0);expect(after.stats[incoming]!.freeThrowsAttempted).toBe(1);
  });
  it('persists a symmetric setting before tipoff and rejects mid-match injury-setting changes', () => {
    const state=setInjuryMode(createMatch(12),'reduced');expect(state.injuryMode).toBe('reduced');expect(state.rngState).toBe(createMatch(12).rngState);
    expect(()=>setInjuryMode(stepMatch(state),'off')).toThrow(/before tipoff/);
    const result=simulateToEnd(setAutoSubstitutions(fixture(12),'home',true));expect(result.injuries).toEqual({});
  });
});
