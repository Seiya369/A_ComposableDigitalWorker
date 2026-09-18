import type { CSSProperties } from 'react';

export type IconName = 'people' | 'person' | 'plus' | 'close' | 'chevron' | 'check' | 'search' | 'settings' | 'briefcase' | 'layers' | 'model' | 'memory' | 'shield' | 'network' | 'delivery' | 'arrow' | 'external' | 'trash' | 'clock' | 'play' | 'refresh' | 'edit' | 'folder';

const paths: Record<IconName, string> = {
  folder: 'M3 7V5h6l2 2h10v13H3V7Zm0 3h18',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  person: 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6', chevron: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6', search: 'm21 21-4.3-4.3M19 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M17 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  briefcase: 'M9 6V4h6v2M3 10h18M9 10v3h6v-3M3 6h18v14H3V6Z',
  layers: 'm12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5',
  model: 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6V6Zm3 3h6v6H9V9Z',
  memory: 'M4 5c0-2 16-2 16 0v14c0 2-16 2-16 0V5Zm0 0c0 2 16 2 16 0M4 12c0 2 16 2 16 0',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Zm-4 9 3 3 5-6',
  network: 'M12 8v4M5 16v-4h14v4M9 3h6v5H9V3ZM2 16h6v5H2v-5Zm14 0h6v5h-6v-5Z',
  delivery: 'M9 3h6v4H9V3ZM9 5H5v16h14V5h-4M8 13l3 3 5-6',
  arrow: 'M5 12h14m-5-5 5 5-5 5', external: 'M14 3h7v7M21 3 10 14M11 3H3v18h18v-8',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  clock: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  play: 'm8 4 12 8-12 8V4Z', refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',
};

export function Icon({ name, size = 18, className = '', style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true"><path d={paths[name]} /></svg>;
}
