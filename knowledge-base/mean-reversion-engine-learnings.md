# SPX Mean Reversion Engine — ML & Engineering Knowledge Extraction

**Source**: `mean-reversion/` (deleted 2026-05-06)
**Status at deletion**: V3 complete (gate classifier + dual expert survival + quantile ensemble)
**Scope**: Architecture, feature engineering, model training, live integration, lessons learned

---

## 1. V3 Architecture & Rationale

### Evolution: V1 → V2 → V3

| Version | Problem | Innovation |
|---------|---------|-----------|
| V1 | Always predicted 7 days | Unimodal assumption on bimodal data |
| V2 | Catastrophic failures (predicted 7d for 496d bear events) | Survival analysis + HMM regime, still unimodal |
| V3 | Bimodal: 70% recoveries 2–14d, 30% in months/years | **Gate classifier routes to dual experts** |

### Core V3 Pipeline

```
1. Gate Classifier (XGBoost binary)
   └── P(pullback) vs P(bear)         ← 82% accuracy
2. Dual Expert Survival Models (GradientBoostingSurvivalAnalysis)
   ├── Expert 1: events with recovery ≤ 60d (pullback-like)
   └── Expert 2: events with recovery > 60d or never (bear-like)
3. 5 Quantile LightGBM Regressors
   └── q10, q50, q75, q90, q95 (uncertainty bands via pinball loss)
4. Backward-compat shim duck-types V3 prediction as V2Prediction
```

**Why this works**:
- Single model trying to fit bimodal distribution = conflicting predictions
- Gate classifier picks regime first; experts trained on regime-specific data
- Quantile regression gives proper uncertainty bands, not just point estimates

---

## 2. Feature Engineering (31 Features)

### Composition

```python
FEATURE_NAMES = [
    # Drawdown characteristics (3)
    "drop_magnitude",            # positive % drop
    "drop_speed",                # trading days high→trough
    "drawdown_speed_ratio",      # drop_magnitude / drop_days

    # Volatility (5)
    "vix_level", "vix_percentile",  # rolling 252d
    "vix_lag_2d", "vix_lag_3d",
    "vix_change_5d",

    # Momentum (5)
    "rsi_2", "rsi_14",
    "prior_20d_return", "prior_60d_return",
    "consecutive_down_days",

    # Trend Context (3)
    "dist_from_50dma", "dist_from_200dma",
    "drawdown_from_ath",

    # Volume / Range (3)
    "volume_ratio",                  # vs 20d avg
    "intraday_range_pct",            # (H-L)/C
    "intraday_range_vs_avg",         # vs 20d avg range

    # Statistical (2)
    "hurst_exponent",                # 252d window — MR strength
    "ou_half_life",                  # 252d window — MR speed

    # HMM Regime (5)
    "regime_state", "days_in_regime",
    "regime_transition_prob",
    "regime_volatility", "regime_mean_return",

    # FRED Macro (5) — V3 addition
    "yield_curve_10y2y",             # T10Y2Y — recession signal
    "yield_curve_slope_20d",         # 20-day diff
    "credit_spread_hy",              # BAMLH0A0HYM2 — high-yield spread
    "credit_spread_change_20d",
    "unemployment_claims_4w_avg",    # ICSA 4-week MA
]
```

### Precomputation Strategy
- Rolling features (RSI, MAs, Hurst, OU) computed ONCE per full history
- Looked up per event during featurization
- All features use ONLY data available at trough_date — no lookahead bias

---

## 3. Training Pipeline (V3)

### Walk-Forward Validation

```python
IN_SAMPLE_SIZE = 1000        # ~4y trading days
OUT_OF_SAMPLE_SIZE = 250     # ~1y
STEP_SIZE = 250
IN_SAMPLE_BEAR = 200         # smaller window — fewer bear samples
QUANTILE_ALPHAS = [0.10, 0.50, 0.75, 0.90, 0.95]
```

### Time-Decay Weighting (5-year half-life)
```python
weights = exp(-0.693 * days_ago / half_life_days)
# 2021+ data ≈ 2x weight of 2005 data
# GFC (2008) stays at ~0.3x — still useful for rare events
```

### Gate Classifier (XGBoost Binary)

```python
gate_labels = [
    1 if (recovery_100_days is None or recovery_100_days > 60) else 0
    for e in events
]

params = {
    "objective": "binary:logistic",
    "max_depth": 3,
    "n_estimators": 150,
    "learning_rate": 0.05,
    "scale_pos_weight": n_pullback / max(n_bear, 1),  # imbalance fix
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "reg_alpha": 1.0,
    "reg_lambda": 5.0,
    "random_state": 42,
}
```

