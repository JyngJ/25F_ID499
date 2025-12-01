"""
Data augmentation utility for PillowMate sequence data.

- Random crop: sample a random sub-window to simulate shorter interactions.
- Time scale: resample to a shorter/longer length to mimic faster/slower motions.
- Noise: add small Gaussian noise to each feature.

The script reads JSON sequences (collect_sequences.js output) and writes
augmented JSON files to a separate directory. You can select which operations
to apply and how many augmented copies per original sequence to generate.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path
from typing import Dict, List

import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Augment PillowMate sequence data.")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "raw",
        help="Directory containing original JSON sequences.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "augmented",
        help="Where to store augmented JSON files.",
    )
    parser.add_argument(
        "--ops",
        nargs="+",
        choices=["random_crop", "time_scale", "noise"],
        default=["random_crop", "noise"],
        help="Augmentation operations to apply (in order).",
    )
    parser.add_argument("--copies", type=int, default=2, help="Augmented variants per original sequence.")
    parser.add_argument("--min-crop-ratio", type=float, default=0.4, help="Minimum ratio for random crop.")
    parser.add_argument("--max-crop-ratio", type=float, default=0.9, help="Maximum ratio for random crop.")
    parser.add_argument("--min-scale", type=float, default=0.7, help="Minimum time scale factor.")
    parser.add_argument("--max-scale", type=float, default=1.3, help="Maximum time scale factor.")
    parser.add_argument("--noise-std", type=float, default=0.02, help="Gaussian noise std dev.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility.")
    parser.add_argument("--include-original", action="store_true", help="Copy original sequences into output.")
    return parser.parse_args()


def load_sequences(data_dir: Path) -> List[Path]:
    paths = sorted(data_dir.glob("*.json"))
    if not paths:
        raise FileNotFoundError(f"No JSON files found in {data_dir}.")
    return paths


def random_crop(sequence: np.ndarray, rng: random.Random, min_ratio: float, max_ratio: float) -> np.ndarray:
    if sequence.shape[0] < 2:
        return sequence
    ratio = rng.uniform(min_ratio, max_ratio)
    crop_len = max(2, int(math.ceil(sequence.shape[0] * ratio)))
    if crop_len >= sequence.shape[0]:
        return sequence
    start = rng.randint(0, sequence.shape[0] - crop_len)
    return sequence[start : start + crop_len]


def time_scale(sequence: np.ndarray, rng: random.Random, min_scale: float, max_scale: float) -> np.ndarray:
    if sequence.shape[0] < 2:
        return sequence
    scale = rng.uniform(min_scale, max_scale)
    new_len = max(2, int(round(sequence.shape[0] * scale)))
    original = np.arange(sequence.shape[0])
    target = np.linspace(0, sequence.shape[0] - 1, num=new_len)
    resampled = np.empty((new_len, sequence.shape[1]), dtype=np.float32)
    for feature_idx in range(sequence.shape[1]):
        resampled[:, feature_idx] = np.interp(target, original, sequence[:, feature_idx])
    return resampled


def add_noise(sequence: np.ndarray, rng: random.Random, noise_std: float) -> np.ndarray:
    noise = np.random.normal(0.0, noise_std, size=sequence.shape).astype(np.float32)
    return sequence + noise


def apply_ops(sequence: np.ndarray, ops: List[str], rng: random.Random, args: argparse.Namespace) -> np.ndarray:
    augmented = sequence.copy()
    for op in ops:
        if op == "random_crop":
            augmented = random_crop(augmented, rng, args.min_crop_ratio, args.max_crop_ratio)
        elif op == "time_scale":
            augmented = time_scale(augmented, rng, args.min_scale, args.max_scale)
        elif op == "noise":
            augmented = add_noise(augmented, rng, args.noise_std)
        else:
            raise ValueError(f"Unsupported op: {op}")
    return augmented


def save_sequence(base_payload: Dict, sequence: np.ndarray, output_dir: Path, suffix: str, index: int) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{Path(base_payload['source']).stem}_{suffix}_{index:02d}.json"
    payload = {
        **base_payload,
        "frame_count": sequence.shape[0],
        "features": sequence.tolist(),
    }
    path = output_dir / filename
    path.write_text(json.dumps(payload, indent=2), encoding="utf8")
    return path


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    np.random.seed(args.seed)

    input_paths = load_sequences(args.data_dir)
    written = 0

    for path in input_paths:
        payload = json.loads(path.read_text(encoding="utf8"))
        features = np.array(payload.get("features", []), dtype=np.float32)
        if features.size == 0:
            continue
        base_payload = {
            "label": payload["label"],
            "sample_ms": payload.get("sample_ms", 20),
            "feature_names": payload.get("feature_names"),
            "metadata": payload.get("metadata"),
            "source": str(path),
        }
        if args.include_original:
            save_sequence(base_payload, features, args.output_dir, "orig", 0)
            written += 1
        if not args.ops:
            continue
        for copy_idx in range(1, args.copies + 1):
            augmented = apply_ops(features, args.ops, rng, args)
            save_sequence(base_payload, augmented, args.output_dir, "aug", copy_idx)
            written += 1

    print(f"Augmentation complete. Wrote {written} sequences to {args.output_dir}")


if __name__ == "__main__":
    main()
