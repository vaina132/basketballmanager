import { financeLedgerCount } from './finance-ledger';
import type { FacilityAnchor, FacilityEvent, FacilityProject, FacilityType, MaintenancePlan, SeasonFacilities } from '../domain/facilities';
import type { SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import { clubFinanceDefinition, worldOf } from './career-world';
import { facilityAutomationBuffer, facilityTypes, FACILITY_RULES_2, getActiveFacilityProject, getFacilityCondition, getFacilityLevel, hasFacilityCondition, maintenancePlanOn, quoteFacilityRepair, quoteFacilityUpgrade, usesFacilityRepairs } from './facilities-policy';
import { getSpendableCash, getSpendablePosition } from './payroll-policy';
import { getFinanceBalance, recordBoardCapital, recordFacilityInvestment } from './finance';
import { quoteBoardFunding, type BoardFundingQuote } from './board-funding-policy';

/** New careers use `facilities-2` (format 65); older careers keep `facilities-1` and its three facilities. */
export function createFacilities(clubs: readonly Pick<Team, 'id'>[] = [], managedClubId = '', model: SeasonFacilities['model'] = 'facilities-2'): SeasonFacilities {
  return { model, enabledSince: null, delegated: Object.fromEntries(clubs.map(club => [club.id, club.id !== managedClubId])), projects: [], events: [], fundingSince: null, maintenanceSince: null };
}

export function facilityEventAnchor(state: SeasonState): FacilityAnchor {
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, ledgerIndex: financeLedgerCount(state.finance), contractCount: state.employment.contracts.length, negotiationCount: state.negotiations.records.length, recruitmentEventCount: state.recruitment.events.length, marketEventCount: state.market.windows.reduce((count, window) => count + window.events.length, 0) };
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
    if (event.type === 'start' || event.type === 'repair') {
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
  // Activation preserves the price and capacity of the already prepared matchday; the career keeps its facilities model.
  const facilities: SeasonFacilities = { ...createFacilities(state.clubs, state.managedClubId, state.facilities.model), enabledSince: facilityEventAnchor(state) };
  const next = { ...state, facilities, finance: { ...state.finance, roundCapacities: Object.fromEntries(state.clubs.map(club => [club.id, clubFinanceDefinition(worldOf(state), club.id).capacity])) } };
  return automateFacilities(next);
}

/** Replayable approvals; starting construction or a repair pays once and never changes sporting state. */
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
  if (event.type === 'repair') {
    const quote = quoteFacilityRepair(state, event.facilityType, event.clubId);
    if (!quote.canStart) throw new Error(quote.reason!);
    if (event.projectId !== `facility-project-${state.facilities.projects.length + 1}`) throw new Error('Facility project identity must be sequential.');
    const project: FacilityProject = { id: event.projectId, clubId: event.clubId, type: event.facilityType, fromLevel: quote.level, toLevel: quote.level, cost: quote.cost, startedOn: state.date, dueOn: quote.dueOn, completedOn: null, cancelledOn: null, startEventIndex: state.facilities.events.length, kind: 'repair', conditionBefore: quote.conditionBefore };
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
    if (Object.hasOwn(event, 'project') && (event.project !== 'repair' || !usesFacilityRepairs(state.facilities))) throw new Error('Board capital funds an upgrade, or a repair in the current facilities model.');
    const quote = quoteBoardFunding(state, event.facilityType, event.clubId, event.mode, event.project ?? 'upgrade');
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

/** `facilities-2`: commission a repair that restores the facility's condition to 100 when it completes. */
export function startFacilityRepair(state: SeasonState, type: FacilityType, clubId = state.managedClubId): SeasonState {
  return applyFacilityEvent(state, { ...facilityEventAnchor(state), type: 'repair', projectId: `facility-project-${state.facilities.projects.length + 1}`, clubId, facilityType: type });
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

const fundingDecision = (quote: BoardFundingQuote) => ({ type: 'funding' as const, clubId: quote.clubId, facilityType: quote.facilityType, amount: quote.amount, mode: quote.mode, approved: quote.approved, confidence: quote.confidence, requiredConfidence: quote.requiredConfidence, capitalRemaining: quote.capitalRemaining, ...(quote.project === 'repair' ? { project: 'repair' as const } : {}) });

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

/** The manager asks the board to fund what the club cannot; an approval starts the upgrade (or `facilities-2` repair) at once. */
export function requestBoardFunding(state: SeasonState, type: FacilityType, project: 'upgrade' | 'repair' = 'upgrade'): SeasonState {
  const quote = quoteBoardFunding(state, type, state.managedClubId, 'manager', project);
  if (!quote.eligible) throw new Error(quote.reason!);
  const decided = applyFacilityEvent(state, { ...facilityEventAnchor(state), ...fundingDecision(quote) });
  if (!quote.approved) return decided;
  return project === 'repair' ? startFacilityRepair(decided, type) : startFacilityUpgrade(decided, type);
}

/**
 * `facilities-2`: the most worn facility below the automatic repair threshold that has a condition to restore.
 * Automatic control repairs it before any upgrade, keeping half its cash cushion, or asks the board when its rules
 * approve; while it cannot, the club waits rather than spending on upgrades.
 */
function automateRepair(state: SeasonState, clubId: string): { state: SeasonState; waiting: boolean } {
  // Conditions are cheap to read; only the chosen facility is quoted.
  const worn = facilityTypes(state.facilities).filter(type => hasFacilityCondition(state, type, clubId)).map(type => ({ type, condition: getFacilityCondition(state, type, clubId) })).filter(item => item.condition < FACILITY_RULES_2.automaticRepairBelow);
  const most = worn.reduce<typeof worn[number] | null>((best, item) => !best || item.condition < best.condition ? item : best, null);
  if (!most) return { state, waiting: false };
  const needed = quoteFacilityRepair(state, most.type, clubId);
  if (needed.canStart && needed.remainingBudgetAfter >= facilityAutomationBuffer(state, clubId) / 2) return { state: startFacilityRepair(state, needed.type, clubId), waiting: false };
  if (state.facilities.fundingSince) {
    const funded = quoteBoardFunding(state, needed.type, clubId, 'automatic', 'repair');
    if (funded.approved) return { state: startFacilityRepair(applyFacilityEvent(state, { ...facilityEventAnchor(state), ...fundingDecision(funded) }), needed.type, clubId), waiting: false };
  }
  return { state, waiting: true };
}

/**
 * The same funded quote applies to all clubs; automation preserves a conservative extra cash cushion. When no
 * upgrade is affordable with that cushion, automatic control asks the board only if its rules would approve.
 * `facilities-2` careers repair a worn facility first.
 */
export function automateFacilities(state: SeasonState): SeasonState {
  if (!state.facilities.enabledSince) return state;
  let next = state;
  const types = facilityTypes(state.facilities);
  for (const club of state.clubs) {
    if (!next.facilities.delegated[club.id]) continue;
    // Automatic upkeep, only with upgrades to maintain: reduce when commitments exceed cash or costs are unpaid,
    // restore once half the automation cushion is spendable again.
    if (next.facilities.maintenanceSince && types.some(type => getFacilityLevel(next, type, club.id) > 1)) {
      const current = maintenancePlanOn(next.facilities, club.id);
      const tight = getSpendablePosition(next, club.id) < 0 || getFinanceBalance(next.finance, club.id).unpaid > 0;
      const plan: MaintenancePlan = current === 'full' ? tight ? 'reduced' : 'full' : !tight && getSpendableCash(next, club.id) >= facilityAutomationBuffer(next, club.id) / 2 ? 'full' : 'reduced';
      if (plan !== current) next = applyFacilityEvent(next, { ...facilityEventAnchor(next), type: 'maintenance', clubId: club.id, plan });
    }
    if (getActiveFacilityProject(next, club.id)) continue;
    if (usesFacilityRepairs(next.facilities)) {
      const repaired = automateRepair(next, club.id);
      if (repaired.state !== next || repaired.waiting) { next = repaired.state; continue; }
    }
    const quote = types.map(type => quoteFacilityUpgrade(next, type, club.id)).filter(quote => quote.canStart && quote.remainingBudgetAfter >= facilityAutomationBuffer(next, club.id)).sort((left, right) => left.cost - right.cost || types.indexOf(left.type) - types.indexOf(right.type))[0];
    if (quote) next = startFacilityUpgrade(next, quote.type, club.id);
    else if (next.facilities.fundingSince) {
      const funded = types.map(type => quoteBoardFunding(next, type, club.id, 'automatic')).filter(item => item.approved).sort((left, right) => left.cost - right.cost || types.indexOf(left.facilityType) - types.indexOf(right.facilityType))[0];
      if (funded) next = startFacilityUpgrade(applyFacilityEvent(next, { ...facilityEventAnchor(next), ...fundingDecision(funded) }), funded.facilityType, club.id);
    }
  }
  return next;
}