**Result**: AUC 0.82, P/R both >0.80 on 2020+ data.

### Pullback Expert (Survival)
```python
gbs_params_pullback = {
    "n_estimators": 200,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "random_state": 42,
}
# Trained on recovery_100_days <= 60
```

### Bear Expert (Survival)
```python
gbs_params_bear = {
    "n_estimators": 100,    # smaller — ~265 bear events vs ~2000+ pullback
    "max_depth": 3,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "random_state": 42,
}
# Trained on recovery_100_days > 60 OR None (censored)
```

**Gotcha**: `GradientBoostingSurvivalAnalysis` crashes on NaN. Median-impute per feature before fit.

### Quantile LightGBM Ensemble
```python
for alpha in [0.10, 0.50, 0.75, 0.90, 0.95]:
    lgb_params = {
        "objective": "quantile",
        "alpha": alpha,
        "max_depth": -1,
        "num_leaves": 31,
        "n_estimators": 200,
        "learning_rate": 0.03,
        "reg_alpha": 5.0,       # L1
        "reg_lambda": 20.0,     # L2
        "min_child_samples": 15,
        "random_state": 42,
        "verbosity": -1,
    }
```

**Loss**: Pinball (asymmetric) — `α·max(y-ŷ,0) + (1-α)·max(ŷ-y,0)`. Native LightGBM support.

---

## 4. Event Detection & Labeling

### Drawdown Detection
```python
ROLLING_WINDOWS = [1, 2, 3, 5, 10, 20]  # days

# Scan each window independently → dedup events with troughs <5d apart, keep deepest
```

### DrawdownEvent Schema
```python
@dataclass
class DrawdownEvent:
    start_date, trough_date: date
    recovery_25_date, recovery_50_date, recovery_75_date, recovery_100_date: date | None
    drop_pct: float                  # negative
    drop_days: int                   # high→trough
    recovery_25_days, recovery_50_days, recovery_75_days: int | None
    recovery_100_days: int | None    # PRIMARY TARGET for survival models
    vix_at_trough: float | None
    pre_drop_momentum_20d, pre_drop_momentum_60d: float
```

### Survival Censoring
For events with no full recovery observed: duration = days_since_trough, `event_observed=False`. Standard right-censoring.

---

## 5. FRED Macro Integration

### Series Used
```python
FRED_SERIES = {
    "T10Y2Y":      "yield_curve_10y2y",   # 10Y - 2Y Treasury
    "BAMLH0A0HYM2": "credit_spread_hy",   # High-yield spread
    "UNRATE":      "unemployment_rate",   # Monthly
    "ICSA":        "initial_claims",      # Weekly
}
```

### Cadence + Fallback
- Monthly/weekly resampled to daily via forward-fill
- Requires `FRED_API_KEY` env var
- Non-fatal: if FRED unavailable, trains with 26 features instead of 31
- Incremental fetch: only new dates

### Rationale
- Yield curve flattening/inversion → bear precursor
- Credit spread widening → systemic stress
- Unemployment claims → labor market weakness
- Together: separate "buyable dip" from "bear entry"

---

## 6. HMM Regime Detection

### 3-Feature Matrix
```python
returns = np.diff(np.log(spx_close))
vix_norm = (vix - mean) / std
range_norm = ((H-L)/C - mean) / std
features = stack([returns, vix_norm, range_norm])
```

### BIC Auto-Selection
Tries n_components 2–5; picks min BIC. **Balance-aware** — retries with different seeds until no state < 10% of obs (avoids degenerate solutions).

### Regime Labels (by n_components)
| n | Labels |
|---|--------|
| 2 | LOW_VOL, HIGH_VOL |
| 3 | LOW_VOL, MEDIUM_VOL, HIGH_VOL |
| 4 | QUIET_BULL, NORMAL, CHOPPY, CRISIS |
| 5 | QUIET_BULL, NORMAL_BULL, CHOPPY, CORRECTION, CRISIS |

### Mean-Reversion Reliability Mapping
```python
_get_mr_reliability = {
    2: {0: "HIGH", 1: "LOW"},
    3: {0: "HIGH", 1: "MODERATE", 2: "LOW"},
    4: {0: "HIGH", 1: "HIGH", 2: "MODERATE", 3: "LOW"},
    5: {0: "HIGH", 1: "HIGH", 2: "MODERATE", 3: "LOW", 4: "LOW"},
}
```

