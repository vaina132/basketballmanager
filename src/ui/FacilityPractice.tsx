import type { SeasonState } from '../domain/season'
import type { TrainingPoints } from '../domain/training'
import { facilityPracticeBonusPercent, getFacilityLevel } from '../world/facilities-policy'
import { Icon } from './Icon'
import './facilities-panel.css'

export function FacilityPracticeEffect({ season, type }: { season: SeasonState; type: 'training' | 'youth' }) {
  if (!season.facilities.enabledSince) return null
  const level = getFacilityLevel(season, type, season.managedClubId)
  const bonus = facilityPracticeBonusPercent(season, type, season.managedClubId)
  return <div className="training-facility-line" data-facility-practice={type} data-facility-practice-level={level} data-facility-practice-bonus={bonus}><Icon name="building" size={16} /><span><strong>{type === 'training' ? 'Training facilities' : 'Youth infrastructure'}</strong> · Level {level} · {bonus ? `+${bonus}% eligible practice` : 'Standard practice'}</span></div>
}

export function FacilityPracticeContribution({ report, youth = false }: { report?: { earnedPoints: number; gains: TrainingPoints }; youth?: boolean }) {
  if (!report) return null
  const retained = Object.values(report.gains).reduce((sum, points) => sum + points, 0)
  if (report.earnedPoints === 0 && retained === 0) return null
  return <small className="facility-practice-contribution" data-facility-practice-gain={retained} title={`${report.earnedPoints} extra practice points before skill limits; ${retained} included in recorded progress.`}>{youth ? 'Youth infrastructure' : 'Facilities'} +{retained} practice{retained === 0 ? ' · skill limit reached' : ''}</small>
}
