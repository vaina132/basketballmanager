import type { FacilityAnchor, FacilityEvent, FacilityProject, FacilityType, MaintenancePlan, SeasonFacilities } from '../domain/facilities';
import type { SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import { getClubFinanceDefinition } from '../data/development-finances';
import { FACILITY_AUTOMATION_BUFFER, FACILITY_TYPES, getActiveFacilityProject, getFacilityLevel, maintenancePlanOn, quoteFacilityUpgrade } from './facilities-policy';
import { getSpendableCash, getSpendablePosition } from './payroll-policy';
import { getFinanceBalance, recordBoardCapital, recordFacilityInvestment } from './finance';
import { quoteBoardFunding, type BoardFundingQuote } from './board-funding-policy';

export function createFacilities(clubs: readonly Pick<Team, 'id'>[] = [], managedClubId = ''): SeasonFacilities {
  return { model: 'facilities-1', enabledSince: null, delegated: Object.fromEntries(clubs.map(club => [club.id, club.id !== managedClubId])), projects: [], events: [], fundingSince: null, maintenanceSince: null };
}

export function facilityEventAnchor(state: SeasonState): FacilityAnchor {
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, ledgerIndex: state.finance.ledger.length, contractCount: state.employment.contracts.length, negotiationCount: state.negotiations.records.length, recruitmentEventCount: state.recruitment.events.length, marketEventCount: state.market.windows.reduce((count, window) => count + window.events.length, 0) };
}

/**
 * Historical command replay must not see later same-day cancellations, completions or delegation. `managedClubId` is
 * the club managed at activation; control changes after a move are journaled as delegate events.
 */
export function facilitiesAtEventCount(facilities: SeasonFacilities, eventCount: number, managedClubId: string): SeasonFacilities {
  if (!Number.isInteger(eventCount) || eventCount < 0 || eventCount > facilities.events.length) throw new Error('Choose an existing facilities event prefix.');
  const events = facilities.events.slice(0, eventCount);
  let projects: FacilityProject[] = [];
  const delegated = Object.fromEntries(Object.keys(facilities.delegated).map(clubId => [clubId, clubId !== managedClubId]));
  for (const event of events) {
    if (event.type === 'start') {
      const stored = facilities.projects.find(project => project.id === event.projectId);
      if (!stored) throw new Error('A construction approval must retain its project terms.');
      projects.push({ ...stored, completedOn: null, cancelledOn: null });
    } else if (event.type === 'cancel') projects = projects.map(project => project.id === event.projectId ? { ...project, cancelledOn: event.date } : project);
    else if (event.type === 'delegate') delegated[event.clubId] = event.delegated;
    else if (event.type === 'process') projects = projects.map(project => project.completedOn === null && project.cancelledOn === null && project.dueOn <= event.date ? { ...project, completedOn: event.date } : project);
  }
  return { ...facilities, delegated, projects, events };
}

export function enableFacilities(state: SeasonState): SeasonState {
  if (state.facilities.enabledSince) return state;
  if (!state.finance.enabledSince) throw new Error('Enable club finances before managing facilities.');
  // Activation preserves the price and capacity of the already prepared matchday.
  const facilities: SeasonFacilities = { ...createFacilities(state.clubs, state.managedClubId), enabledSince: facilityEventAnchor(state) };
  const next = { ...state, facilities, finance: { ...state.finance, roundCapacities: Object.fromEntries(state.clubs.map(club => [club.id, getClubFinanceDefinition(club.id).capacity])) } };
  return automateFacilities(next);
}