---

## 7. Live Schwab Integration (separate from calendar plugin)

### Config
```python
SCHWAB_APP_KEY = os.getenv("SCHWAB_APP_KEY")
SCHWAB_APP_SECRET = os.getenv("SCHWAB_APP_SECRET")
SCHWAB_CALLBACK_URL = os.getenv("SCHWAB_CALLBACK_URL", "https://127.0.0.1:8182")
SCHWAB_TOKEN_PATH = os.getenv("SCHWAB_TOKEN_PATH", "./schwab_token.json")
```

### Token Mgmt
- Loads `schwab_token.json` if valid
- Browser OAuth via `schwab-py` `auth.easy_client()`
- 7-day token TTL — re-run module to refresh

### Data Provider Interface
```python
class SchwabProvider(DataProvider):
    def get_current_price(self) -> float        # SPX
    def get_current_vix(self) -> float
    def get_daily_history(start, end) -> DataFrame  # 1-min bars (limited history)
    def get_options_chain(symbol, exp_date) -> DataFrame
```

**Gotcha**: Options chain empty after hours → fall back to SPY chain × 10 strikes.

---

## 8. Backtest Harness

### Logic
```python
def run_backtest(start_date=date(2020,1,1), max_events=50):
    # For each historical drawdown after start_date:
    # 1. Compute features
    # 2. Run prediction (V3 if available, else V2)
    # 3. Compare predicted DTE vs actual recovery_100_days
    # 4. Track gate accuracy (correctly labeled bear?)
    # 5. Track catastrophic failures (predicted <30d, actual >200d)
```

### V3 Metrics
| Metric | Definition |
|--------|-----------|
| Gate Accuracy | % events where (gate_bear_prob > 0.5) matches (actual > 60d) |
| Bimodal Flag | YES if `q90 / q50 > 5` (high uncertainty) |
| Median Error | `|predicted_dte - actual_recovery_100_days|` |
| Catastrophic | Count of (pred < 30d AND actual > 200d) |

**V3 Result**: Gate accuracy 82%, zero catastrophic, median error 84d (overpredicts pullbacks — gate sometimes mislabels).

---

## 9. CLI

```bash
./mr tui          # Default — Textual TUI
./mr analyze      # CLI report
./mr download     # Update SPX + VIX data
./mr train        # Train V3 models walk-forward
./mr tables       # Historical lookup tables
./mr live         # TUI with live Schwab data
./mr backtest     # V3 vs V2 backtest
./mr help
```

---

## 10. Test Infrastructure (153 tests)

```
tests/test_data_and_drawdowns.py        # Data loading, FRED, drawdown detection
tests/test_features_and_regime.py        # Features (no lookahead), HMM
tests/test_models_and_prediction.py      # Gate, experts, quantiles, V3 shim
```

Coverage: incremental updates, dedup, no-lookahead invariants, BIC model selection, walk-forward validation, pinball loss, V3→V2 backward-compat shim.

---

## 11. Critical Limitations (V4 Backlog)

### CRITICAL
1. **DTE recommendation useless** — V3 says "206 days, range 7–203"; user trades 7/14/21/30/45/75. **Fix**: probability table at each user DTE, not single number.
2. **First passage time unsolved** — Real question: "When will SPX hit 6500?" not "Will today's drop revert?". Need interpolation OR Monte Carlo.
3. **Live polling not implemented** — TUI loads once, never refreshes. Should poll Schwab every 30–60s; re-run analysis only on >0.5% drawdown change.
4. **Overpredicts recovery time (84d median error)** — Gate threshold tuning (0.5→0.3), SMOTE, or single model with macro features.

### MEDIUM
5. **Intraday data unused** — All features from daily closes. 48d Schwab history available — could build opening range stats once accumulated.

---

## 12. Kaggle Research Insights (`kaggle_research/`)

### Competition Winners Studied
- **Jane Street 1st**: Supervised Autoencoder + MLP ensemble
- **Optiver RV 1st**: Nearest-neighbor feature engineering (key)
- **Optiver Close 1st**: XGBoost + LightGBM, time-based splits, order book features
- **Ubiquant 1st**: LightGBM + TabNet (attention)
- **Two Sigma 5th**: ExtraTrees + Ridge, regime-adaptive weighting

