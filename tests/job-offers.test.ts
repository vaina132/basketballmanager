import { describe, expect, it } from 'vitest';
import { isReserveTeam, offersFor, type ClubVacancy } from '../src/world/career-policy';
import { CAREER_RULES } from '../src/world/career-rules';

const clubs = [
  'Real Madrid', 'FC Barcelona', 'Valencia Basket', 'Baskonia', 'Unicaja', 'Fenerbahçe', 'Fenerbahçe II', 'Anadolu Efes',
  'Estudiantes', 'Fuenlabrada', 'Bilbao Basket', 'Zamora', 'Real Madrid B',
].map(name => ({ id: name.toLowerCase().replace(/\W+/gu, '-'), name }));
const id = (name: string) => clubs.find(club => club.name === name)!.id;
const second = new Set(['Estudiantes', 'Fuenlabrada', 'Zamora', 'Fenerbahçe II'].map(id));
const level = (clubId: string) => second.has(clubId) ? 2 : 1;
const vacancy = (name: string, requirement: number): ClubVacancy => ({ clubId: id(name), position: 1, requirement, reason: 'pressure', confidence: 25 });

describe('job offers (browser play-through, 16 November 2026: 24 offers, a reserve team among them)', () => {
  it('never come from a reserve or B team', () => {
    expect(isReserveTeam({ name: 'Fenerbahçe II' })).toBe(true);
    expect(isReserveTeam({ name: 'Real Madrid B' })).toBe(true);
    expect(isReserveTeam({ name: 'Real Madrid' })).toBe(false);
    expect(isReserveTeam({ name: 'Basketball Löwen Braunschweig' })).toBe(false);
  });

  it('come from at most a handful of the best fits: top division first, then the requirement', () => {
    const vacancies = [vacancy('Fenerbahçe II', 79), vacancy('Estudiantes', 79), vacancy('Zamora', 73), vacancy('Valencia Basket', 55), vacancy('Baskonia', 61), vacancy('Unicaja', 43),
      vacancy('Anadolu Efes', 67), vacancy('Bilbao Basket', 31), vacancy('Real Madrid B', 70), vacancy('Fuenlabrada', 25), vacancy('FC Barcelona', 85)];
    const offers = offersFor(vacancies, 80, false, clubs, level);
    expect(CAREER_RULES.maxJobOffers).toBe(5);
    expect(offers.map(item => clubs.find(club => club.id === item.clubId)!.name)).toEqual(['Anadolu Efes', 'Baskonia', 'Valencia Basket', 'Unicaja', 'Bilbao Basket']);
    // A modest reputation still gets its best fits, and a dismissed manager below every requirement the least demanding real club.
    expect(offersFor(vacancies, 44, false, clubs, level).map(item => item.clubId)).toEqual([id('Unicaja'), id('Bilbao Basket'), id('Fuenlabrada')]);
    expect(offersFor([vacancy('Fenerbahçe II', 25), vacancy('Zamora', 61)], 20, true, clubs, level).map(item => item.clubId)).toEqual([id('Zamora')]);
    expect(offersFor([vacancy('Fenerbahçe II', 25)], 90, true, clubs, level)).toEqual([]);
  });
});