/** Replayable approvals; starting construction pays once and never changes sporting state. */
export function applyFacilityEvent(state: SeasonState, event: FacilityEvent): SeasonState {
  if (!state.facilities.enabledSince || !state.finance.enabledSince) throw new Error('Enable club facilities and finances before making a facilities decision.');
  const anchor = facilityEventAnchor(state);
  for (const key of Object.keys(anchor) as (keyof FacilityAnchor)[]) if (event[key] !== anchor[key]) throw new Error('Retain the exact calendar and commitment history for each facilities decision.');
  const events = [...state.facilities.events, { ...event }];
  if (event.type === 'start') {
    const quote = quoteFacilityUpgrade(state, event.facilityType, event.clubId);
    if (!quote.canStart) throw new Error(quote.reason!);
    if (event.projectId !== `facility-project-${state.facilities.projects.length + 1}`) throw new Error('Facility project identity must be sequential.');
    const project: FacilityProject = { id: event.projectId, clubId: event.clubId, type: event.facilityType, fromLevel: quote.fromLevel, toLevel: quote.toLevel, cost: quote.cost, startedOn: state.date, dueOn: quote.dueOn, completedOn: null, cancelledOn: null, startEventIndex: state.facilities.events.length };
    return recordFacilityInvestment({ ...state, facilities: { ...state.facilities, projects: [...state.facilities.projects, project], events } }, project);
  }
  if (event.type === 'cancel') {
    const project = state.facilities.projects.find(project => project.id === event.projectId);
    if (!project || project.completedOn !== null || project.cancelledOn !== null) throw new Error('Choose a project still under construction.');
    return { ...state, facilities: { ...state.facilities, events, projects: state.facilities.projects.map(item => item.id === project.id ? { ...item, cancelledOn: state.date } : item) } };
  }
  if (event.type === 'delegate') {
    if (!state.clubs.some(club => club.id === event.clubId) || typeof event.delegated !== 'boolean') throw new Error('Choose a club and a manual or automatic facilities policy.');
    if (state.facilities.delegated[event.clubId] === event.delegated) throw new Error('This facilities policy is already selected.');
    return { ...state, facilities: { ...state.facilities, events, delegated: { ...state.facilities.delegated, [event.clubId]: event.delegated } } };
  }
  if (event.type === 'funding') {
    const quote = quoteBoardFunding(state, event.facilityType, event.clubId, event.mode);
    if (!quote.eligible) throw new Error(quote.reason!);
    if (event.amount !== quote.amount || event.approved !== quote.approved || event.confidence !== quote.confidence || event.requiredConfidence !== quote.requiredConfidence || event.capitalRemaining !== quote.capitalRemaining) throw new Error('Record the board decision exactly as the board rules give it.');
    if (event.mode === 'automatic' && !event.approved) throw new Error('Automatic control asks the board only when the rules allow the capital.');
    const decided = { ...state, facilities: { ...state.facilities, events } };
    return event.approved ? recordBoardCapital(decided, `facility-project-${state.facilities.projects.length + 1}`) : decided;
  }
  if (event.type === 'maintenance') {
    if (!state.facilities.maintenanceSince) throw new Error('Enable facility maintenance choices first.');
    if (!state.clubs.some(club => club.id === event.clubId) || !['full', 'reduced'].includes(event.plan)) throw new Error('Choose a club and a full or reduced upkeep plan.');
    if (maintenancePlanOn(state.facilities, event.clubId) === event.plan) throw new Error('This upkeep plan is already selected.');
    return { ...state, facilities: { ...state.facilities, events } };
  }
  if (event.type !== 'process') throw new Error('Choose a supported facilities command.');
  const due = state.facilities.projects.filter(project => project.completedOn === null && project.cancelledOn === null && project.dueOn <= state.date);
  if (!due.length) throw new Error('There are no construction projects ready to complete at this calendar boundary.');
  return { ...state, facilities: { ...state.facilities, events, projects: state.facilities.projects.map(project => due.some(item => item.id === project.id) ? { ...project, completedOn: state.date } : project) } };
}

export function startFacilityUpgrade(state: SeasonState, type: FacilityType, clubId = state.managedClubId): SeasonState {
  return applyFacilityEvent(state, { ...facilityEventAnchor(state), type: 'start', projectId: `facility-project-${state.facilities.projects.length + 1}`, clubId, facilityType: type });
}

export function cancelFacilityUpgrade(state: SeasonState, projectId: string): SeasonState {
  if (!state.facilities.projects.some(project => project.id === projectId && project.clubId === state.managedClubId)) throw new Error('Choose a construction project at your club.');
  return applyFacilityEvent(state, { ...facilityEventAnchor(state), type: 'cancel', projectId });
}

export function setFacilityDelegation(state: SeasonState, delegated: boolean): SeasonState {
  if (typeof delegated !== 'boolean') throw new Error('Choose manual or automatic facilities management.');
  if (!state.facilities.enabledSince) throw new Error('Enable club facilities before delegating construction.');
  if (state.facilities.delegated[state.managedClubId] === delegated) return state;
  const next = applyFacilityEvent(state, { ...facilityEventAnchor(state), type: 'delegate', clubId: state.managedClubId, delegated });
  return delegated ? automateFacilities(next) : next;
}

/** Real calendar advancement owns completion; due dates alone never award a building. */
export function processFacilityProjects(state: SeasonState): SeasonState {
  if (!state.facilities.enabledSince || !state.facilities.projects.some(project => project.completedOn === null && project.cancelledOn === null && project.dueOn <= state.date)) return state;
  return applyFacilityEvent(state, { ...facilityEventAnchor(state), type: 'process' });
}

