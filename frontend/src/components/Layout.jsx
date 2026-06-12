import { NavLink } from 'react-router-dom'

const NAV = [
  { to: '/',             label: 'Executive Overview', icon: '📊' },
  { to: '/actions',      label: 'Action Queue',       icon: '🎯', highlight: true },
  { to: '/readiness',    label: 'Product Readiness',  icon: '✅' },
  { to: '/localization', label: 'Localization',        icon: '🗺️' },
  { to: '/risk',         label: 'Risk Diagnostics',   icon: '⚠️' },
  { to: '/simulator',    label: 'Simulator',           icon: '🎛️' },
  { divider: true },
  { to: '/forecasting',  label: 'Demand Forecast',    icon: '📈' },
  { to: '/optimizer',    label: 'Inv. Optimizer',     icon: '⚙️' },
]

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex bg-surface">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-white border-r border-border flex flex-col">
        <div className="px-5 py-5 border-b border-border">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Merchandising Ops</p>
          <h1 className="text-base font-bold text-slate-800 leading-tight">Decision Readiness</h1>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item, i) =>
            item.divider ? (
              <div key={`divider-${i}`} className="my-2 border-t border-border" />
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                   ${isActive
                     ? 'bg-slate-100 text-slate-900'
                     : item.highlight
                       ? 'text-slate-700 bg-amber-50 hover:bg-amber-100 border border-amber-200'
                       : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`
                }
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            )
          )}
        </nav>
        <div className="px-5 py-4 border-t border-border">
          <p className="text-xs text-slate-400 leading-relaxed">
            Scores are decision-support, not auto-decisions. Spoilage unobserved.
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto p-8">
        {children}
      </main>
    </div>
  )
}
