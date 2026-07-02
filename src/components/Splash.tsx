import { useEffect, useState } from 'react'

const SEEN_KEY = 'casaressan.splash.seen'

function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Animated brand splash. Plays once per session — on app launch, not on every
 * reload or tab switch, so it stays a moment of delight instead of a toll.
 */
export function Splash() {
  const [skip] = useState(alreadySeen)
  const [hide, setHide] = useState(false)

  useEffect(() => {
    if (skip) return
    try {
      sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* private mode — just show it */
    }
    const t = setTimeout(() => setHide(true), 1800)
    return () => clearTimeout(t)
  }, [skip])

  if (skip) return null

  return (
    <div className={`splash ${hide ? 'hide' : ''}`} aria-hidden={hide}>
      <div className="splash-inner">
        <svg className="splash-logo" viewBox="0 0 512 512">
          <path
            className="line"
            d="M120 360 L208 300 L268 332 L360 196"
            stroke="#f3ead2"
            strokeWidth="26"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            pathLength={1}
          />
          <g className="leaf">
            <path d="M360 196 C360 150 384 120 392 120 C392 158 380 192 360 196 Z" fill="#8fc8a8" />
            <path d="M360 200 C352 170 326 150 318 152 C326 182 344 200 360 200 Z" fill="#6fae93" />
          </g>
        </svg>
        <div className="splash-word">CasaresSan</div>
        <div className="splash-sub">Finances</div>
        <div className="splash-tag">your money, in focus</div>
        <div className="splash-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  )
}
