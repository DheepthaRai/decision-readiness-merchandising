# Decision Readiness Scoring for Merchandising Operations

A decision-support tool that scores every SKU-store combination on eight supply and demand health dimensions, classifies each into an action class, and presents results in an interactive React dashboard deployed to GitHub Pages.

> **Disclaimer:** Scores are decision-support tools, not auto-decisions. Spoilage/waste is unobserved. Vendor risk is proxied via stockout rate. All recommendations require human review.

---

## Business Problem

Fresh-retail buyers must decide weekly which products to range, reorder, or localize across hundreds of stores. The volume of SKU-store combinations (50 K+ per week) makes manual review impractical. This tool computes a **0–100 Decision Readiness Score** for every SKU-store-week and classifies each into one of four actionable classes: **Ready to Execute**, **Merchant Review**, **Localize**, or **Escalate**. Merchants focus attention where it matters most.

---

## Dataset

| Property | Value |
|---|---|
| Source | [Dingdong-Inc/FreshRetailNet-50K](https://huggingface.co/datasets/Dingdong-Inc/FreshRetailNet-50K) |
| Rows | ~4.85 M daily SKU-store rows |
| Granularity | Daily, with 24-element hourly arrays for sales and stock status |
| Key columns | `product_id`, `store_id`, `city_id`, `dt`, `sale_amount`, `hours_sale` (array), `hours_stock_status` (array), `discount`, `holiday_flag`, `activity_flag`, weather features |
| License | CC-BY-4.0 |

Column name mappings are defined in `config.yaml` under `columns:` — change them there if the dataset schema evolves.

---

## Methodology

### 1. Preprocessing
Hourly arrays are exploded into individual rows (one per SKU-store-date-hour), date features are extracted (DOW, week, weekend, period), IDs are standardized to strings, and negative sales and duplicate rows are removed. Missing weather values are imputed using city-day averages then the global mean.

### 2. Feature Engineering
Hourly rows are aggregated to daily and weekly SKU-store tables. Eight raw feature signals are computed:

| Feature | Signal |
|---|---|
| `sales_velocity_score` | Average daily units sold |
| `demand_consistency_score` | Fill rate × (1 − CV/2) — penalizes erratic demand |
| `stockout_risk_score` | Fraction of operational hours (6–22) with zero stock |
| `recovered_demand_opportunity_score` | Estimated lost demand as share of true demand (computed after demand recovery in step 3) |
| `promotion_dependency_score` | Fraction of days with an active promotion |
| `localization_fit_score` | 1 − HHI — where HHI measures geographic demand concentration |
| `volatility_risk_score` | Coefficient of variation of daily sales |
| `freshness_risk_proxy` | Combined stockout + CV signal (spoilage is unobserved — this is a proxy) |

### 3. Demand Recovery (Censored Demand Imputation)
Stockout hours create censored observations — we cannot see true demand when shelves are empty. Expected hourly demand is estimated using a fallback hierarchy:

1. **L1 — SKU-store-hour:** mean sales at the same hour-of-day and day-of-week when in stock (requires ≥ 3 observations)
2. **L2 — SKU-store overall:** mean in-stock hourly sales across all hours
3. **L3 — City average:** mean in-stock hourly sales for the same SKU across the city
4. **L4 — Global average:** mean in-stock hourly sales across all SKUs and stores

Recovered units = estimated demand during stockout hours − observed sales during those hours.

### 4. Readiness Scoring
All seven scoring components are **percentile-ranked** (0–100) within each weekly snapshot so scores are peer-relative. The final score is a weighted sum:

```
Score = 0.25 × velocity
      + 0.20 × consistency
      + 0.15 × localization_fit
      + 0.15 × recovered_demand_opportunity
      + 0.10 × promo_independence
      + 0.10 × low_volatility
      + 0.05 × low_stockout_risk
```

Weights are configurable in `config.yaml` under `scoring.weights`.

> **Note:** `freshness_risk_proxy` is computed for diagnostic purposes and shown in the dashboard but is not included in the readiness score formula above.

### 5. Classification Rules
Priority order — first match wins. **All thresholds are calibrated to the FreshRetailNet-50K dataset** (median stockout rate 84.7%; configurable in `config.yaml` under `thresholds`):

| Class | Trigger | Default threshold |
|---|---|---|
| **Escalate** | Stockout rate ≥ escalate threshold, OR recovered demand ≥ 90% of estimated demand, OR < 2 active days | `escalate_min_stockout: 0.97` (≈ 95th pct of dataset) |
| **Localize** | HHI ≥ localize threshold (demand concentrated in few cities) | `localize_min_hhi: 0.75` (top ~30% of HHI) |
| **Ready to Execute** | Score ≥ ready threshold, stockout < max stockout, volatility pct < max, promo pct < max | `ready_min_score: 62` (≈ 75th pct of scores) |
| **Merchant Review** | Score ≥ review threshold (does not meet Ready conditions) | `review_min_score: 38` (≈ 25th pct) |
| **Escalate** (default) | Score < review threshold | — |

> ⚠️ If you run this pipeline on a different dataset, recalibrate the thresholds. A general retail dataset with typical stockout rates of 5–30% will classify nearly everything as Escalate at the defaults above, which are calibrated for a fresh produce context with endemic 85%+ stockout rates.

### 6. Dashboard
Five-page React + Vite application (no backend — all data from static CSVs):

| Page | Route | Content |
|---|---|---|
| Executive Overview | `/` | KPI cards, class distribution bar, score histogram, top SKUs/cities |
| Product Readiness | `/readiness` | Sortable filterable table, expandable detail panels with component scores |
| Localization Analysis | `/localization` | Demand by city, HHI gauge, store ranking table, localization recommendation |
| Risk Diagnostics | `/risk` | Stockout/promo/volatility charts, escalation queue with suggested actions |
| Recommendation Simulator | `/simulator` | Weight sliders + threshold controls, live before/after comparison, CSV export |

### 7. Pipeline Outputs
- `outputs/schema_profile.csv` — column-level data quality report
- `data/interim/clean_hourly_sales.parquet` — cleaned hourly rows
- `data/processed/daily_sku_store.parquet` — daily SKU-store aggregates
- `data/processed/weekly_sku_store.parquet` — weekly features
- `data/processed/weekly_sku_store_recovered_demand.parquet` — demand recovery
- `data/processed/scored_weekly.parquet` — scored rows
- `outputs/product_store_recommendations.csv` — final recommendations (also copied to `frontend/public/data/` for the dashboard)

---

## Running Locally

### Prerequisites
```
Python 3.10+   Node 18+
```

### 1. Clone and install Python dependencies
```bash
git clone https://github.com/DheepthaRai/decision-readiness-merchandising
cd decision-readiness-merchandising
pip install -r requirements.txt
```

### 2. Run the data pipeline

```bash
# Full run — train split (~4.5M rows, 10–20 min)
python run_pipeline.py

# Fast run — eval split (~350K rows, recommended for development)
python run_pipeline.py --split eval

# Run pipeline AND copy CSVs to frontend automatically
python run_pipeline.py --split eval --copy-to-frontend
```

### 3. Copy outputs to frontend (skip if you used `--copy-to-frontend`)
```bash
mkdir -p frontend/public/data
cp outputs/*.csv frontend/public/data/
```

### 4. Run the React dev server
```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173/decision-readiness-merchandising/
```

### Using your own CSV

The dashboard reads from `frontend/public/data/product_store_recommendations.csv`. The file must have these columns (names are fixed; types are flexible):

| Column | Description |
|---|---|
| `sku_id` | Product identifier |
| `store_id` | Store identifier |
| `city_id` | City identifier (integer 0–17 for FreshRetailNet; any integer for custom data) |
| `week_label` | Week string (e.g. `2024-W26`) |
| `readiness_score` | 0–100 float |
| `recommendation_class` | One of: `Ready to Execute`, `Merchant Review`, `Localize`, `Escalate` |
| `stockout_rate` | Float 0–1 |
| `estimated_true_demand` | Float, units |
| `observed_units` | Float, units |
| `recovered_units` | Float, units |

Drop your CSV at `frontend/public/data/product_store_recommendations.csv`, run `npm run dev`, and the dashboard will load it. City names in the UI are resolved via `frontend/src/utils/cityMap.js` — update that file if your `city_id` values differ from the FreshRetailNet mapping.

---

## Deploying to GitHub Pages

### Automatic (recommended)
Every push to `main` triggers `.github/workflows/deploy.yml` which:
1. Runs `python run_pipeline.py --split eval` to generate CSVs
2. Copies `outputs/*.csv` → `frontend/public/data/`
3. Runs `npm run build` inside `frontend/`
4. Deploys `frontend/dist/` to the `gh-pages` branch

One-time setup: in repo Settings → Pages, set source to **gh-pages branch**.

### Manual deploy
```bash
# Make sure CSVs are in frontend/public/data/ first (see step 3 above)
cd frontend
npm run build    # → frontend/dist/
npm run deploy   # pushes dist/ to gh-pages via gh-pages npm package
```

Live URL after deploy:
```
https://<your-github-username>.github.io/decision-readiness-merchandising/
```

---

## Limitations

- **Spoilage and waste are not observed.** The `freshness_risk_proxy` is estimated from stockout frequency and sales volatility; actual waste volumes are unknown. Do not use this score to make waste-reduction claims.
- **Scores are decision-support, not auto-decisions.** The readiness score is a relative ranking within the week's data. A score of 80 means a SKU-store is in the top quintile of that week's cohort, not that it will definitely sell well. Merchant judgment is required before ranging decisions.
- **Vendor risk is proxied.** Supplier reliability is not present in the dataset. The stockout and demand recovery signals partially capture supply instability but do not distinguish vendor-caused outages from demand surges.
- **Demand recovery is an estimate.** The fallback imputation hierarchy assumes that in-stock hourly averages are a reasonable proxy for stockout counterfactuals. If stockouts are systematic (e.g., always out in peak hours), the fallback will underestimate true demand.
- **No causal identification.** Promotional effects are flagged but not causally estimated. `promotion_dependency_score` measures correlation between promotion days and sales, not uplift.
- **Data covers one geography.** FreshRetailNet-50K covers Dingdong Inc.'s operating cities; findings may not generalize to other retail formats or geographies.
- **Thresholds are dataset-specific.** All classification thresholds are calibrated to the FreshRetailNet-50K distribution. Applying them to a different dataset without recalibration will produce misleading results (see the warning in Section 5 above).

---

## City Proxy Mapping

The FreshRetailNet-50K dataset anonymises all geographic identifiers, using integer `city_id` values 0–17 in place of real city names. **No official mapping is published by the dataset authors.**

The mapping used in this dashboard is **inferred from climate fingerprinting**: daily weather observations embedded in the raw parquet (temperature, relative humidity, precipitation, wind speed) for the late-June / early-July 2024 evaluation period were compared against published historical climatology for cities in Dingdong's known operating footprint.

### Methodology

1. **Store count anchoring** — Dingdong's HQ market (Shanghai, ~290 stores) and second market (Hangzhou, ~107 stores) are identified by store count before any climate analysis.
2. **Humidity as primary discriminator** — Relative humidity (RH) in late June is the strongest single signal. Northern cities (Beijing, Tianjin) have RH ≈ 58–60%, uniquely drier than all southern and eastern cities (RH > 70%).
3. **Temperature ordering** — Chongqing stands out as the hottest location at 31°C+; the Guangdong cities (Shenzhen, Guangzhou) cluster at 29°C with high humidity; northern cities are cooler at the tail.
4. **Precipitation patterns** — Nanjing and Jiaxing/Changzhou are rainiest (≈ 9–11 mm/day); Guangdong cities are drier despite high humidity.

### Mapping Table

| city_id | Proxy City | Confidence | Key Signal |
|---------|------------|------------|------------|
| 0  | Shanghai   | **HIGH** | 290 stores; Dingdong HQ; 28.8°C, RH 79.7% |
| 1  | Changsha   | LOW  | 30.4°C, RH 76.8%; hot inland central China |
| 2  | Chongqing  | LOW  | Hottest at 31.0°C; mountain basin heat island |
| 3  | Beijing    | **HIGH** | RH 60.0% — uniquely dry; only large city below 70% RH |
| 4  | Nanjing    | MED  | Highest precipitation 10.6 mm/day |
| 5  | Wuhan      | LOW  | 29.2°C, RH 78.5%; "furnace city" summer profile |
| 6  | Shenzhen   | MED  | Southern coastal; elevated wind 2.40 m/s |
| 7  | Chengdu    | LOW  | 30.2°C, moderate humidity; Sichuan basin |
| 8  | Tianjin    | **HIGH** | RH 58.6% — matches Beijing dry northern profile; 3 stores |
| 9  | Kunshan    | LOW  | 6 stores; Shanghai–Suzhou corridor |
| 10 | Changzhou  | LOW  | 6 stores; very rainy 9.4 mm/day; inland Jiangsu |
| 11 | Ningbo     | MED  | 38 stores; rainy 8.1 mm/day; coastal Zhejiang |
| 12 | Hangzhou   | MED  | 107 stores; Dingdong #2 market |
| 13 | Guangzhou  | MED  | 90 stores; major southern city |
| 14 | Foshan     | LOW  | 9 stores; adjacent to Guangzhou; nearly identical climate |
| 15 | Xi'an      | LOW  | 30.4°C; hot dry inland northwest summer |
| 16 | Suzhou     | MED  | 89 stores; core Yangtze Delta market |
| 17 | Jiaxing    | LOW  | 5 stores; very rainy 9.7 mm/day; between Shanghai and Hangzhou |

### Disclaimer

⚠️ **This mapping has not been confirmed by Dingdong-Inc or the FreshRetailNet-50K dataset authors.** It is a climate-inference proxy used for portfolio demonstration purposes. Do not use it for operational decisions or to make geographic attribution claims about the underlying data.

The complete mapping is stored in `config.yaml` under `city_proxy_map` and in `frontend/src/utils/cityMap.js`. City names are displayed without confidence suffixes in the UI; the raw `city_id` is preserved in filter dropdowns for cross-referencing with the underlying CSV.

---

Check it out here: [Decision Readiness MerchOps](https://dheeptharai.github.io/decision-readiness-merchandising)

---

Built for class final project — [MEM 410: Managerial Analytics](https://www.mccormick.northwestern.edu/engineering-management/curriculum/descriptions/410.html) by [Prof. Mike Watson](https://www.mccormick.northwestern.edu/research-faculty/directory/profiles/watson-michael.html)