### Winning Patterns
1. Feature engineering > model complexity
2. LightGBM/XGBoost dominate
3. NN that work: Supervised AE, TabNet, BatchNorm+Dropout MLPs
4. NN that don't: RNN/LSTM (avoid)
5. Validation: Purged Time Series CV (purge gap between train/test)
6. Regime awareness (separate models per regime, dynamic weighting)
7. Ensemble: GBDT + NN, multiple GBDT variants

### Already Applied
- Regime detection (HMM)
- Walk-forward CV
- Dual-expert routing

### Worth Adding (Future)
- Supervised autoencoder for feature extraction
- Nearest-neighbor feature aggregation (Optiver RV innovation)

---

## 13. Python Stack

```
pandas>=2.0, numpy>=1.24
yfinance>=0.2.30                 # SPX/VIX download
scipy>=1.11, statsmodels>=0.14
xgboost>=2.0, scikit-learn>=1.3
lightgbm                         # quantile regression native
hmmlearn>=0.3, joblib>=1.3
schwab-py>=1.0                   # Schwab API
fredapi>=0.5.2                   # FRED macro
textual>=0.40, rich>=13.0        # TUI
python-dotenv>=1.0
sksurv                           # GradientBoostingSurvivalAnalysis
```

---

## 14. Model Files

```
models/
  gate_classifier.joblib            # XGBoost gate
  expert_pullback.joblib            # GBS recovery ≤60d
  expert_bear.joblib                # GBS recovery >60d
  quantile_q10.joblib ... q95       # 5 LGBM quantiles
  hmm_regime.joblib                 # Gaussian HMM
  gmm_regime.joblib                 # GMM (optional, unused)
  training_report.json              # CV metrics, feature names, dates
```

### training_report.json Schema
```json
{
  "trained_at": "ISO timestamp",
  "architecture": "V3 Gate-Expert + Quantile Ensemble",
  "n_events": 2841,
  "n_features": 31,
  "feature_names": [...],
  "fred_available": true,
  "walk_forward": {
    "in_sample_size": 1000, "in_sample_bear": 200,
    "out_of_sample_size": 250, "step_size": 250,
    "n_splits_main": 8, "n_splits_pullback": 8, "n_splits_bear": 2
  },
  "gate_classifier":   { "auc_mean": 0.82, "precision_mean": 0.80, "recall_mean": 0.81 },
  "expert_pullback":   { "c_index_mean": 0.72 },
  "expert_bear":       { "c_index_mean": 0.65 },
  "quantile_ensemble": { "q10_pinball_mean": 2.3, "q50_pinball_mean": 5.1 }
}
```

---

## 15. File Map (Pre-Deletion Reference)

| Subsystem | Path | Lines |
|-----------|------|-------|
| Feature engineering (31 features) | `src/core/feature_engineering.py` | 27-74, 94-243 |
| V3 training pipeline | `src/core/train_model.py` | 448-768 |
| Walk-forward CV + time decay | `src/core/train_model.py` | 82-126 |
| Gate classifier | `src/core/train_model.py` | 149-243 |
| Expert survival | `src/core/train_model.py` | 251-350 |
| Quantile regression | `src/core/train_model.py` | 357-440 |
| Drawdown detection | `src/core/drawdown_detector.py` | 34-142 |
| FRED integration | `src/core/data_pipeline.py` | 177-250 |
| Schwab live | `src/live/schwab_client.py` | 74-150 |
| HMM regime | `src/core/regime_detector.py` | 124-200 |
| Backtest | `src/core/backtest.py` | 13-115 |
| Kaggle research | `kaggle_research/RESEARCH_REPORT.md`, `V3_MODEL_FINDINGS.md` | — |

---

## 16. Summary

### What Works
- Gate classifier 82% accuracy
- Zero catastrophic failures (vs V2 predicting 7d for 496d bear)
- FRED macro features predictive
- Walk-forward + time decay prevents lookahead bias

### What Doesn't
- DTE recommendation not actionable (user trades discrete DTEs)
- Overpredicts recovery time 84d (gate misclassification)
- Live polling not delivered
- First passage time unsolved

### Architecture Wins
- Dual expert routing for bimodal data
- Quantile regression for uncertainty
- BIC auto-selection eliminates manual HMM tuning
- Backward-compat shim allows V3↔V2 duck-typing

### For Next System (V4 or successor)
- Probability table at user-traded DTEs (7/14/21/30/45/75) instead of point estimate
- First passage time research — Monte Carlo or analytical
- Implement live polling (Textual `set_interval`)
- Supervised autoencoder for feature extraction
- Nearest-neighbor feature aggregation
