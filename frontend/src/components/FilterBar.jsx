import MultiSelect from './MultiSelect'
import { getCityName } from '../utils/cityMap'

export default function FilterBar({ filters, setFilters, options, clearAll }) {
  const set = (key) => (vals) => setFilters(f => ({ ...f, [key]: vals }))

  // Build city options as {value, label} so dropdown shows names but stores raw IDs
  const cityOptions = options.cities.map(id => ({
    value: id,
    label: getCityName(id),
  }))

  return (
    <div className="flex flex-wrap gap-3 mb-6 items-end">
      <MultiSelect label="Week"   options={options.weeks}   selected={filters.week}  onChange={set('week')}  width="w-36" />
      <MultiSelect label="City"   options={cityOptions}     selected={filters.city}  onChange={set('city')}  width="w-48" />
      <MultiSelect label="Store"  options={options.stores}  selected={filters.store} onChange={set('store')} width="w-36" />
      <MultiSelect label="SKU"    options={options.skus}    selected={filters.sku}   onChange={set('sku')}   width="w-36" />
      <MultiSelect label="Class"  options={options.classes} selected={filters.cls}   onChange={set('cls')}   width="w-44" />
      <button
        className="btn-ghost self-end"
        onClick={clearAll ?? (() => setFilters({ week: [], city: [], store: [], sku: [], cls: [] }))}
      >
        Clear all
      </button>
    </div>
  )
}
