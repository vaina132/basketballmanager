import type { CSSProperties } from 'react'

export type IconName = 'home' | 'court' | 'people' | 'training' | 'staff' | 'search' | 'mail' | 'building' | 'settings' | 'play' | 'pause' | 'next' | 'skip' | 'restart' | 'save' | 'download' | 'upload' | 'arrow' | 'chevron' | 'check' | 'close' | 'ball' | 'clock' | 'swap' | 'wallet' | 'calendar' | 'target' | 'star' | 'filter' | 'shield' | 'medical'

const paths: Record<IconName, string> = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  court: 'M3 4h18v16H3ZM12 4v16M3 8h4v8H3m18-8h-4v8h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M13 3.13a4 4 0 0 1 0 7.75M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  training: 'M6 4v16M3 7v10m15-13v16m3-13v10M6 12h12',
  staff: 'M2 21v-2a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v2M7.5 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M15 4h6v17h-4M16 8h2m-2 4h2',
  search: 'M21 21l-5-5M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15',
  mail: 'M3 5h18v14H3ZM3 5l9 8 9-8',
  building: 'M4 21V6l8-3 8 3v15M2 21h20M8 8h1m6 0h1M8 12h1m6 0h1m-6 9v-5h6v5',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  play: 'm8 4 12 8-12 8Z', pause: 'M8 5v14M16 5v14',
  next: 'm5 5 10 7-10 7ZM19 5v14', skip: 'm3 5 9 7-9 7Zm9 0 9 7-9 7Z',
  restart: 'M3 10a9 9 0 1 1 1.5 7M3 4v6h6',
  save: 'M4 3h13l4 4v14H3V3ZM7 3v6h9V3M7 21v-8h10v8',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5',
  arrow: 'M4 12h16m-6-6 6 6-6 6', chevron: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6', close: 'm6 6 12 12M6 18 18 6',
  ball: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2v20M5 5a10 10 0 0 1 0 14M19 5a10 10 0 0 0 0 14',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  swap: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
  wallet: 'M3 6h17v15H3V6Zm0 0V4l14-2v4m-2 6h7v5h-7Zm3 2.5h.01',
  calendar: 'M4 5h16v16H4ZM8 2v6m8-6v6M4 10h16M8 14h2m4 0h2m-8 3h2',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10m0 4v2m-1-1h2',
  star: 'm12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L3 9.6l6.2-.9Z',
  filter: 'M3 5h18l-7 8v7l-4-2v-5ZM7 2v3m10-3v3',
  medical: 'M8 3h8v5h5v8h-5v5H8v-5H3V8h5Z',
  shield: 'm12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Zm-4 10 3 3 5-6',
}

export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>
}
