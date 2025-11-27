"""
Train a lightweight multinomial logistic-regression classifier for the PillowMate
Action Recognition Module.

Johnny-Five 기반 데이터 수집기(node/collect_data.js)가 생성한 CSV
(timestamp_ms, pressure, ax, ay, az, gx, gy, gz, label)을 읽어
scikit-learn 모델을 학습하고, run_inference.js가 바로 사용할 수 있도록
models/model_params.json에 매개변수를 기록합니다.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT_DIR / "data" / "raw"
DEFAULT_JSON_PATH = ROOT_DIR / "models" / "model_params.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the PillowMate action-recognition classifier.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help="Directory with CSV recordings.")
    parser.add_argument("--json-out", type=Path, default=DEFAULT_JSON_PATH, help="Path for serialized weights.")
    parser.add_argument("--test-size", type=float, default=0.2, help="Holdout ratio for evaluation.")
    parser.add_argument("--random-state", type=int, default=42, help="Seed for deterministic splits.")
    return parser.parse_args()


def load_dataset(data_dir: Path) -> pd.DataFrame:
    csv_files = sorted(data_dir.glob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found in {data_dir}. Run collect_data.py first.")
    frames = []
    for csv_path in csv_files:
        frame = pd.read_csv(csv_path)
        if "label" not in frame.columns:
            raise ValueError(f"{csv_path} missing 'label' column.")
        frames.append(frame)
    data = pd.concat(frames, ignore_index=True)
    return data


def split_features_labels(data: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
    feature_cols = ["pressure", "ax", "ay", "az", "gx", "gy", "gz"]
    missing = [col for col in feature_cols + ["label"] if col not in data.columns]
    if missing:
        raise ValueError(f"Missing columns: {missing}")
    features = data[feature_cols]
    labels = data["label"]
    return features, labels


def train_model(
    features: pd.DataFrame,
    labels: pd.Series,
    test_size: float,
    random_state: int,
) -> Tuple[LogisticRegression, StandardScaler, LabelEncoder, Dict[str, np.ndarray]]:
    scaler = StandardScaler()
    X = scaler.fit_transform(features.values)

    encoder = LabelEncoder()
    y = encoder.fit_transform(labels.values)

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=test_size,
        random_state=random_state,
        stratify=y,
    )

    clf = LogisticRegression(
        multi_class="multinomial",
        solver="lbfgs",
        max_iter=1000,
        n_jobs=None,
    )
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    report = classification_report(y_test, y_pred, target_names=encoder.classes_)
    matrix = confusion_matrix(y_test, y_pred)
    print("\n=== Classification Report ===")
    print(report)
    print("Confusion Matrix:\n", matrix)

    metadata = {
        "report": report,
        "confusion_matrix": matrix.tolist(),
    }
    return clf, scaler, encoder, metadata


def export_json(
    clf: LogisticRegression,
    scaler: StandardScaler,
    encoder: LabelEncoder,
    metadata: Dict[str, List],
    json_path: Path,
) -> Dict[str, List]:
    params = {
        "labels": encoder.classes_.tolist(),
        "weights": clf.coef_.tolist(),
        "bias": clf.intercept_.tolist(),
        "feature_mean": scaler.mean_.tolist(),
        "feature_scale": scaler.scale_.tolist(),
        "metadata": metadata,
    }
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with json_path.open("w") as fp:
        json.dump(params, fp, indent=2)
    print(f"Saved model parameters to {json_path}")
    return params


def main() -> None:
    args = parse_args()
    data = load_dataset(args.data_dir)
    features, labels = split_features_labels(data)

    clf, scaler, encoder, metadata = train_model(
        features,
        labels,
        test_size=args.test_size,
        random_state=args.random_state,
    )

    export_json(clf, scaler, encoder, metadata, args.json_out)


if __name__ == "__main__":
    main()
