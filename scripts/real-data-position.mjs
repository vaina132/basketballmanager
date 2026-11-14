/** Broad provider groups do not establish a precise game position. Keep estimates explicit. */
export function resolvePosition(raw, previous, precise = null) {
  const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
  if (!positions.includes(previous)) throw new Error('Unsupported fallback position.');
  if (precise) {
    if (!positions.includes(precise.position)) throw new Error('Unsupported precise position evidence.');
    return { position: precise.position, estimated: false, basis: 'official' };
  }
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const exact = ({ pg: 'PG', sg: 'SG', sf: 'SF', pf: 'PF', c: 'C', 'point guard': 'PG', 'shooting guard': 'SG', 'small forward': 'SF', 'power forward': 'PF', center: 'C', centre: 'C' })[normalized];
  if (exact) return { position: exact, estimated: false, basis: 'reported' };
  const choices = ({ guard: ['PG', 'SG'], forward: ['SF', 'PF'] })[normalized];
  return { position: choices ? choices.includes(previous) ? previous : choices[1] === 'SG' ? 'SG' : 'SF' : previous, estimated: true, basis: choices ? 'broad-group-estimate' : 'missing-position-estimate' };
}
