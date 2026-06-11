import { useState, useMemo } from 'react'

/**
 * Global filter state + filtered data derived from full recommendations dataset.
 *
 * PapaParse (dynamicTyping: true) parses numeric columns as JS numbers, so
 * sku_id, store_id, and city_id are numbers in the row objects. Filter values
 * from <select> elements are always strings (e.target.value). We use loose
 * equality (==) so that `135 == "135"` is true without needing String().
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
    const uniqStr = (key) =>
      [...new Set(data.map(r => String(r[key] ?? '')).filter(Boolean))]
        .sort()

    // Numeric sort for IDs that are integers in the data
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
    return data.filter(r => {
      // Use loose equality (==) to handle number vs string without explicit casting.
      // The short-circuit `&&` ensures empty filter strings (falsy) are skipped.
      if (filters.week  && r.week_label           !== filters.week)  return false
      // eslint-disable-next-line eqeqeq
      if (filters.city  && r.city_id              != filters.city)   return false
      // eslint-disable-next-line eqeqeq
      if (filters.store && r.store_id             != filters.store)  return false
      // eslint-disable-next-line eqeqeq
      if (filters.sku   && r.sku_id               != filters.sku)    return false
      if (filters.cls   && r.recommendation_class !== filters.cls)   return false
      return true
    })
  }, [data, filters])

  return { filters, setFilters, options, filtered }
}
