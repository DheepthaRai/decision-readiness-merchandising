import { CLASS_BADGE } from '../utils/constants'

export default function ClassBadge({ cls }) {
  const badgeClass = CLASS_BADGE[cls] ?? 'badge-review'
  return <span className={badgeClass}>{cls ?? '—'}</span>
}
