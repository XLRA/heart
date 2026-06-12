import type { CSSProperties, ReactNode } from 'react';

// Inline SVG icons, replacing the render-blocking Font Awesome CDN stylesheet.
// Each icon renders at 1em and inherits `color` via currentColor, so the
// existing Tailwind classes (text-[26px], text-[#b0b3c6], group-hover:text-white,
// transition-colors, rotate-90, ...) keep working exactly as they did on the
// old <i> tags. Path data is from Material Design icons (Apache-2.0), with a
// few custom shapes (spotify, sparkles).
export type IconName =
  | 'play'
  | 'pause'
  | 'backward'
  | 'forward'
  | 'times'
  | 'search'
  | 'music'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'redo'
  | 'sign-out'
  | 'spotify'
  | 'volume-up'
  | 'cog'
  | 'sparkles'
  | 'align-center'
  | 'stop-circle'
  | 'spinner'
  | 'broadcast'
  | 'eye-off';

const ICONS: Record<IconName, ReactNode> = {
  play: <path d="M8 5v14l11-7z" />,
  pause: <path d="M6 5h4v14H6zm8 0h4v14h-4z" />,
  backward: <path d="M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z" />,
  forward: <path d="M13 6v12l8.5-6L13 6zm-.5 6L4 6v12l8.5-6z" />,
  times: <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />,
  search: <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14z" />,
  music: <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />,
  'chevron-right': <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />,
  'chevron-down': <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />,
  'chevron-up': <path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z" />,
  redo: <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />,
  'sign-out': <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />,
  spotify: (
    <>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M7.2 9.6c3.2-1 6.9-.7 9.6 1M7.7 12.4c2.6-.8 5.6-.5 7.7.8M8.3 15.1c2-.6 4.2-.4 5.9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  'volume-up': <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />,
  cog: <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />,
  sparkles: <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zm7 11l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" />,
  'align-center': <path d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z" />,
  'stop-circle': <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4 14H8V8h8v8z" />,
  // Quarter-arc loader; pair with Tailwind's animate-spin.
  spinner: <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z" />,
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.76 16.24 6.35 17.65A8 8 0 0 1 4 12c0-2.21.9-4.21 2.34-5.66l1.41 1.42A6 6 0 0 0 6 12c0 1.66.67 3.16 1.76 4.24zm9.9-9.9A8 8 0 0 1 20 12a8 8 0 0 1-2.34 5.66l-1.41-1.42A6 6 0 0 0 18 12a6 6 0 0 0-1.76-4.24l1.42-1.42z" />
    </>
  ),
  'eye-off': <path d="M12 7a5 5 0 0 1 5 5c0 .65-.13 1.26-.36 1.83l2.92 2.92A11.8 11.8 0 0 0 23 12s-3.37-7-11-7c-1.4 0-2.68.25-3.85.67l2.16 2.16C10.74 7.13 11.35 7 12 7zM2.71 3.16 1.29 4.57l2.55 2.55A11.79 11.79 0 0 0 1 12s3.37 7 11 7c1.85 0 3.5-.41 4.92-1.06l3.5 3.5 1.42-1.42L2.71 3.16zM12 17a5 5 0 0 1-5-5c0-.77.18-1.5.49-2.14l1.57 1.57A3 3 0 0 0 12 15c.2 0 .4-.02.58-.06l1.57 1.57c-.65.31-1.37.49-2.15.49z" />,
};

interface IconProps {
  name: IconName;
  className?: string;
  style?: CSSProperties;
}

const Icon = ({ name, className, style }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
    style={{
      width: '1em',
      height: '1em',
      display: 'inline-block',
      verticalAlign: '-0.125em',
      flexShrink: 0,
      ...style,
    }}
  >
    {ICONS[name]}
  </svg>
);

export default Icon;
