import { describe, expect, it } from 'vitest';
import { ratingsFingerprint, snapshotChanges } from '../scripts/real-data-verify.mjs';

const rows = [
  { dataset_version_id: 'v1', player_id: 'a', two_point: 12, estimated: ['defense'], method: { rules: 'rating-1', seasons: ['X 2026-27'] } },
  { dataset_version_id: 'v1', player_id: 'b', two_point: 15, estimated: ['defense', 'height_cm'], method: { rules: 'rating-1', seasons: ['X 2025-26'] } },
];

describe('real-data update check', () => {
  it('fingerprints a version\'s ratings regardless of row and key order, and notices any changed value', () => {
    const reordered = [{ method: { seasons: ['X 2025-26'], rules: 'rating-1' }, estimated: ['defense', 'height_cm'], two_point: 15, player_id: 'b', dataset_version_id: 'v1' }, rows[0]];
    expect(ratingsFingerprint(reordered)).toBe(ratingsFingerprint(rows));
    expect(ratingsFingerprint([rows[0], { ...rows[1], two_point: 16 }])).not.toBe(ratingsFingerprint(rows));
  });

  it('reports any change to a version that was already published, and accepts new versions', () => {
    const before = { versions: { v1: { status: 'published', checksum: 'c1', ratings: 'r1', ratingRows: 2 } } };
    const after = { versions: { ...before.versions, v2: { status: 'published', checksum: 'c2', ratings: 'r2', ratingRows: 3 } } };
    expect(snapshotChanges(before, after)).toEqual([]);
    expect(snapshotChanges(before, { versions: { v1: { ...before.versions.v1, ratings: 'r9' } } })).toEqual(['v1: ratings changed']);
    expect(snapshotChanges(before, { versions: { v1: { ...before.versions.v1, status: 'draft', checksum: null } } })).toEqual(['v1: status changed', 'v1: checksum changed']);
    expect(snapshotChanges(before, { versions: {} })).toEqual(['v1 disappeared']);
  });
});