const fundingDecision = (quote: BoardFundingQuote) => ({ type: 'funding' as const, clubId: quote.clubId, facilityType: quote.facilityType, amount: quote.amount, mode: quote.mode, approved: quote.approved, confidence: quote.confidence, requiredConfidence: quote.requiredConfidence, capitalRemaining: quote.capitalRemaining });

/** Older careers opt in; condition only changes at matchdays after this point, and full upkeep stays the default. */
export function enableFacilityMaintenance(state: SeasonState): SeasonState {
  if (state.facilities.maintenanceSince) return state;
  if (!state.facilities.enabledSince) throw new Error('Enable club facilities before choosing upkeep plans.');
  return automateFacilities({ ...state, facilities: { ...state.facilities, maintenanceSince: facilityEventAnchor(state) } });
}

/** The manager's upkeep plan; it applies from the next matchday. */
export function setMaintenancePlan(state: SeasonState, plan: MaintenancePlan): SeasonState {
  return applyFacilityEvent(state, { ...facilityEventAnchor(state), type: 'maintenance', clubId: state.managedClubId, plan });
}

/** Older careers opt in; new careers enable funding with facilities and board reviews. */
export function enableBoardFunding(state: SeasonState): SeasonState {
  if (state.facilities.fundingSince) return state;
  if (!state.facilities.enabledSince) throw new Error('Enable club facilities before asking the board for capital.');
  if (!state.board.enabledSince) throw new Error('Enable board reviews before asking the board for capital.');
  return automateFacilities({ ...state, facilities: { ...state.facilities, fundingSince: facilityEventAnchor(state) } });
}

/** The manager asks the board to fund what the club cannot; an approval starts the upgrade at once. */
export function requestBoardFunding(state: SeasonState, type: FacilityType): SeasonState {
  const quote = quoteBoardFunding(state, type, state.managedClubId, 'manager');
  if (!quote.eligible) throw new Error(quote.reason!);
  const decided = applyFacilityEvent(state, { ...facilityEventAnchor(state), ...fundingDecision(quote) });
  return quote.approved ? startFacilityUpgrade(decided, type) : decided;
}

/**
 * The same funded quote applies to all clubs; automation preserves a conservative extra cash cushion. When no
 * upgrade is affordable with that cushion, automatic control asks the board only if its rules would approve.
 */
export function automateFacilities(state: SeasonState): SeasonState {
  if (!state.facilities.enabledSince) return state;
  let next = state;
  for (const club of state.clubs) {
    if (!next.facilities.delegated[club.id]) continue;
    // Automatic upkeep, only with upgrades to maintain: reduce when commitments exceed cash or costs are unpaid,
    // restore once half the automation cushion is spendable again.
    if (next.facilities.maintenanceSince && FACILITY_TYPES.some(type => getFacilityLevel(next, type, club.id) > 1)) {
      const current = maintenancePlanOn(next.facilities, club.id);
      const tight = getSpendablePosition(next, club.id) < 0 || getFinanceBalance(next.finance, club.id).unpaid > 0;
      const plan: MaintenancePlan = current === 'full' ? tight ? 'reduced' : 'full' : !tight && getSpendableCash(next, club.id) >= FACILITY_AUTOMATION_BUFFER / 2 ? 'full' : 'reduced';
      if (plan !== current) next = applyFacilityEvent(next, { ...facilityEventAnchor(next), type: 'maintenance', clubId: club.id, plan });
    }
    if (getActiveFacilityProject(next, club.id)) continue;
    const quote = FACILITY_TYPES.map(type => quoteFacilityUpgrade(next, type, club.id)).filter(quote => quote.canStart && quote.remainingBudgetAfter >= FACILITY_AUTOMATION_BUFFER).sort((left, right) => left.cost - right.cost || FACILITY_TYPES.indexOf(left.type) - FACILITY_TYPES.indexOf(right.type))[0];
    if (quote) next = startFacilityUpgrade(next, quote.type, club.id);
    else if (next.facilities.fundingSince) {
      const funded = FACILITY_TYPES.map(type => quoteBoardFunding(next, type, club.id, 'automatic')).filter(item => item.approved).sort((left, right) => left.cost - right.cost || FACILITY_TYPES.indexOf(left.facilityType) - FACILITY_TYPES.indexOf(right.facilityType))[0];
      if (funded) next = startFacilityUpgrade(applyFacilityEvent(next, { ...facilityEventAnchor(next), ...fundingDecision(funded) }), funded.facilityType, club.id);
    }
  }
  return next;
}
