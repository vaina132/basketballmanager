/**
 * Format 67 (saved ideas level): richer press topics and the manager's media standing. Present only in careers
 * created with the media system; older careers keep the format-34 press (two topics after runs of three results).
 */
export interface SeasonMedia {
  model: 'media-1';
  /** The career opening: results and press answers count from here. */
  since: { seasonNumber: number; round: number; date: string };
}

/** Answer styles of the richer press conferences; their effects differ by topic (`MEDIA_RULES.effects`). */
export type PressStyle = 'calm' | 'confident' | 'deflect' | 'combative';

/** One step of the media standing, newest first in `MediaReputation.history`. */
export interface MediaMove {
  id: string;
  date: string;
  seasonNumber: number;
  kind: 'press' | 'result' | 'season';
  label: string;
  change: number;
  value: number;
}

export interface MediaReputation {
  /** 0-100; 50 at the start of a career. */
  value: number;
  label: string;
  history: MediaMove[];
}
