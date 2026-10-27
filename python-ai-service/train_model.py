"""
train_model.py
===============
Trains a NEXT-MONTH stock demand model using the ENTIRE available
monthly demand history for every (warehouse, product) combination,
instead of only two lag features.

--------------------------------------------------------------------
WHY THIS VERSION IS DIFFERENT
--------------------------------------------------------------------
The old model used exactly two numeric features:
    previousMonthDemand
    sameMonthLastYearDemand

This version instead builds a rolling time-series feature vector

    month_1, month_2, ..., month_N

where month_1 is the OLDEST month in the lookback window and month_N
is the most recent one. The number of columns (N) is NOT hardcoded.
It is computed automatically from whatever history is available in
monthly_sales_history.csv at training time (MAX_LOOKBACK below). If
you add more months of data next year and retrain, N grows on its
own and the model is retrained with a wider window.

--------------------------------------------------------------------
SLIDING WINDOW TRAINING SAMPLES
--------------------------------------------------------------------
For every warehouse-product combo, every *contiguous* run of months
(no calendar gaps) is turned into many training rows via a sliding
window, e.g. for Jan..Aug:

    Jan Feb Mar             -> predict Apr
    Jan Feb Mar Apr         -> predict May
    Jan Feb Mar Apr May     -> predict Jun
    Jan Feb Mar Apr May Jun -> predict Jul
    ...

The minimum window length is MIN_LOOKBACK (default 3 months) so the
model always has some sequence to learn from. Windows shorter than
the global MAX_LOOKBACK are LEFT-PADDED with zeros, and a
"historyLength" feature tells the model how many of the month_N
columns are real vs. padding, so it can learn to discount padding
rather than being confused by it.

--------------------------------------------------------------------
RUNTIME / LIVE DATA
--------------------------------------------------------------------
This script only trains on the CSV. At prediction time your Flask
service is expected to:
  1. Load demand_model_monthly.pkl (contains the pipeline PLUS the
     metadata needed to rebuild an identical feature vector: the
     max_lookback width, the ordered feature/column names, and the
     min_lookback).
  2. Take the CSV history for a warehouse/product (via
     model_options.json, which is still produced here) and APPEND
     the live month pulled from MongoDB via the Node API (e.g. live
     July 2026 demand) to that combo's history.
  3. Build the same month_1..month_N (+ historyLength) vector from
     that combined history (left-padding the same way) and call
     pipeline.predict(...) to get next month's (e.g. August 2026)
     demand.

Data required: monthly_sales_history.csv with columns:
    warehouseName, productName, category, year, month, monthName,
    season, monthlyDemand

Run:
    python train_model.py

Produces:
    - demand_model_monthly.pkl   (dict: pipeline + feature metadata)
    - model_options.json         (warehouse/product/category choices,
                                   full monthly history per combo, and
                                   the same feature metadata so the
                                   Flask service can reconstruct
                                   vectors identically)

Requirements (one time):
    pip install pandas scikit-learn joblib numpy
"""

import os
import sys
import json
import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestRegressor
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error

# ---------------------------------------------------------------------
# Config — change DATA_PATH to wherever your CSV lives
# ---------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATA_PATH = os.path.join(
    BASE_DIR,
    r'D:\Project\AI-Supply-Chain-Management-System-main\python-ai-service\data\monthly_sales_history.csv'
)
MODEL_PATH = os.path.join(BASE_DIR, "demand_model_monthly.pkl")
OPTIONS_PATH = os.path.join(BASE_DIR, "model_options.json")

MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]

MONTH_SEASON = {
    12: "Winter", 1: "Winter", 2: "Winter",
    3: "Summer", 4: "Summer", 5: "Summer", 6: "Summer",
    7: "Monsoon", 8: "Monsoon", 9: "Monsoon",
    10: "Autumn", 11: "Autumn",
}

# Smallest lookback window allowed to form a training sample.
# (Jan, Feb, Mar -> predict Apr means a minimum window of 3.)
MIN_LOOKBACK = 3

PAD_VALUE = 0.0  # value used to left-pad short history windows

CATEGORICAL_FEATURES = ["warehouseName", "productName", "category", "targetSeason"]
TARGET_COLUMN = "targetDemand"


