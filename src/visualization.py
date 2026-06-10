"""Shared Plotly chart builders used across Streamlit pages."""
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd

CLASS_COLORS = {
    "Ready to Execute": "#22c55e",   # green
    "Merchant Review": "#eab308",    # yellow
    "Localize": "#3b82f6",           # blue
    "Escalate": "#ef4444",           # red
}

BG = "#f8fafc"
GRID = "#e2e8f0"


def _base_layout(fig, title: str = "") -> go.Figure:
    fig.update_layout(
        title=title,
        plot_bgcolor=BG,
        paper_bgcolor="white",
        font=dict(family="Inter, Arial, sans-serif", size=13),
        margin=dict(t=48, b=32, l=48, r=24),
    )
    fig.update_xaxes(gridcolor=GRID, showgrid=True)
    fig.update_yaxes(gridcolor=GRID, showgrid=True)
    return fig


def class_distribution_pie(df: pd.DataFrame) -> go.Figure:
    counts = df["recommendation_class"].value_counts().reset_index()
    counts.columns = ["class", "count"]
    fig = px.pie(
        counts, names="class", values="count",
        color="class", color_discrete_map=CLASS_COLORS,
        hole=0.45,
    )
    fig.update_traces(textposition="outside", textinfo="percent+label")
    return _base_layout(fig, "Recommendation Mix")


def class_distribution_bar(df: pd.DataFrame) -> go.Figure:
    counts = df["recommendation_class"].value_counts().reset_index()
    counts.columns = ["class", "count"]
    fig = px.bar(
        counts, x="class", y="count", color="class",
        color_discrete_map=CLASS_COLORS, text="count",
    )
    fig.update_traces(textposition="outside")
    return _base_layout(fig, "SKU-Store Counts by Class")


def readiness_score_histogram(df: pd.DataFrame) -> go.Figure:
    fig = px.histogram(
        df, x="readiness_score", color="recommendation_class",
        nbins=40, color_discrete_map=CLASS_COLORS, barmode="overlay",
        opacity=0.75,
    )
    return _base_layout(fig, "Readiness Score Distribution")


def feature_radar(row: pd.Series) -> go.Figure:
    features = [
        "velocity_score", "consistency_score", "localization_score",
        "recovered_demand_score", "promo_independence_score",
        "low_volatility_score", "low_stockout_risk_score",
    ]
    labels = [
        "Velocity", "Consistency", "Localization",
        "Recovered Demand", "Promo Independence",
        "Low Volatility", "Low Stockout",
    ]
    values = [row.get(f, 0) for f in features]
    values += values[:1]
    labels_closed = labels + [labels[0]]
    fig = go.Figure(
        go.Scatterpolar(r=values, theta=labels_closed, fill="toself",
                        line_color=CLASS_COLORS.get(row.get("recommendation_class", ""), "#6366f1"))
    )
    fig.update_layout(
        polar=dict(radialaxis=dict(visible=True, range=[0, 100])),
        paper_bgcolor="white",
        showlegend=False,
        margin=dict(t=32, b=32, l=32, r=32),
    )
    return fig


def sales_trend_line(daily_df: pd.DataFrame, sku: str, store: str,
                     sku_col: str = "product_id", store_col: str = "store_id") -> go.Figure:
    sub = daily_df[(daily_df[sku_col] == sku) & (daily_df[store_col] == store)].copy()
    sub = sub.sort_values("dt")
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=sub["dt"], y=sub["daily_sales"],
                             name="Observed Sales", line=dict(color="#3b82f6")))
    if "stockout_rate" in sub.columns:
        fig.add_trace(go.Bar(x=sub["dt"], y=sub["stockout_rate"] * sub["daily_sales"].max(),
                             name="Stockout Rate (scaled)", marker_color="#ef4444",
                             opacity=0.35, yaxis="y"))
    return _base_layout(fig, f"Daily Sales — SKU {sku} | Store {store}")


def demand_waterfall(row: pd.Series) -> go.Figure:
    observed = row.get("observed_units", 0)
    recovered = row.get("recovered_units", 0)
    fig = go.Figure(go.Waterfall(
        x=["Observed Sales", "Recovered (Stockout)", "Estimated True Demand"],
        measure=["absolute", "relative", "total"],
        y=[observed, recovered, 0],
        connector=dict(line=dict(color="#94a3b8")),
        increasing=dict(marker_color="#22c55e"),
        totals=dict(marker_color="#3b82f6"),
    ))
    return _base_layout(fig, "Observed vs. Estimated Demand")


def hhi_bar(weekly_df: pd.DataFrame, city_col: str = "city_id",
            sku_col: str = "sku_id") -> go.Figure:
    city_sales = (
        weekly_df.groupby([sku_col, city_col])["observed_units"]
        .sum().reset_index()
    )
    sku_totals = city_sales.groupby(sku_col)["observed_units"].sum().rename("sku_total")
    city_sales = city_sales.join(sku_totals, on=sku_col)
    city_sales["share"] = city_sales["observed_units"] / city_sales["sku_total"].replace(0, 1)
    hhi = (
        city_sales.groupby(sku_col)["share"]
        .apply(lambda s: round((s**2).sum(), 3))
        .reset_index(name="hhi")
        .sort_values("hhi", ascending=False)
        .head(30)
    )
    fig = px.bar(hhi, x=sku_col, y="hhi",
                 color="hhi", color_continuous_scale="RdYlGn_r",
                 labels={"hhi": "HHI (1=fully concentrated)"})
    return _base_layout(fig, "Top 30 SKUs by Geographic Concentration (HHI)")


def stockout_by_city(df: pd.DataFrame, city_col: str = "city_id") -> go.Figure:
    agg = df.groupby(city_col)["stockout_rate"].mean().reset_index()
    fig = px.bar(agg.sort_values("stockout_rate", ascending=False),
                 x=city_col, y="stockout_rate",
                 color="stockout_rate", color_continuous_scale="Reds",
                 labels={"stockout_rate": "Avg Stockout Rate"})
    return _base_layout(fig, "Average Stockout Rate by City")
