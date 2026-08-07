import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconDashboard(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M3 17l5-5 3 3 7-8" />
      <path d="M3 21h18" />
    </svg>
  )
}
export function IconForecast(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-4 3 2 4-7" />
      <circle cx="17" cy="5" r="1" />
    </svg>
  )
}
export function IconMoneyDate(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <path d="M3 9h18M8 2v4M16 2v4" />
      <path d="M12 13v4M10 15h4" />
    </svg>
  )
}
export function IconChat(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.3A8 8 0 1 1 21 12Z" />
    </svg>
  )
}
export function IconPlan(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 6h16M4 12h10M4 18h7" />
      <circle cx="18" cy="13" r="3" />
    </svg>
  )
}
export function IconSettings(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  )
}
export function IconUpload(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  )
}
export function IconDownload(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 4v12M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  )
}
export function IconPlus(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
export function IconTrash(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  )
}
export function IconClose(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
export function IconSend(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 12l16-7-7 16-2-7-7-2Z" />
    </svg>
  )
}
export function IconLock(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}
export function IconEdit(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  )
}
export function IconTag(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </svg>
  )
}
export function IconWeek(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <path d="M3 9h18M8 2v4M16 2v4" />
      <path d="M8 15l2.5 2.5L16 12" />
    </svg>
  )
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#27493d" />
          <stop offset="1" stopColor="#173029" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#lg-bg)" />
      <path
        d="M120 360 L208 300 L268 332 L360 196"
        stroke="#f3ead2"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="120" cy="360" r="15" fill="#f3ead2" />
      <circle cx="208" cy="300" r="15" fill="#f3ead2" />
      <circle cx="268" cy="332" r="15" fill="#f3ead2" />
      <path d="M360 196 C360 150 384 120 392 120 C392 158 380 192 360 196 Z" fill="#8fc8a8" />
      <path d="M360 200 C352 170 326 150 318 152 C326 182 344 200 360 200 Z" fill="#6fae93" />
    </svg>
  )
}
