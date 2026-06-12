import { useState, useEffect } from 'react'
import { fetchCSV } from '../utils/csv'

/**
 * Generic module-level cache factory.
 * Each CSV/JSON file is fetched once and shared across all components.
 */
function makeCSVHook(filename) {
  let _cache = null
  let _promise = null

  return function useHook() {
    const [state, setState] = useState({
      data: _cache ?? [],
      loading: !_cache,
      error: null,
    })

    useEffect(() => {
      if (_cache) return
      if (!_promise) {
        _promise = fetchCSV(filename)
          .then(rows => { _cache = rows; return rows })
      }
      _promise
        .then(rows => setState({ data: rows, loading: false, error: null }))
        .catch(err  => setState({ data: [], loading: false, error: err.message }))
    }, [])

    return state
  }
}

function makeJSONHook(filename) {
  let _cache = null
  let _promise = null

  return function useHook() {
    const [state, setState] = useState({
      data: _cache ?? null,
      loading: !_cache,
      error: null,
    })

    useEffect(() => {
      if (_cache) return
      if (!_promise) {
        _promise = fetch(
          (import.meta.env.BASE_URL ?? '/') + 'data/' + filename
        )
          .then(r => {
            if (!r.ok) throw new Error(`Failed to fetch ${filename}: ${r.status}`)
            return r.json()
          })
          .then(data => { _cache = data; return data })
      }
      _promise
        .then(data => setState({ data, loading: false, error: null }))
        .catch(err  => setState({ data: null, loading: false, error: err.message }))
    }, [])

    return state
  }
}

// ── V1 hook (kept for backwards compatibility) ───────────────────────────────
export const useRecommendations = makeCSVHook('product_store_recommendations.csv')

// ── V2 hooks ─────────────────────────────────────────────────────────────────
export const useForecastResults      = makeCSVHook('forecast_results_sample.csv')
export const useForecastMetrics      = makeJSONHook('forecast_metrics.json')
export const useInventoryRecs        = makeCSVHook('inventory_recommendations.csv')
export const useConstrainedRecs      = makeCSVHook('constrained_recommendations.csv')
export const useConstraintSummary    = makeJSONHook('constraint_summary.json')
