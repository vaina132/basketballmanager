/**
 * Game speed for a chosen set of leagues (owner request, 15 November 2026). More clubs simulated in full means slower
 * matchdays. The estimate comes from measured full seasons with every management system on, on the test laptop:
 * 18 clubs (one German league) took 129 s and 36 clubs (Spain's two divisions) 341 s; a power law through both,
 * about 2.26 x clubs^1.4 seconds a season, is used. Other computers differ, so the wording stays approximate.
 */
export function estimatedSeasonSeconds(clubs: number): number {
  return 2.26 * clubs ** 1.4;
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
  return <div className="game-speed" role="group" aria-labelledby="game-speed-title" data-game-speed={LEVELS[level]!.label}>
    <div className="game-speed-heading"><strong id="game-speed-title">Game speed</strong><span>{LEVELS[level]!.label}</span></div>
    <div className="game-speed-meter" aria-hidden="true">{LEVELS.map((item, index) => <span key={item.label} className={index <= level ? `game-speed-on game-speed-${level}` : undefined} />)}</div>
    <p>About {duration(season / weeks)} per week and {duration(season)} per season with {clubs} clubs. More playable countries mean slower weeks. Estimated from test runs; your computer may differ.</p>
  </div>;
}
