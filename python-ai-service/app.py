from datetime import datetime
import json
import os

from flask import Flask, jsonify, request
import joblib
import pandas as pd
from zoneinfo import ZoneInfo

app = Flask(__name__)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "demand_model_monthly.pkl")
OPTIONS_PATH = os.path.join(BASE_DIR, "model_options.json")

MONTH_SEASON = {
    12: "Winter", 1: "Winter", 2: "Winter", 3: "Summer", 4: "Summer",
    5: "Summer", 6: "Summer", 7: "Monsoon", 8: "Monsoon", 9: "Monsoon",
    10: "Autumn", 11: "Autumn",
}
BUSINESS_TIME_ZONE = os.getenv("BUSINESS_TIME_ZONE", "Asia/Kolkata")

model = None
model_metadata = {}
options = {}


def load_model():
    """Load both current model bundles and the pre-bundle legacy pipeline."""
    global model, model_metadata, options
    loaded = joblib.load(MODEL_PATH)
    if isinstance(loaded, dict) and "pipeline" in loaded:
        model = loaded["pipeline"]
        model_metadata = loaded
        print("AI rolling-window model loaded successfully")
    else:
        model = loaded
        model_metadata = {}
        print("Legacy AI model loaded successfully; retrain to use rolling-window features")
    with open(OPTIONS_PATH, "r", encoding="utf-8") as file:
        options = json.load(file)


try:
    load_model()
except Exception as error:
    model = None
    model_metadata = {}
    options = {}
    print("Unable to load AI model:", error)


def next_month():
    now = datetime.now(ZoneInfo(BUSINESS_TIME_ZONE))
    return (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)


def current_period():
    now = datetime.now(ZoneInfo(BUSINESS_TIME_ZONE))
    return now.year, now.month


def history_for_product(warehouse_name, product_name):
    rows = [
        row for row in options.get("history", [])
        if row.get("warehouseName") == warehouse_name
        and row.get("productName") == product_name
    ]
    return sorted(rows, key=lambda row: (int(row["year"]), int(row["month"])))


def rolling_feature_row(warehouse_name, product_name, category, live_demand=None):
    """Recreate the exact feature vector produced by train_model.py."""
    history = history_for_product(warehouse_name, product_name)
    current_year, current_month = current_period()
    values_by_period = {
        (int(row["year"]), int(row["month"])): float(row["monthlyDemand"])
        for row in history
        if (int(row["year"]), int(row["month"])) <= (current_year, current_month)
    }
    if live_demand is not None:
        values_by_period[(current_year, current_month)] = float(live_demand)

    values = [values_by_period[key] for key in sorted(values_by_period)]
    max_lookback = int(model_metadata["max_lookback"])
    values = values[-max_lookback:]
    pad_value = float(model_metadata.get("pad_value", 0.0))
    history_columns = model_metadata["history_columns"]
    target_year, target_month = next_month()
    row = {
        "warehouseName": warehouse_name,
        "productName": product_name,
        "category": category,
        "targetSeason": MONTH_SEASON[target_month],
        "historyLength": len(values),
    }
    row.update(dict(zip(history_columns, [pad_value] * (max_lookback - len(values)) + values)))
    return row


def predict_one(warehouse_name, product_name, category, live_demand=None, previous=None, last_year=None):
    if model_metadata:
        frame = pd.DataFrame([rolling_feature_row(
            warehouse_name, product_name, category, live_demand
        )])
    else:
        # Compatibility for an old .pkl until /api/history/retrain is run.
        frame = pd.DataFrame([{
            "warehouseName": warehouse_name,
            "productName": product_name,
            "category": category,
            "targetSeason": MONTH_SEASON[next_month()[1]],
            "previousMonthDemand": float(previous if previous is not None else live_demand or 0),
            "sameMonthLastYearDemand": float(last_year or 0),
        }])
    return round(float(model.predict(frame)[0]), 2)


@app.route("/", methods=["GET"])
def home():
    return jsonify({"service": "AI Demand Prediction Microservice", "status": "Running"})


@app.route("/health", methods=["GET"])
def health():
    if model is None:
        return jsonify({"status": "Model Not Loaded"}), 500
    return jsonify({"status": "Healthy", "modelFormat": "rolling-window" if model_metadata else "legacy"})


