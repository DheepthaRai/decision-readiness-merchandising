import { getCityName } from '../utils/cityMap'

export default function FilterBar({ filters, setFilters, options }) {
  const set = (key) => (e) => setFilters(f => ({ ...f, [key]: e.target.value }))

  // Build city options as { value, label } pairs so the dropdown shows city names
  // while the filter value remains the raw city_id string (which the filter predicate compares).
  const cityOptions = options.cities.map(id => ({
    value: id,
    label: getCityName(id),
  }))

  return (
    <div className="flex flex-wrap gap-3 mb-6">
      <Select label="Week"   value={filters.week}  onChange={set('week')}  options={options.weeks} />
      <SelectLabeled label="City" value={filters.city} onChange={set('city')} options={cityOptions} />
      <Select label="Store"  value={filters.store} onChange={set('store')} options={options.stores} />
      <Select label="SKU"    value={filters.sku}   onChange={set('sku')}   options={options.skus} />
      <Select label="Class"  value={filters.cls}   onChange={set('cls')}   options={options.classes} />
      <button
        className="btn-ghost self-end"
        onClick={() => setFilters({ week: '', city: '', store: '', sku: '', cls: '' })}
      >
        Clear
      </button>
    </div>
  )
}

/** Plain string options */
function Select({ label, value, onChange, options }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <select className="filter-select w-44" value={value} onChange={onChange}>
        <option value="">All</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

/** Options with separate value / label (used for cities) */
function SelectLabeled({ label, value, onChange, options }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <select className="filter-select w-52" value={value} onChange={onChange}>
        <option value="">All</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
