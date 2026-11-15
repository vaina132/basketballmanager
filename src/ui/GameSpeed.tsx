/**
 * Game speed and save size for a chosen set of leagues (step 3.6, owner request 15 November 2026). Only clubs played
 * in full every week count; European-only clubs and the next divisions play few or no simulated games.
 *
 * Measured with the online real-club pack and every management system on (cloud test machine, 15 November 2026),
 * European competitions included:
 * - Germany's top division, 18 clubs: 92 s a season, save 4.6 MiB after the first season;
 * - Spain's two divisions, 36 clubs: 247 s, 7.5 MiB;
 * - Spain and Germany, 54 clubs: 10.6 MiB (its time was taken on a busy machine and is not used).
 * Time follows about clubs^1.42 between the clean runs. The owner's laptop took 129 s for 18 clubs without Europe,
 * so the estimate is scaled by 1.5 for a typical laptop. Size grows by about 0.165 MiB per club.
 */
export function estimatedSeasonSeconds(clubs: number): number {
  return 2.26 * clubs ** 1.42;
}

/** Save size in MiB at the end of the first season (later seasons archive history and stay near this). */
export function estimatedSaveMiB(clubs: number): number {
  return 1.6 + 0.165 * clubs;
}

const LEVELS = [
  { limit: 180, label: 'Fast' },
  { limit: 480, label: 'Moderate' },
  { limit: 1200, label: 'Slow' },
  { limit: Infinity, label: 'Very slow' },
] as const;

const duration = (seconds: number) => seconds < 90 ? `${Math.max(1, Math.round(seconds))} seconds` : `${Math.round(seconds / 60)} minutes`;

export function GameSpeed({ clubs, weeks }: { clubs: number; weeks: number }) {
  const season = estimatedSeasonSeconds(clubs), level = LEVELS.findIndex(item => season < item.limit);
  const size = estimatedSaveMiB(clubs);
  return <div className="game-speed" role="group" aria-labelledby="game-speed-title" data-game-speed={LEVELS[level]!.label}>
    <div className="game-speed-heading"><strong id="game-speed-title">Game speed</strong><span>{LEVELS[level]!.label}</span></div>
    <div className="game-speed-meter" aria-hidden="true">{LEVELS.map((item, index) => <span key={item.label} className={index <= level ? `game-speed-on game-speed-${level}` : undefined} />)}</div>
    <p>About {duration(season / weeks)} per week and {duration(season)} per season with {clubs} clubs playing every week. The save is about {Math.round(size)} MB after the first season. More countries mean slower weeks. Measured with the real club data on a laptop-class computer; phones and older computers can take two to three times longer.</p>
  </div>;
}