@app.route("/health/live", methods=["GET"])
def liveness():
    return jsonify({"status": "live"})


@app.route("/health/ready", methods=["GET"])
def readiness():
    if model is None:
        return jsonify({"status": "not_ready", "dependency": "model"}), 503
    return jsonify({"status": "ready"})


@app.route("/reload-model", methods=["POST"])
def reload_model():
    try:
        load_model()
        return jsonify({"success": True, "message": "Model reloaded"})
    except Exception as error:
        return jsonify({"success": False, "message": str(error)}), 500


@app.route("/predict", methods=["POST"])
def predict():
    if model is None:
        return jsonify({"success": False, "message": "Model not loaded"}), 503
    try:
        data = request.get_json(silent=True) or {}
        required = ["warehouseName", "productName", "category"]
        missing = [key for key in required if not data.get(key)]
        if missing:
            return jsonify({"success": False, "message": f"Missing required fields: {', '.join(missing)}"}), 400
        prediction = predict_one(
            data["warehouseName"], data["productName"], data["category"],
            previous=data.get("previousMonthDemand"),
            last_year=data.get("sameMonthLastYearDemand"),
        )
        return jsonify({"success": True, "predictedDemand": prediction, "unit": "Units"})
    except (TypeError, ValueError) as error:
        return jsonify({"success": False, "message": f"Invalid prediction input: {error}"}), 400
    except Exception as error:
        app.logger.exception("Single prediction failed")
        return jsonify({"success": False, "message": str(error)}), 500


@app.route("/predict-all-live", methods=["POST"])
def predict_all_live():
    if model is None:
        return jsonify({"success": False, "message": "Model not loaded"}), 503
    try:
        body = request.get_json(silent=True) or {}
        warehouse_products = body.get("warehouseProducts")
        live_rows = body.get("currentMonthDemand", [])
        if not isinstance(warehouse_products, list) or not warehouse_products:
            return jsonify({"success": False, "message": "warehouseProducts must be a non-empty array"}), 400
        if not isinstance(live_rows, list):
            return jsonify({"success": False, "message": "currentMonthDemand must be an array"}), 400

        live_demand = {
            (row.get("warehouseName"), row.get("productName")): float(row.get("quantity", 0))
            for row in live_rows
            if row.get("warehouseName") and row.get("productName")
        }
        target_year, target_month = next_month()
        predictions = []
        for item in warehouse_products:
            warehouse_name, product_name = item.get("warehouseName"), item.get("productName")
            if not warehouse_name or not product_name:
                continue
            category = item.get("category") or "General"
            history = history_for_product(warehouse_name, product_name)
            # This value is an order aggregate, not a model feature. A
            # warehouse/product that is absent from the current month's order
            # rows has demand of zero; never substitute a historical month.
            current_demand = live_demand.get((warehouse_name, product_name), 0.0)
            predictions.append({
                "warehouseName": warehouse_name,
                "productName": product_name,
                "category": category,
                "currentMonthDemand": current_demand,
                "sameMonthLastYearDemand": next((
                    float(row["monthlyDemand"]) for row in history
                    if int(row["year"]) == target_year - 1 and int(row["month"]) == target_month
                ), 0.0),
                "predictedDemand": predict_one(warehouse_name, product_name, category, current_demand),
                "targetMonth": target_month,
                "targetYear": target_year,
                "unit": "Units",
            })
        if not predictions:
            return jsonify({"success": False, "message": "No valid warehouse products supplied"}), 400
        predictions.sort(key=lambda row: (row["warehouseName"], row["productName"]))
        print(f"Generated {len(predictions)} predictions (live-demand rows: {len(live_demand)}).")
        return jsonify({"success": True, "count": len(predictions), "predictions": predictions})
    except (TypeError, ValueError) as error:
        return jsonify({"success": False, "message": f"Invalid prediction input: {error}"}), 400
    except Exception as error:
        app.logger.exception("Live prediction failed")
        return jsonify({"success": False, "message": str(error)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=os.getenv("FLASK_DEBUG") == "true")