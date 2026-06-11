/**
 * City Proxy Mapping — FreshRetailNet-50K
 *
 * The FreshRetailNet-50K dataset (Dingdong-Inc/FreshRetailNet-50K) anonymises all
 * geographic identifiers, using integer city_id values 0–17 in place of real city names.
 * No official mapping is published by the dataset authors.
 *
 * The mapping below is inferred from climate fingerprinting: daily weather observations
 * embedded in the raw parquet (temperature, relative humidity, precipitation, wind speed)
 * for the late-June / early-July 2024 evaluation period were compared against published
 * historical climatology for cities known to be in Dingdong's operating footprint.
 *
 * Confidence levels:
 *   HIGH  — multiple independent signals align (humidity, temperature, store count, and
 *            known Dingdong market-entry timeline all consistent with only one city).
 *   MED   — primary climate signal is consistent, but 1–2 other candidate cities share
 *            similar profiles; store count provides supporting evidence.
 *   LOW   — climate profile is plausible but not uniquely distinguishing; store count is
 *            small (≤ 10) and multiple candidate cities fit.
 *
 * ⚠️  This mapping is a PROXY only. It has not been confirmed by Dingdong-Inc or
 *     the dataset authors. Do not use it for operational decisions beyond exploratory
 *     analysis and portfolio tooling demos.
 *
 * Key climate signals used:
 *   • Relative humidity (RH): The strongest discriminator. Northern cities (Beijing,
 *     Tianjin) exhibit RH ≈ 58–60% in late June — uniquely drier than all southern
 *     and eastern cities (RH > 70%).
 *   • Temperature: Chongqing stands out as the hottest at 31°C+; Shanghai/Nanjing/
 *     Hangzhou cluster around 28–30°C.
 *   • Precipitation: Nanjing (10.6 mm/day) and Jiaxing/Changzhou (≈ 9–10 mm/day)
 *     are rainier than the Guangdong cities (< 6 mm/day).
 *   • Store count: Dingdong's known HQ market (Shanghai ~290 stores), second market
 *     (Hangzhou ~107), and satellite markets (Guangzhou ~90, Suzhou ~89) are matched
 *     to city_ids with similar store counts in the dataset.
 */

export const CITY_MAP = {
  0:  { name: 'Shanghai',   confidence: 'high', climate_basis: '290 stores; Dingdong HQ market; 28.8°C, RH 79.7%' },
  1:  { name: 'Changsha',   confidence: 'low',  climate_basis: 'Hot and humid: 30.4°C, RH 76.8%; inland central China' },
  2:  { name: 'Chongqing',  confidence: 'low',  climate_basis: 'Hottest city in dataset at 31.0°C; mountainous basin heat island' },
  3:  { name: 'Beijing',    confidence: 'high', climate_basis: 'RH 60.0% — uniquely dry; only large city in dataset below 70% RH' },
  4:  { name: 'Nanjing',    confidence: 'med',  climate_basis: 'Highest precipitation 10.6 mm/day; hot humid summer (29.5°C, RH 79%)' },
  5:  { name: 'Wuhan',      confidence: 'low',  climate_basis: '29.2°C, RH 78.5%; "furnace city" profile consistent' },
  6:  { name: 'Shenzhen',   confidence: 'med',  climate_basis: 'Southern coastal; elevated wind 2.40 m/s; high humidity (RH 80%)' },
  7:  { name: 'Chengdu',    confidence: 'low',  climate_basis: '30.2°C, moderate humidity; Sichuan basin; plausible Dingdong expansion city' },
  8:  { name: 'Tianjin',    confidence: 'high', climate_basis: 'RH 58.6% — matches Beijing\'s dry northern profile; 3 stores (small satellite market)' },
  9:  { name: 'Kunshan',    confidence: 'low',  climate_basis: '6 stores; Shanghai–Suzhou corridor city; climate indistinguishable from broader Yangtze Delta' },
  10: { name: 'Changzhou',  confidence: 'low',  climate_basis: '6 stores; very rainy 9.4 mm/day; inland Jiangsu; plausible satellite market' },
  11: { name: 'Ningbo',     confidence: 'med',  climate_basis: '38 stores; rainy 8.1 mm/day; coastal Zhejiang profile consistent' },
  12: { name: 'Hangzhou',   confidence: 'med',  climate_basis: '107 stores; Dingdong #2 market; climate consistent with inland Zhejiang (29°C, RH 77%)' },
  13: { name: 'Guangzhou',  confidence: 'med',  climate_basis: '90 stores; major southern city; warm humid profile (29°C, RH 78%)' },
  14: { name: 'Foshan',     confidence: 'low',  climate_basis: '9 stores; adjacent to Guangzhou; climate nearly identical to city_id 13' },
  15: { name: "Xi'an",      confidence: 'low',  climate_basis: '30.4°C; inland northwest; hot dry summer distinguishable from coastal cities' },
  16: { name: 'Suzhou',     confidence: 'med',  climate_basis: '89 stores; core Yangtze Delta market; climate profile consistent (28°C, RH 77%)' },
  17: { name: 'Jiaxing',    confidence: 'low',  climate_basis: '5 stores; very rainy 9.7 mm/day; between Shanghai and Hangzhou on climate gradient' },
}

/**
 * Returns a display string for a city_id, e.g. "Shanghai (city 0)".
 * Falls back to "City {id}" if the id is not in the map.
 *
 * @param {number|string} id - The city_id value from the dataset
 * @returns {string}
 */
/**
 * Returns a display string including the city ID for unambiguous identification,
 * e.g. "Shanghai (city 0)". Falls back to "City {id}" if unmapped.
 *
 * @param {number|string} id
 * @returns {string}
 */
export function getCityLabel(id) {
  const entry = CITY_MAP[Number(id)]
  if (!entry) return `City ${id}`
  return `${entry.name} (city ${id})`
}

/**
 * Returns just the city name for compact table/chart display.
 * Falls back to "City {id}" if unmapped.
 *
 * @param {number|string} id
 * @returns {string}
 */
export function getCityName(id) {
  const entry = CITY_MAP[Number(id)]
  if (!entry) return `City ${id}`
  return entry.name
}
