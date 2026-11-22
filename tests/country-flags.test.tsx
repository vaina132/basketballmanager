import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { countryFlagCode, FLAG_CODES } from '../src/data/country-flags';
import { NATIONAL_TEAMS } from '../src/data/national-teams';
import { NAME_COUNTRIES } from '../src/data/people-names';
import { COACH_DIRECTORY, SCOUT_DIRECTORY, STAFF_POOL_COUNTRIES, staffNationality } from '../src/data/staff-directory';
import { flagUrl } from '../src/ui/flag-urls';
import { CountryFlag } from '../src/ui/CountryFlag';
import { FlagCredit } from '../src/ui/CreditsDialog';
import { managerCountries, ManagerFlags, Nationality, StaffNationality } from '../src/ui/Nationality';
import { NATIONALITY_SUGGESTIONS } from '../src/ui/nationality-suggestions';
import pack from './fixtures/pack-countries.json';
import nationalitySource from '../src/ui/Nationality.tsx?raw';
import flagSource from '../src/ui/CountryFlag.tsx?raw';

const REGIONAL_INDICATORS = /[\u{1F1E6}-\u{1F1FF}]/u;
const hasFlag = (country: string) => { const code = countryFlagCode(country); return !!code && !!flagUrl(code); };

/** Owner feedback (22 November 2026, evening): real flags for every country, never emoji or letter codes such as "HR". */
describe('real country flags', () => {
  it('has a flag for every nationality and club country in the published pack', () => {
    expect(pack.playerNationalities.length).toBeGreaterThan(70);
    expect(pack.playerNationalities.filter(country => !hasFlag(country))).toEqual([]);
    expect(pack.clubCountries.filter(country => !hasFlag(country))).toEqual([]);
    expect(pack.competitionCountries.filter(country => !hasFlag(country))).toEqual([]);
  });

  it('leaves club and city names from the nationality field blank', () => {
    for (const junk of pack.notCountries) {
      expect(countryFlagCode(junk)).toBeNull();
      expect(renderToStaticMarkup(<Nationality country={junk} />)).toBe('');
    }
    expect(renderToStaticMarkup(<CountryFlag country={null} />)).toBe('');
  });

  it('has a flag for every national team, staff country and manager suggestion', () => {
    expect(NATIONAL_TEAMS.map(team => team.country).filter(country => !hasFlag(country))).toEqual([]);
    expect([...NAME_COUNTRIES, ...STAFF_POOL_COUNTRIES].filter(country => !hasFlag(country))).toEqual([]);
    const staff = [...COACH_DIRECTORY, ...SCOUT_DIRECTORY].map(person => staffNationality(person.id)).filter((country): country is string => !!country);
    expect(staff.length).toBeGreaterThan(0);
    expect([...new Set(staff)].filter(country => !hasFlag(country))).toEqual([]);
    expect(NATIONALITY_SUGGESTIONS.map(item => item.place).filter(place => !hasFlag(place))).toEqual([]);
    // Every listed code has its picture in the flag set.
    expect(FLAG_CODES.filter(code => !flagUrl(code))).toEqual([]);
  });

  it('reads the usual spellings of the same country', () => {
    const cases: [string, string][] = [
      ['Türkiye', 'TR'], ['Turkey', 'TR'], ['turkiye', 'TR'], ['Bosnia and Herzegovina', 'BA'], ['Bosnia', 'BA'], ['Czechia', 'CZ'], ['Czech Republic', 'CZ'],
      ['North Macedonia', 'MK'], ["Côte d'Ivoire", 'CI'], ['Côte d’Ivoire', 'CI'], ['Ivory Coast', 'CI'], ['Congo DR', 'CD'], ['DR Congo', 'CD'],
      ['Republic of the Congo', 'CG'], ['USA', 'US'], ['United States', 'US'], ['Great Britain', 'GB'], ['United Kingdom', 'GB'], ['England', 'GB-ENG'],
      ['Scotland', 'GB-SCT'], ['Wales', 'GB-WLS'], ['Kosovo', 'XK'], [' Iceland ', 'IS'],
    ];
    for (const [name, code] of cases) expect([name, countryFlagCode(name)]).toEqual([name, code]);
  });

  it('draws Iceland, Bosnia, Serbia and Croatia as pictures, with no emoji or letter codes', () => {
    for (const [country, code] of [['Iceland', 'IS'], ['Bosnia and Herzegovina', 'BA'], ['Serbia', 'RS'], ['Croatia', 'HR']]) {
      const compact = renderToStaticMarkup(<Nationality country={country} compact />);
      expect(compact).toMatch(new RegExp(`<img class="country-flag" src="[^"]*${code}\\.svg"[^>]* alt="" aria-hidden="true"[^>]*data-flag="${code}"`));
      expect(compact).toContain(`<span class="sr-only">${country}</span>`);
      expect(compact).not.toMatch(REGIONAL_INDICATORS);
      expect(compact).not.toContain(`>${code}<`);
    }
    expect(renderToStaticMarkup(<CountryFlag country="Serbia" />)).toContain('alt="Serbia flag"');
    expect(nationalitySource + flagSource).not.toMatch(/fromCodePoint|nationality-emoji|0x1f1e6/i);
  });

  it('shows staff and manager flags', () => {
    const pooled = COACH_DIRECTORY.find(person => staffNationality(person.id) === 'Serbia');
    expect(pooled).toBeDefined();
    expect(renderToStaticMarkup(<StaffNationality personId={pooled!.id} />)).toContain('data-flag="RS"');
    expect(managerCountries('Spanish')).toEqual(['Spain']);
    expect(managerCountries('Spain')).toEqual(['Spain']);
    expect(managerCountries('Spanish / Italian')).toEqual(['Spain', 'Italy']);
    expect(managerCountries('Bosnian and Herzegovinian')).toEqual(['Bosnia and Herzegovina']);
    expect(managerCountries('Martian')).toEqual([]);
    expect(renderToStaticMarkup(<ManagerFlags nationality="Croatian" />)).toContain('data-flag="HR"');
  });

  it('credits the flag set and its licence', () => {
    const html = renderToStaticMarkup(<FlagCredit />);
    expect(html).toContain('country-flag-icons');
    expect(html).toContain('MIT License');
    expect(html).toContain('Copyright (c) 2020 @catamphetamine');
  });
});
