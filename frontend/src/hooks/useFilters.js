import { useState, useMemo } from 'react'

/**
 * Global filter state + filtered data derived from full recommendations dataset.
 */
export function useFilters(data) {
  const [filters, setFilters] = useState({
    week: '',
    city: '',
    store: '',
    sku: '',
    cls: '',
  })

  const options = useMemo(() => {
    const uniq = (key) => [...new Set(data.map(r => String(r[key] ?? '')).filter(Boolean))].sort()
    return {
      weeks:   uniq('week_label'),
      cities:  uniq('city_id'),
      stores:  uniq('store_id'),
      skus:    uniq('sku_id'),
      classes: uniq('recommendation_class'),
    }
  }, [data])

  const filtered = useMemo(() => {
    return data.filter(r => {
      if (filters.week  && String(r.week_label)            !== filters.week)  return false
      if (filters.city  && String(r.city_id)               !== filters.city)  return false
      if (filters.store && String(r.store_id)              !== filters.store) return false
      if (filters.sku   && String(r.sku_id)                !== filters.sku)   return false
      if (filters.cls   && r.recommendation_class          !== filters.cls)   return false
      return true
    })
  }, [data, filters])

  return { filters, setFilters, options, filtered }
}
