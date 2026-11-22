import type { ReactNode } from 'react'
import './more-info.css'

/**
 * Rules and long help behind one small closed disclosure (simplify pass, owner, 22 November 2026: fewer words on
 * screen, details on request). Urgent decisions and actions never go in here.
 */
export function MoreInfo({ label = 'More', className, id, children }: { label?: string; className?: string; id?: string; children: ReactNode }) {
  return <details className={`more-info${className ? ` ${className}` : ''}`} id={id}><summary>{label}</summary><div className="more-info-body">{children}</div></details>
}
