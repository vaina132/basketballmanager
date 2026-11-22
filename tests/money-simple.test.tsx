import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { staffAllocation, staffCommitted } from '../src/world/staff-policy';
import { availableScouts, quoteScoutHire } from '../src/world/scout-policy';
import { hireScout } from '../src/world/scouts';
import { usesWagePool, wagesLeft, wageRoomForStaff } from '../src/world/wage-pool';
import { getSpendableCash } from '../src/world/payroll';
import { getInSeasonBudget } from '../src/world/recruitment-policy';
import { enableInSeasonRecruitment, enableInSeasonTransfers, submitInSeasonTransferOffer } from '../src/world/recruitment';
import { quoteInSeasonTransferOffer } from '../src/world/midseason-transfer-policy';
import { MIN_TRANSFER_FEE } from '../src/world/transfers-policy';
import { MIN_CONTRACT_WAGE } from '../src/world/employment-policy';
import { getClubAcademy, quoteAcademyPromotion } from '../src/world/academy-policy';
import { offerAcademyPromotion } from '../src/world/academy';
import { startFacilityUpgrade } from '../src/world/facilities';
import { quoteFacilityUpgrade } from '../src/world/facilities-policy';
import { showsBudgetBar } from '../src/ui/navigation';
import { PayrollWorkspace } from '../src/ui/PayrollWorkspace';
import { ClubBudgetBar } from '../src/ui/ClubBudgetBar';
import { advanceMatchday } from './helpers/board-funding';

const manager = { name: 'Money Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };
const noop = () => {};
let pooled: SeasonState, split: SeasonState;

beforeAll(() => {
  pooled = createSeason({ seed: 31, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS });
  split = createSeason({ seed: 31, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS, wagePool: false });
}, 120_000);

describe('two budgets (owner feedback, 18 November 2026)', () => {
  it('starts new careers with one wage pool and keeps the save strict', () => {
    expect(usesWagePool(pooled)).toBe(true);
    expect(usesWagePool(split)).toBe(false);
    expect(parseSeason(serializeSeason(pooled))).toEqual(pooled);
  });

  it('lets a staff hire use unused player salary budget, and the hire draws from Wages left', () => {
    const club = pooled.managedClubId, staffRoom = staffAllocation(pooled, club) - staffCommitted(pooled, club);
    expect(wageRoomForStaff(pooled, club)).toBeGreaterThan(0);
    const affordable = availableScouts(pooled).map(scout => quoteScoutHire(pooled, scout.id)).filter(quote => quote.canHire).sort((a, b) => b.fee - a.fee);
    expect(affordable.length).toBeGreaterThan(0);
    const beyond = affordable.find(quote => quote.fee > staffRoom);
    expect(beyond).toBeDefined();
    expect(quoteScoutHire(split, beyond!.scoutId).canHire).toBe(false);
    const quote = beyond ?? affordable[0]!;
    const before = wagesLeft(pooled).amount, hired = hireScout(pooled, quote.scoutId);
    expect(wagesLeft(hired).amount).toBe(Math.max(0, before - quote.fee));
  });

  it('lets a player contract use unused staff budget, and the contract draws from Wages left', () => {
    const club = pooled.managedClubId, open = enableInSeasonRecruitment(pooled);
    expect(getInSeasonBudget(open, club).budget).toBeGreaterThan(getInSeasonBudget(enableInSeasonRecruitment(split), club).budget);
    const prospect = getClubAcademy(open).find(view => quoteAcademyPromotion(open, view.player.id, MIN_CONTRACT_WAGE).canOffer);
    expect(prospect).toBeDefined();
    const before = wagesLeft(open).amount, offered = offerAcademyPromotion(open, prospect!.player.id, MIN_CONTRACT_WAGE);
    expect(wagesLeft(offered).amount).toBe(Math.max(0, before - MIN_CONTRACT_WAGE));
  });

  it('reserves a transfer fee from Spending left and the wage from Wages left', () => {
    const open = enableInSeasonTransfers(enableInSeasonRecruitment(pooled)), club = open.managedClubId, wage = MIN_CONTRACT_WAGE * 2;
    const asking = (playerId: string) => quoteInSeasonTransferOffer(open, playerId, wage, 1, MIN_TRANSFER_FEE).requiredFee;
    const target = open.clubs.filter(team => team.id !== club).flatMap(team => team.players).find(player => quoteInSeasonTransferOffer(open, player.id, wage, 1, Math.max(MIN_TRANSFER_FEE, asking(player.id))).canOffer);
    expect(target).toBeDefined();
    const fee = Math.max(MIN_TRANSFER_FEE, asking(target!.id));
    const spending = getSpendableCash(open, club), wages = wagesLeft(open).amount, offered = submitInSeasonTransferOffer(open, target!.id, wage, 1, fee);
    expect(spending - getSpendableCash(offered, club)).toBeGreaterThanOrEqual(fee);
    expect(wagesLeft(offered).amount).toBe(Math.max(0, wages - wage));
  });

  it('pays a facility upgrade from Spending left and leaves Wages left alone', () => {
    const quote = quoteFacilityUpgrade(pooled, 'training');
    expect(quote.reason ?? null).toBeNull();
    const spending = getSpendableCash(pooled, pooled.managedClubId), wages = wagesLeft(pooled).amount, built = startFacilityUpgrade(pooled, 'training');
    expect(getSpendableCash(built, built.managedClubId)).toBe(spending - quote.cost);
    expect(wagesLeft(built).amount).toBe(wages);
  });

  it('shows the two labels on the budget bar', () => {
    const html = renderToStaticMarkup(<ClubBudgetBar season={pooled} onOpenClub={noop} onOpenStaff={noop} onOpenTransfers={noop} />);
    expect(html).toContain('Wages left');
    expect(html).toContain('Spending left');
    expect(html).not.toContain('Remaining staff budget');
    expect(html).not.toContain('Player salary budget');
  });

  it('shows the budget bar only where money is decided', () => {
    const pages = ['home', 'inbox', 'squad', 'match', 'season', 'training', 'staff', 'club', 'board', 'transfers', 'medical', 'academy', 'calendar', 'europe'] as const;
    expect(pages.filter(page => showsBudgetBar(page, 'selection'))).toEqual(['home', 'staff', 'club', 'transfers']);
    expect(showsBudgetBar('squad', 'contracts')).toBe(true);
    expect(showsBudgetBar('squad', 'payroll')).toBe(false);
  });

  it('pays wages automatically every week and shows no settlement columns', () => {
    const html = renderToStaticMarkup(<PayrollWorkspace season={pooled} onEnable={noop} onOpenClub={noop} onSelectPlayer={noop} />);
    for (const text of ['Settle now', 'Saving', 'Settle wages', 'Payment control']) expect(html).not.toContain(text);
    expect(html).toContain('paid automatically every week');
    const week = advanceMatchday(pooled);
    const paid = week.finance.ledger.filter(entry => entry.clubId === week.managedClubId && entry.kind === 'payroll');
    expect(paid.length).toBeGreaterThan(0);
  });
});
