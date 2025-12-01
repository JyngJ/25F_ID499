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
    parser.add_argument("--device", type=str, default="cpu", help="cpu or cuda.")
    return parser.parse_args()


def load_sequence(payload: Dict) -> np.ndarray:
    features = payload.get("features")
    if not features:
        raise ValueError("Input sequence has no features.")
    return np.array(features, dtype=np.float32)


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
