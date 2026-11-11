import type { Physio } from '../domain/physio'
import { REHABILITATION_CREDIT_PER_DAY_SAVED } from '../world/rehabilitation-policy'
import { FitnessPortrait } from './FitnessBenefits'
import './medical-workspace.css'

export function PhysioPortrait({ coach, size = 64, color }: { coach: Pick<Physio, 'id' | 'name'>; size?: number; color?: string }) {
  return <FitnessPortrait coach={coach} size={size} color={color} />
}

export function PhysioBenefits({ effects }: { effects: { creditPerDay: number; maximumReductionPercent: number } }) {
  return <div className="physio-benefits"><span>Injury recovery</span><strong>Up to {effects.maximumReductionPercent}% shorter</strong><small>Actual progress is recorded in Medical.</small><details><summary>How rehabilitation works</summary><p>Each injured day between matchdays earns {effects.creditPerDay} care points. Every {REHABILITATION_CREDIT_PER_DAY_SAVED} points can shorten recovery by one day, within the limit above. Reviews happen after Continue and cannot make a player available for a match already prepared. No treatment runs during the offseason.</p></details></div>
}
