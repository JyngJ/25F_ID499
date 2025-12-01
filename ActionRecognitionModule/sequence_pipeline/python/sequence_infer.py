"""
Run inference on a single variable-length PillowMate sequence.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict

import numpy as np
import torch
from torch import nn

from sequence_model import SequenceGRU


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Classify a PillowMate sensor sequence.")
    parser.add_argument(
        "--model",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "models" / "sequence_classifier.pt",
        help="Path to the trained PyTorch weights.",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "models" / "sequence_config.json",
        help="Path to the JSON config with normalization + labels.",
    )
    parser.add_argument("--input", type=Path, help="Path to a JSON sequence. Reads stdin if omitted.")
    parser.add_argument("--device", type=str, default="cpu", help="cpu, cuda, or mps.")
    parser.add_argument(
        "--low-pass-window",
        type=int,
        default=1,
        help="Apply a moving-average low-pass filter before inference.",
    )
    parser.add_argument("--auto-idle", action="store_true", help="Use heuristic idle detection before running the classifier.")
    parser.add_argument("--idle-label", type=str, default="idle", help="Label to emit when auto idle detection triggers.")
    parser.add_argument("--idle-pressure-std", type=float, default=5.0, help="Maximum pressure std to consider idle.")
    parser.add_argument("--idle-pressure-mean", type=float, default=15.0, help="Maximum abs(mean pressure delta) to consider idle.")
    parser.add_argument("--idle-accel-std", type=float, default=0.02, help="Maximum accelerometer std to consider idle.")
    parser.add_argument("--idle-gyro-std", type=float, default=0.02, help="Maximum gyroscope std to consider idle.")
    return parser.parse_args()


def load_sequence(payload: Dict) -> np.ndarray:
    features = payload.get("features")
    if not features:
        raise ValueError("Input sequence has no features.")
    return np.array(features, dtype=np.float32)


def low_pass_filter(sequence: np.ndarray, window: int) -> np.ndarray:
    if window <= 1 or sequence.shape[0] < 2:
        return sequence
    kernel = np.ones(window, dtype=np.float32) / window
    filtered = np.empty_like(sequence)
    for col in range(sequence.shape[1]):
        filtered[:, col] = np.convolve(sequence[:, col], kernel, mode="same")
    return filtered


def compute_idle_stats(sequence: np.ndarray) -> Dict[str, float]:
    pressure = sequence[:, 0]
    return {
        "pressure_std": float(np.std(pressure)),
        "pressure_mean_abs": float(np.mean(np.abs(pressure))),
        "accel_std_max": float(np.max(np.std(sequence[:, 1:4], axis=0))),
        "gyro_std_max": float(np.max(np.std(sequence[:, 4:7], axis=0))),
    }


def detect_idle(stats: Dict[str, float], args: argparse.Namespace) -> bool:
    return (
        stats["pressure_std"] <= args.idle_pressure_std
        and stats["pressure_mean_abs"] <= args.idle_pressure_mean
        and stats["accel_std_max"] <= args.idle_accel_std
        and stats["gyro_std_max"] <= args.idle_gyro_std
    )


def main() -> None:
    args = parse_args()
    if args.input:
        payload = json.loads(args.input.read_text(encoding="utf8"))
    else:
        raw = sys.stdin.read()
        if not raw.strip():
            raise ValueError("No JSON input provided on stdin.")
        payload = json.loads(raw)

    config = json.loads(args.config.read_text(encoding="utf8"))
    labels = config["labels"]
    feature_mean = torch.tensor(config["feature_mean"], dtype=torch.float32)
    feature_std = torch.tensor(config["feature_std"], dtype=torch.float32)

    sequence_np = load_sequence(payload)
    if sequence_np.shape[1] != len(config["feature_names"]):
        raise ValueError(
            f"Expected {len(config['feature_names'])} features per frame, got {sequence_np.shape[1]}."
        )
    sequence_np = low_pass_filter(sequence_np, args.low_pass_window)

    idle_stats = compute_idle_stats(sequence_np)
    if args.auto_idle:
        print(
            "[auto-idle stats] "
            f"pressure_std={idle_stats['pressure_std']:.4f}, "
            f"|pressure_mean|={idle_stats['pressure_mean_abs']:.4f}, "
            f"accel_std_max={idle_stats['accel_std_max']:.4f}, "
            f"gyro_std_max={idle_stats['gyro_std_max']:.4f}",
            file=sys.stderr,
        )

    if args.auto_idle and detect_idle(idle_stats, args):
        result = {
            "label": args.idle_label,
            "probability": 1.0,
            "probabilities": {label: (1.0 if label == args.idle_label else 0.0) for label in labels},
            "detected_idle": True,
        }
        print(json.dumps(result, ensure_ascii=False))
        return

    sequence = torch.from_numpy(sequence_np)
    sequence = (sequence - feature_mean) / feature_std
    sequence = sequence.unsqueeze(0)  # (1, seq_len, feat)
    lengths = torch.tensor([sequence_np.shape[0]], dtype=torch.long)

    device = torch.device(args.device)
    model_cfg = config.get("model", {})
    model = SequenceGRU(
        feature_dim=sequence_np.shape[1],
        hidden_dim=model_cfg.get("hidden_dim", 128),
        num_classes=len(labels),
        num_layers=model_cfg.get("num_layers", 2),
        dropout=model_cfg.get("dropout", 0.1),
    )
    state_dict = torch.load(args.model, map_location=device)
    model.load_state_dict(state_dict)
    model.to(device).eval()

    with torch.no_grad():
        logits = model(sequence.to(device), lengths.to(device))
        probs = nn.functional.softmax(logits, dim=1).cpu().numpy()[0]
    best_idx = int(np.argmax(probs))
    result = {
        "label": labels[best_idx],
        "probability": float(probs[best_idx]),
        "probabilities": {labels[i]: float(probs[i]) for i in range(len(labels))},
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
