import { useState, useEffect } from 'react'
import { fetchCSV } from '../utils/csv'

/**
 * Load product_store_recommendations.csv once, cache in module scope.
 * Returns { data, loading, error }
 */
let _cache = null
let _promise = null

export function useRecommendations() {
  const [state, setState] = useState({
    data: _cache ?? [],
    loading: !_cache,
    error: null,
  })

  useEffect(() => {
    if (_cache) return
    if (!_promise) {
      _promise = fetchCSV('product_store_recommendations.csv')
        .then(rows => { _cache = rows; return rows })
    }
    _promise
      .then(rows => setState({ data: rows, loading: false, error: null }))
      .catch(err  => setState({ data: [], loading: false, error: err.message }))
  }, [])

  return state
}
