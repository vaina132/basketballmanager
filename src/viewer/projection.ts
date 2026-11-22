/** The diagonal court picture: court coordinates (0-1 along the length and width) to picture pixels. */
export function project(x: number, y: number) { return { x: 74 + x * 484 + y * 224, y: 244 + x * 102 - y * 172 } }

/** The picture's view box; the court and the stands behind it share it so they line up. */
export const COURT_VIEW_BOX = '18 20 820 365'

export function rgb(color: string): [number, number, number] | null {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1]
  if (!hex) return null
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}
