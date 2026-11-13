import type { CareerWorld } from '../domain/world';
import { DEVELOPMENT_FINANCES } from './development-finances';
import { DEVELOPMENT_CLUBS, DEVELOPMENT_DATA_PACK_ID, DEVELOPMENT_START_DATE } from './development-league';
import { DEVELOPMENT_PLAYER_PROFILES } from './development-player-profiles';
import { DEVELOPMENT_PRESIDENTS } from './development-presidents';
import { DEVELOPMENT_RIVALRIES } from './development-rivalries';
import { DEVELOPMENT_SPONSORS } from './development-sponsors';
import { DEVELOPMENT_WAGES } from './development-wages';

/** The built-in fictional six-club league as a world. Careers in it never store the world in their saves. */
export const DEVELOPMENT_WORLD: CareerWorld = Object.freeze({
  id: DEVELOPMENT_DATA_PACK_ID,
  name: 'Development league',
  source: 'fictional-development',
  startDate: DEVELOPMENT_START_DATE,
  clubs: DEVELOPMENT_CLUBS,
  playerProfiles: DEVELOPMENT_PLAYER_PROFILES,
  wages: DEVELOPMENT_WAGES,
  finances: DEVELOPMENT_FINANCES,
  presidents: DEVELOPMENT_PRESIDENTS,
  sponsors: DEVELOPMENT_SPONSORS,
  rivalries: DEVELOPMENT_RIVALRIES,
});
