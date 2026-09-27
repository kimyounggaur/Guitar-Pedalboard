import type { CSSProperties } from 'react';
import type { PedalType } from '../audio/types';

interface PedalIconProps {
  type: PedalType;
  color?: string;
}

export function PedalIcon({ type, color = 'var(--accent)' }: PedalIconProps) {
  const commonProps = {
    className: 'pedal-type-icon',
    viewBox: '0 0 24 24',
    role: 'img' as const,
    'aria-label': `${type} icon`,
    style: { '--pedal-icon-color': color } as CSSProperties,
  };

  switch (type) {
    case 'noiseGate':
      return (
        <svg {...commonProps}>
          <path d="M4 12h5l2-6 2 12 2-6h5" />
          <path d="M5 5h14v14H5z" />
        </svg>
      );
    case 'compressor':
      return (
        <svg {...commonProps}>
          <path d="M4 6h5l3 6 3-6h5" />
          <path d="M4 18h5l3-6 3 6h5" />
          <path d="M12 4v16" />
        </svg>
      );
    case 'autoWah':
      return (
        <svg {...commonProps}>
          <path d="M4 17c2-7 4-10 8-10s6 3 8 10" />
          <path d="M6 17c1.5-4.5 3.2-6.5 6-6.5s4.5 2 6 6.5" />
          <circle cx="12" cy="17" r="1.5" />
        </svg>
      );
    case 'drive':
      return (
        <svg {...commonProps}>
          <path d="M4 16c3-8 5-8 8 0s5 8 8 0" />
          <path d="M5 19h14" />
          <path d="M7 5h10l2 5H5z" />
        </svg>
      );
    case 'crunch':
      return (
        <svg {...commonProps}>
          <path d="M13 3 5 14h6l-1 7 9-12h-6z" />
          <path d="M4 20h16" />
        </svg>
      );
    case 'fuzz':
      return (
        <svg {...commonProps}>
          <path d="M4 8h3v8h4V8h3v8h6" />
          <path d="M5 5h14v14H5z" />
        </svg>
      );
    case 'graphicEQ':
      return (
        <svg {...commonProps}>
          <path d="M5 5v14M9.7 5v14M14.3 5v14M19 5v14" />
          <path d="M3.5 9h3M8.2 14h3M12.8 7h3M17.5 12h3" />
        </svg>
      );
    case 'eq':
      return (
        <svg {...commonProps}>
          <path d="M6 5v14M12 5v14M18 5v14" />
          <path d="M4 9h4M10 15h4M16 11h4" />
        </svg>
      );
    case 'cab':
      return (
        <svg {...commonProps}>
          <path d="M4 5h16v14H4z" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="2" />
          <path d="M7 7h1M16 7h1M7 17h1M16 17h1" />
        </svg>
      );
    case 'chorus':
      return (
        <svg {...commonProps}>
          <path d="M3 9c2.2-4 4.4-4 6.6 0s4.4 4 6.6 0 3.3-3 4.8-1" />
          <path d="M3 15c2.2-4 4.4-4 6.6 0s4.4 4 6.6 0 3.3-3 4.8-1" />
        </svg>
      );
    case 'flanger':
      return (
        <svg {...commonProps}>
          <path d="M3 8c3-3 5-3 8 0s5 3 10 0" />
          <path d="M3 16c3 3 5 3 8 0s5-3 10 0" />
          <path d="M5 12h14" />
        </svg>
      );
    case 'phaser':
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4.5" />
          <path d="M4 12h4m8 0h4M12 4v4m0 8v4" />
        </svg>
      );
    case 'tremolo':
      return (
        <svg {...commonProps}>
          <path d="M3 12c2-7 4-7 6 0s4 7 6 0 4-7 6 0" />
          <path d="M4 5v14M20 5v14" />
        </svg>
      );
    case 'delay':
      return (
        <svg {...commonProps}>
          <path d="M7 8a6 6 0 1 1-1.5 5.9" />
          <path d="M5 14H2v-3" />
          <path d="M12 8v5l3 2" />
        </svg>
      );
    case 'reverb':
      return (
        <svg {...commonProps}>
          <path d="M4 12c2-5 5-5 7 0s5 5 9 0" />
          <path d="M4 17c2-3 5-3 7 0s5 3 9 0" />
          <path d="M4 7c2-3 5-3 7 0s5 3 9 0" />
        </svg>
      );
    default:
      return (
        <svg {...commonProps}>
          <path d="M5 5h14v14H5z" />
          <path d="M9 9h6v6H9z" />
        </svg>
      );
  }
}
