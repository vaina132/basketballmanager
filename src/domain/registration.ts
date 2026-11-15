/** A verified eligibility fact is not inferred from nationality, a name, age or physical appearance. */
export type EligibilityFact = 'yes' | 'no' | 'unknown';
export interface PlayerEligibilityEvidence {
  playerId: string;
  competitionId: string;
  domestic: EligibilityFact;
  homegrown: EligibilityFact;
  sources: readonly string[];
  observedOn: string;
}

export interface CompetitionRegistrationRule {
  id: string;
  competitionId: string;
  season: number;
  opensOn: string;
  closesOn: string;
  maximumRegistered: number;
  minimumMatchday: number;
  maximumMatchday: number;
  /** Quota by submitted squad size. A null limit means this rule does not enforce that quota. */
  minimumDomestic: Readonly<Record<number, number>> | null;
  minimumHomegrown: Readonly<Record<number, number>> | null;
  maximumForeign: number | null;
  /** Rules with incomplete source coverage remain provisional in the game. */
  status: 'verified' | 'provisional';
  sources: readonly string[];
}

export interface CompetitionRegistration {
  model: 'competition-registration-1';
  competitionId: string;
  clubId: string;
  season: number;
  ruleId: string;
  submittedOn: string;
  playerIds: string[];
}

export interface RegistrationAssessment {
  status: 'eligible' | 'ineligible' | 'unverified';
  errors: string[];
  unknownPlayerIds: string[];
}
