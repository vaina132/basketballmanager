import { describe, expect, it } from 'vitest';
import { displayName } from '../scripts/real-data-import.mjs';

describe('real-data importer', () => {
  it('turns the provider\'s "Surname Firstname" into a display name and keeps initials as they are', () => {
    expect(['Larkin Shane', 'Horton-Tucker Talen', 'De Colo Nando', 'Fernando Bruno', 'C. Silva', 'Madonna'].map(displayName))
      .toEqual(['Shane Larkin', 'Talen Horton-Tucker', 'Nando De Colo', 'Bruno Fernando', 'C. Silva', 'Madonna']);
  });
});
