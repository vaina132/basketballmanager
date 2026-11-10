import type { FitnessCoach } from '../domain/fitness'
import { CoachPortrait } from './CoachPortrait'
import './fitness-staff.css'

export const fitnessNumber = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value)

export function FitnessPortrait({ coach, size = 64, color }: { coach: Pick<FitnessCoach, 'id' | 'name'>; size?: number; color?: string }) {
  const identity = [...coach.id].reduce((hash, letter) => (hash * 31 + letter.charCodeAt(0)) >>> 0, 29)
  return <CoachPortrait coach={{ id: String(identity), name: coach.name }} size={size} color={color} />
}

export function FitnessBenefits({ effects }: { effects: { recoveryPerDay: number; practiceCostReductionPercent: number } }) {
  return <dl className="fitness-benefits"><div><dt>Extra recovery</dt><dd data-fitness-recovery={effects.recoveryPerDay}>Up to +{fitnessNumber(effects.recoveryPerDay)} <small>condition/day</small></dd></div><div><dt>Practice fatigue</dt><dd data-fitness-fatigue={effects.practiceCostReductionPercent}>{fitnessNumber(effects.practiceCostReductionPercent)}% less</dd></div></dl>
}