# ---------------------------------------------------------------------
# Step 1 — load + validate the raw CSV
# ---------------------------------------------------------------------
def load_raw_data():
    if not os.path.exists(DATA_PATH):
        sys.exit(f"Could not find {DATA_PATH}. Update DATA_PATH at the top of this file.")

    df = pd.read_csv(DATA_PATH)

    required_cols = {"warehouseName", "productName", "category", "year", "month", "monthlyDemand"}
    missing = required_cols - set(df.columns)
    if missing:
        sys.exit(f"CSV is missing required columns: {sorted(missing)}")

    # Drop rows with missing essential values rather than crashing.
    before = len(df)
    df = df.dropna(subset=["warehouseName", "productName", "category", "year", "month", "monthlyDemand"])
    df = df.drop_duplicates(subset=["warehouseName", "productName", "year", "month"], keep="last")
    dropped = before - len(df)
    if dropped:
        print(f"Dropped {dropped} row(s) with missing values or duplicate warehouse/product/month entries.")

    df["year"] = df["year"].astype(int)
    df["month"] = df["month"].astype(int)
    df["monthlyDemand"] = df["monthlyDemand"].astype(float)
    df["periodIndex"] = df["year"] * 12 + df["month"]

    return df.sort_values(["warehouseName", "productName", "periodIndex"]).reset_index(drop=True)


# ---------------------------------------------------------------------
# Step 2 — find contiguous (gap-free) runs of months per combo
# ---------------------------------------------------------------------
def find_contiguous_runs(group):
    """
    Given a warehouse-product group sorted by periodIndex, split it
    into a list of contiguous runs (no missing calendar months inside
    a run). Each run is returned as a list of row dicts.

    Sliding windows are only ever built *within* a single run, so a
    gap in history (e.g. a missing month) never silently gets bridged
    with a window that would imply continuity that doesn't exist.
    """
    runs = []
    current_run = []
    prev_period = None

    for _, row in group.iterrows():
        if prev_period is not None and row["periodIndex"] != prev_period + 1:
            if current_run:
                runs.append(current_run)
            current_run = []
        current_run.append(row)
        prev_period = row["periodIndex"]

    if current_run:
        runs.append(current_run)

    return runs


# ---------------------------------------------------------------------
# Step 3 — compute the global MAX_LOOKBACK from the available data
# ---------------------------------------------------------------------
def compute_max_lookback(all_runs):
    """
    The widest usable window is (longest contiguous run length - 1),
    since the last month of a run is always reserved as a prediction
    target. This is computed from the data itself — never hardcoded —
    so adding more history next year automatically widens the model's
    feature vector on the next retrain.
    """
    max_lookback = 0
    for run in all_runs:
        usable = len(run) - 1
        if usable > max_lookback:
            max_lookback = usable
    return max_lookback


# ---------------------------------------------------------------------
# Step 4 — build sliding-window training samples
# ---------------------------------------------------------------------
def build_training_samples(df, max_lookback):
    """
    For every warehouse-product combo and every contiguous run of
    months, generate one training row per valid window length from
    MIN_LOOKBACK up to (run length - 1):

        window of the most recent `w` months -> next month's demand

    Each row's history is left-padded with PAD_VALUE up to
    max_lookback columns (month_1 .. month_{max_lookback}), with
    month_{max_lookback} always being the most recent month in that
    particular window. `historyLength` records how many of those
    columns are real (non-padded) data.
    """
    rows = []
    history_col_names = [f"month_{i+1}" for i in range(max_lookback)]

    grouped = df.groupby(["warehouseName", "productName"], sort=False)

    for (warehouse, product), group in grouped:
        category = group["category"].iloc[0]
        runs = find_contiguous_runs(group)

        for run in runs:
            if len(run) <= MIN_LOOKBACK:
                # Not enough months in this run to form even one sample.
                continue

            demands = [r["monthlyDemand"] for r in run]
            target_months = [r["month"] for r in run]

            # window_end is the index (within `run`) of the LAST month
            # included in the window; the target is the month right
            # after it.
            for window_end in range(MIN_LOOKBACK - 1, len(run) - 1):
                window = demands[: window_end + 1]          # oldest..newest so far
                target_demand = demands[window_end + 1]
                target_month_num = target_months[window_end + 1]

                actual_len = len(window)
                if actual_len > max_lookback:
                    # Use only the most recent max_lookback months if a
                    # run is longer than the global max (shouldn't
                    # normally happen since max_lookback is derived
                    # from the longest run, but kept defensive).
                    window = window[-max_lookback:]
                    actual_len = max_lookback

                pad_count = max_lookback - actual_len
                padded_window = [PAD_VALUE] * pad_count + window

                row = {
                    "warehouseName": warehouse,
                    "productName": product,
                    "category": category,
                    "targetSeason": MONTH_SEASON[target_month_num],
                    "historyLength": actual_len,
                }
                for col_name, value in zip(history_col_names, padded_window):
                    row[col_name] = value
                row[TARGET_COLUMN] = target_demand

                rows.append(row)

    samples = pd.DataFrame(rows)
    return samples, history_col_names


