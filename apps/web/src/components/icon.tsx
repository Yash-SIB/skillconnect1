import type { SVGProps } from "react";

const paths = {
  search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
  home: <><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-6h6v6"/></>,
  files: <><rect x="7" y="7" width="13" height="14" rx="2"/><path d="M16 3H5a2 2 0 0 0-2 2v12M10 12h7m-7 4h5"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  chevron: <path d="m6 9 6 6 6-6"/>,
  hash: <path d="m10 3-4 18m12-18-4 18M4 9h16M3 15h16"/>,
  pen: <><path d="m13 6 5 5M4 20l5-1L21 7l-4-4L5 15z"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 5a3 3 0 0 1 0 6m2 3a4 4 0 0 1 3 4v2"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-12 5h6m-3-2v5"/></>,
  drive: <path d="M9 3h6l7 12-3 5H5l-3-5zm0 0 7 12M2 15h20M8 15l7-12"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  spark: <path d="M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z"/>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-3-5.5 3 1-6.2L3 9.6l6.2-.9z"/>,
  bell: <path d="M10 21h4m-9-5h14l-2-3V9a5 5 0 0 0-10 0v4z"/>,
  more: <><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></>,
  chat: <path d="M21 11a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 11Z"/>,
  book: <><path d="M5 3h14v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm14 14H5a2 2 0 0 0-2 2M7 7h8m-8 4h6"/></>,
  userPlus: <><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m3-13v8m-4-4h8"/></>,
  smile: <><circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0M9 9h.01M15 9h.01"/></>,
  bold: <path d="M6 4h7a4 4 0 0 1 0 8H6m7 0a4 4 0 0 1 0 8H6V4"/>,
  italic: <path d="M11 4h8M5 20h8M15 4 9 20"/>,
  strike: <path d="M17 7c-.6-2-2.3-3-5-3-3 0-5 1.5-5 4 0 2 2 3 5 4m5 3c1 3-1 5-5 5-3 0-5-1.4-5-3M3 12h18"/>,
  code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>,
  format: <path d="M3 19 8 5l5 14M5 15h6m5 0a3 3 0 1 1 6 0v4m0-4v1m0 0a3 3 0 1 0-3 3h3"/>,
  at: <><circle cx="11" cy="12" r="3"/><path d="M14 9v5a2 2 0 0 0 4 0v-2a7 7 0 1 0-3 6"/></>,
  clip: <path d="m21 11-8.2 8.2a5 5 0 0 1-7.1-7.1l9.1-9.1a3.2 3.2 0 0 1 4.5 4.5l-9.1 9.1a1.4 1.4 0 0 1-2-2l8.1-8.1"/>,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-3 0h6"/></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>,
  send: <><path d="m3 4 18 8-18 8 4-8zM7 12h14"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
} satisfies Record<string, React.ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
