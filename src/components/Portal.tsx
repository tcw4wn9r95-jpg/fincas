import { useState, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders children into a fresh node on <body>, escaping page containers.
 * Our page roots animate with a transform (fade-up), and a transformed ancestor
 * makes `position: fixed` resolve against that element instead of the viewport —
 * which left modals drifting off-screen and impossible to scroll. Portalling to
 * body sidesteps that entirely.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [el] = useState(() => document.createElement('div'))
  useEffect(() => {
    document.body.appendChild(el)
    return () => {
      el.remove()
    }
  }, [el])
  return createPortal(children, el)
}
