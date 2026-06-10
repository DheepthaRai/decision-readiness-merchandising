import Papa from 'papaparse'
import { DATA_BASE } from './constants'

/**
 * Fetch and parse a CSV file from public/data/.
 * Returns an array of objects (one per row).
 */
export async function fetchCSV(filename) {
  const url = DATA_BASE + filename
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  const text = await response.text()
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  })
  if (result.errors.length) {
    console.warn('CSV parse warnings:', result.errors.slice(0, 5))
  }
  return result.data
}

/** Export an array of objects as a CSV download. */
export function exportCSV(data, filename = 'export.csv') {
  const csv = Papa.unparse(data)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
