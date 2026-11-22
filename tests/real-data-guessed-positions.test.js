import { describe, expect, it } from 'vitest';
import { articleOptions, buildBatch, decide, fibaTeamPlayers, infoboxPosition, storedState, wikidataOptions } from '../scripts/real-data-guessed-positions.mjs';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hit = (label, options, extra = {}) => ({ official: true, sourceName: 'lnb.fr', sources: ['https://lnb.fr/fr/teams/details?tid=1'], label, options, group: null, match: 'exact-name-and-club', ...extra });
const item = (extra = {}) => ({ id: `player-${uuid(1)}`, uuid: uuid(1), name: 'Ali Example', club: 'Club', league: 'LNB Élite', minutes: 300, position: 'SF', group0: null, dbRow: null, hits: [], ...extra });

describe('reading position labels', () => {
  it('reads infobox labels in several languages and refuses unknown words', () => {
    expect(articleOptions('Playmaker')).toEqual(['PG']);
    expect(articleOptions('Guardia tiratrice / ala piccola')).toEqual(['SG', 'SF']);
    expect(articleOptions('Ailier fort')).toEqual(['PF']);
    expect(articleOptions('Pivot (basket-ball)')).toEqual(['C']);
    expect(articleOptions('Oyun kurucu')).toEqual(['PG']);
    expect(articleOptions('Point guard / shooting guard')).toEqual(['PG', 'SG']);
    expect(articleOptions('Allenatore')).toBeNull();
    expect(infoboxPosition('{{Sportivo\n|Ruolo = [[Playmaker]]<ref>x</ref>\n}}', 'it')).toBe('Playmaker');
    expect(wikidataOptions(['Q1'], { Q1: 'point guard' })).toEqual(['PG']);
    expect(wikidataOptions(['Q1', 'Q2'], { Q1: 'shooting guard', Q2: 'small forward' })).toEqual(['SG', 'SF']);
    expect(wikidataOptions(['Q3'], { Q3: 'goalkeeper' })).toBeNull();
  });

  it('reads FIBA team pages, final rosters only', () => {
    const html = '{"firstName":"Ana","lastName":"One","clubName":"X","uniformNumber":"7","position":"Point Guard","heightInCm":190,"dateOfBirth":"2000-01-02T00:00:00","isOnFinalRoster":true}'
      + '{"firstName":"Bo","lastName":"Two","clubName":"X","position":"Center","isOnFinalRoster":false}';
    expect(fibaTeamPlayers(html)).toEqual([{ name: 'Ana One', number: 7, position: 'Point Guard', birthDate: '2000-01-02', heightCm: 190 }]);
  });
});

describe('deciding a guessed position', () => {
  it('takes an official exact label, or narrows a two-position label by the stored role', () => {
    expect(decide(item({ hits: [hit('3', ['SF'])] }), [])).toMatchObject({ kind: 'official', position: 'SF', method: 'official-roster-exact' });
    expect(decide(item({ group0: 'Guard', hits: [hit('2/3', ['SG', 'SF'])] }), [])).toMatchObject({ kind: 'official', position: 'SG', method: 'official-roster-narrowed-by-role' });
  });

  it('uses reported sources only inside what official pages allow, and only when they agree', () => {
    const wiki = (label, options) => ({ source: 'en.wikipedia.org', url: 'https://en.wikipedia.org/wiki/A', label, options, match: 'same-name-and-birth-date' });
    expect(decide(item({ hits: [hit('Guardia/Ala', ['SG', 'SF'])] }), [wiki('Shooting guard', ['SG'])])).toMatchObject({ kind: 'reported', position: 'SG' });
    expect(decide(item({ group0: 'Forward' }), [wiki('Shooting guard', ['SG'])])).toBeNull();
    expect(decide(item(), [wiki('Point guard', ['PG']), wiki('Shooting guard', ['SG'])])).toMatchObject({ kind: 'conflict' });
    expect(decide(item({ group0: 'Guard' }), [wiki('GF', ['SG', 'SF'])])).toMatchObject({ kind: 'reported', position: 'SG' });
  });

  it('narrows to a broad group from an official page when no group is stored', () => {
    expect(decide(item({ hits: [hit('PG/SG', ['PG', 'SG'], { group: 'Guard' })] }), [])).toMatchObject({ kind: 'group', group: 'Guard' });
    expect(decide(item({ group0: 'Guard', hits: [hit('PG/SG', ['PG', 'SG'], { group: 'Guard' })] }), [])).toBeNull();
  });
});

describe('the batch', () => {
  const added = { id: 'player-n000000000000000000000001', name: 'New One', number: 4, position: 'SG', positionSource: 'estimated', nationality: null, age: null, heightCm: 190, weightKg: 85, attributes: {}, estimated: ['all-abilities', 'game_position'] };
  const state = { position: {}, added_players: { [uuid(9)]: { reason: 'One current player.', value: { value: [added], sources: ['https://example.org/roster'], observedOn: '2026-11-18', batch: 'old' } } } };

  it('writes player rows and rewrites a club row changing only the added player\'s position', () => {
    const evidence = [item({ hits: [hit('5', ['C'])] }), item({ id: added.id, uuid: null, name: 'New One', hits: [hit('1', ['PG'])] })];
    const { batch, review } = buildBatch({ evidence, state, wikidata: { positionLabels: {}, people: [] }, articles: [], batch: 'test', observedOn: '2026-11-22' });
    expect(batch.rows).toHaveLength(2);
    expect(batch.rows[0]).toMatchObject({ entity_type: 'player', entity_id: uuid(1), field: 'position', value: { value: 'C', group: 'Center', method: 'official-roster-exact' } });
    const club = batch.rows[1];
    expect(club).toMatchObject({ entity_type: 'club', entity_id: uuid(9), field: 'added_players' });
    expect(club.value.value[0]).toEqual({ ...added, position: 'PG', positionSource: 'official', estimated: ['all-abilities'] });
    expect(review.counts['LNB Élite']).toMatchObject({ guessed: 2, official: 2, still: 0 });
  });

  it('rebuilds the stored rows in upload order and checks the added players against the pack', () => {
    const row = (field, value) => ({ entity_type: field === 'added_players' ? 'club' : 'player', entity_id: field === 'added_players' ? uuid(9) : uuid(1), field, value });
    const pack = { players: [{ id: added.id, clubId: `club-${uuid(9)}` }] };
    const result = storedState([[row('position', { value: 'PG' })], { rows: [row('position', { value: null, group: 'Guard' }), row('added_players', { value: [added] })] }], pack);
    expect(result.position[uuid(1)].value).toEqual({ value: null, group: 'Guard' });
    expect(result.mismatched).toEqual([]);
    expect(storedState([], pack).mismatched).toEqual([uuid(9)]);
  });
});
