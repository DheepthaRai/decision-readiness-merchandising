import { useState, useMemo } from 'react'

/**
 * Global filter state + filtered data derived from full recommendations dataset.
 *
 * Each filter dimension is now a string[] of selected values (empty = "All").
 * Loose equality (==) is used so numeric columns from PapaParse dynamicTyping
 * compare correctly against string values from select/checkbox inputs.
 */
export function useFilters(data) {
  const [filters, setFilters] = useState({
    week:  [],
    city:  [],
    store: [],
    sku:   [],
    cls:   [],
  })

  const options = useMemo(() => {
    const uniqStr = (key) =>
      [...new Set(data.map(r => String(r[key] ?? '')).filter(Boolean))].sort()

    // Numeric sort for integer ID columns
    const uniqNum = (key) =>
      [...new Set(data.map(r => r[key]).filter(v => v != null))]
        .sort((a, b) => Number(a) - Number(b))
        .map(String)

    return {
      weeks:   uniqStr('week_label'),
      cities:  uniqNum('city_id'),
      stores:  uniqNum('store_id'),
      skus:    uniqNum('sku_id'),
      classes: uniqStr('recommendation_class'),
    }
  }, [data])

  const filtered = useMemo(() => {
    const { week, city, store, sku, cls } = filters
    return data.filter(r => {
      // eslint-disable-next-line eqeqeq
      if (week.length  && !week.includes(r.week_label))               return false
      // eslint-disable-next-line eqeqeq
      if (city.length  && !city.some(c  => c  == r.city_id))         return false
      // eslint-disable-next-line eqeqeq
      if (store.length && !store.some(s => s  == r.store_id))        return false
      // eslint-disable-next-line eqeqeq
      if (sku.length   && !sku.some(s   => s  == r.sku_id))          return false
      if (cls.length   && !cls.includes(r.recommendation_class))      return false
      return true
    })
  }, [data, filters])

  const clearAll = () => setFilters({ week: [], city: [], store: [], sku: [], cls: [] })

  return { filters, setFilters, options, filtered, clearAll }
}