# ---------------------------------------------------------------------
# Step 5 — train the model
# ---------------------------------------------------------------------
def train_model():
    raw = load_raw_data()

    # Compute the global lookback width from every combo's runs.
    all_runs = []
    for _, group in raw.groupby(["warehouseName", "productName"], sort=False):
        all_runs.extend(find_contiguous_runs(group))

    max_lookback = compute_max_lookback(all_runs)
    if max_lookback < MIN_LOOKBACK:
        sys.exit(
            f"Not enough contiguous monthly history to train. Need at least "
            f"{MIN_LOOKBACK + 1} consecutive months for some warehouse/product "
            f"combo, found a max usable window of {max_lookback}."
        )

    print(f"Computed max lookback window from data: {max_lookback} months")

    samples, history_col_names = build_training_samples(raw, max_lookback)

    if len(samples) < 10:
        sys.exit(
            f"Only {len(samples)} training sample(s) could be built. "
            f"Add more monthly history and try again."
        )

    print(f"Built {len(samples)} sliding-window training samples "
          f"from {raw[['warehouseName', 'productName']].drop_duplicates().shape[0]} "
          f"warehouse/product combos.")

    numeric_features = history_col_names + ["historyLength"]

    X = samples[CATEGORICAL_FEATURES + numeric_features]
    y = samples[TARGET_COLUMN]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    preprocessor = ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
        ],
        remainder="passthrough",
    )

    model = Pipeline(steps=[
        ("preprocess", preprocessor),
        ("regressor", RandomForestRegressor(n_estimators=300, random_state=42)),
    ])

    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    print(f"Model trained. Test MAE: {mae:.2f} units")

    # Bundle the pipeline together with everything a downstream service
    # needs to rebuild an IDENTICAL feature vector at prediction time
    # (e.g. after appending a live month pulled from MongoDB).
    model_bundle = {
        "pipeline": model,
        "max_lookback": max_lookback,
        "min_lookback": MIN_LOOKBACK,
        "pad_value": PAD_VALUE,
        "history_columns": history_col_names,
        "categorical_features": CATEGORICAL_FEATURES,
        "numeric_features": numeric_features,
    }

    joblib.dump(model_bundle, MODEL_PATH)
    print(f"Model saved to {MODEL_PATH}")

    save_model_options(raw, max_lookback, history_col_names)


# ---------------------------------------------------------------------
# Step 6 — save model_options.json for the Flask service
# ---------------------------------------------------------------------
def save_model_options(raw, max_lookback, history_col_names):
    """
    Saves everything the Flask/Node side needs:
      - valid warehouse -> [{product, category}] choices
      - the FULL monthly history per combo (so live data can be
        appended to it before predicting)
      - the same feature metadata used at training time, so the
        prediction service builds an identical-shaped vector.
    """
    combos = raw[["warehouseName", "productName", "category"]].drop_duplicates()

    options = {"warehouses": {}}
    for warehouse, group in combos.groupby("warehouseName"):
        options["warehouses"][warehouse] = [
            {"product": row["productName"], "category": row["category"]}
            for _, row in group.iterrows()
        ]

    history = []
    for _, row in raw.iterrows():
        history.append({
            "warehouseName": row["warehouseName"],
            "productName": row["productName"],
            "year": int(row["year"]),
            "month": int(row["month"]),
            "monthlyDemand": float(row["monthlyDemand"]),
        })

    options["history"] = history
    options["monthNames"] = MONTH_NAMES
    options["featureMetadata"] = {
        "maxLookback": max_lookback,
        "minLookback": MIN_LOOKBACK,
        "padValue": PAD_VALUE,
        "historyColumns": history_col_names,
    }

    with open(OPTIONS_PATH, "w") as f:
        json.dump(options, f, indent=2)
    print(f"Options saved to {OPTIONS_PATH}")


if __name__ == "__main__":
    train_model()