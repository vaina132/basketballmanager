export function SquadStrength({ value, clubName }: { value: number; clubName: string }) {
  const rating = Math.max(1, Math.min(99, Math.round(value)));
  return <span className="squad-strength" title={`${clubName}: ${rating}/99. Average position-weighted ability of the best eight players; ratings remain provisional.`}><span>Squad strength</span><span className="squad-strength-track" role="meter" aria-label={`${clubName} squad strength`} aria-valuemin={1} aria-valuemax={99} aria-valuenow={rating} aria-valuetext={`${rating} out of 99, provisional`}><span style={{ width: `${rating / 99 * 100}%` }}/></span></span>;
}
