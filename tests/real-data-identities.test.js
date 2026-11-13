import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv, readIdentities } from '../scripts/real-data-identities.mjs';

const header = 'api_sports_id,display_name,short_name,country,city,arena,primary_colour,primary_hex,secondary_colour,secondary_hex,confidence,notes';

describe('club identities file', () => {
  it('keeps the maintained file valid: unique ids and short names, real colour codes, a stated confidence', () => {
    const rows = readIdentities(readFileSync(new URL('../real-data/club-identities.csv', import.meta.url), 'utf8'));
    expect(rows.length).toBeGreaterThanOrEqual(39);
    expect(rows.find(row => row.api_sports_id === '1270')).toMatchObject({ display_name: 'Fenerbahçe', short_name: 'FEN', primary_colour: 'yellow' });
  });

  it('reads quoted fields with commas and refuses broken rows with the line number', () => {
    expect(parseCsv('a,"b, c",d\n')).toEqual([['a', 'b, c', 'd']]);
    expect(() => readIdentities(`${header}\n1,One,ONE,X,Y,Z,red,#ff0000,,,sure,\n2,Two,ONE,X,Y,Z,red,red,,,maybe,\n`)).toThrow(/line 3 \(Two\): short_name[\s\S]*primary_hex[\s\S]*confidence/);
  });
});
