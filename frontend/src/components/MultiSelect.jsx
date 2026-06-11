import { useState, useRef, useEffect } from 'react'

/**
 * Multi-select dropdown with checkboxes.
 *
 * Props:
 *   label    — string shown above the trigger button
 *   options  — string[] | { value: string, label: string }[]
 *   selected — string[] of currently selected values
 *   onChange — (newSelected: string[]) => void
 *   width    — optional Tailwind width class (default 'w-44')
 */
export default function MultiSelect({ label, options, selected, onChange, width = 'w-44' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const normalised = options.map(o =>
    typeof o === 'string' ? { value: o, label: o } : o
  )

  const toggle = (val) => {
    onChange(
      selected.includes(val)
        ? selected.filter(v => v !== val)
        : [...selected, val]
    )
  }

  const selectAll = () => onChange(normalised.map(o => o.value))
  const clearAll  = () => onChange([])

  const summary = selected.length === 0
    ? 'All'
    : selected.length === 1
      ? (normalised.find(o => o.value === selected[0])?.label ?? selected[0])
      : `${selected.length} selected`

  const isEmpty = selected.length === 0

  return (
    <div className={`flex flex-col gap-1 relative ${width}`} ref={ref}>
      {label && <span className="text-xs font-medium text-slate-500">{label}</span>}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`filter-select w-full text-left flex items-center justify-between gap-1
                    ${isEmpty ? 'text-slate-400' : 'text-slate-800 font-medium'}`}
      >
        <span className="truncate">{summary}</span>
        <span className={`text-slate-400 text-xs shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-border rounded-lg
                        shadow-lg z-50 w-max min-w-full max-w-xs max-h-72 flex flex-col">
          {/* Header controls */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-800 transition-colors"
              onClick={clearAll}
            >
              Clear
            </button>
            <span className="text-xs text-slate-300">|</span>
            <button
              type="button"
              className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
              onClick={selectAll}
            >
              Select all
            </button>
          </div>

          {/* Option list */}
          <div className="overflow-y-auto">
            {normalised.map(({ value, label: optLabel }) => {
              const checked = selected.includes(value)
              return (
                <label
                  key={value}
                  className={`flex items-center gap-2.5 px-3 py-1.5 cursor-pointer
                              hover:bg-slate-50 transition-colors
                              ${checked ? 'bg-blue-50/50' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="accent-slate-700 shrink-0"
                    checked={checked}
                    onChange={() => toggle(value)}
                  />
                  <span className={`text-sm truncate
                                    ${checked ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>
                    {optLabel}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
