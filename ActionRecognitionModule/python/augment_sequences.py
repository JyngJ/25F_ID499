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
from typing import Dict, List, Sequence

import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Augment PillowMate sequence data.")
    parser.add_argument(
        "--data-dir",
        dest="data_dirs",
        type=Path,
        nargs="+",
        default=[Path(__file__).resolve().parents[1] / "data" / "raw"],
        help="One or more directories containing original JSON sequences.",
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
        choices=["random_crop", "time_scale", "noise", "time_shift", "amplitude_scale", "time_mask"],
        default=["random_crop", "time_scale", "noise"],
        help="Augmentation operations to apply (in order).",
    )
    parser.add_argument("--copies", type=int, default=2, help="Augmented variants per original sequence.")
    parser.add_argument("--min-crop-ratio", type=float, default=0.4, help="Minimum ratio for random crop.")
    parser.add_argument("--max-crop-ratio", type=float, default=0.9, help="Maximum ratio for random crop.")
    parser.add_argument("--min-scale", type=float, default=0.7, help="Minimum time scale factor.")
    parser.add_argument("--max-scale", type=float, default=1.3, help="Maximum time scale factor.")
    parser.add_argument("--noise-std", type=float, default=0.02, help="Gaussian noise std dev.")
    parser.add_argument("--time-shift-ratio", type=float, default=0.1, help="Max fraction of sequence length to shift (time_shift).")
    parser.add_argument(
        "--amplitude-scale-min",
        type=float,
        default=0.9,
        help="Minimum per-feature scale factor (amplitude_scale).",
    )
    parser.add_argument(
        "--amplitude-scale-max",
        type=float,
        default=1.1,
        help="Maximum per-feature scale factor (amplitude_scale).",
    )
    parser.add_argument(
        "--time-mask-ratio",
        type=float,
        default=0.15,
        help="Fraction of frames to zero out when applying time_mask.",
    )
    parser.add_argument(
        "--time-mask-chunks",
        type=int,
        default=1,
        help="Number of separate masked chunks when applying time_mask.",
    )
    parser.add_argument(
        "--time-mask-targets",
        nargs="+",
        choices=["pressure", "accelerometer", "gyroscope", "all"],
        default=["pressure"],
        help="Which feature groups to zero during time_mask (default pressure only).",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility.")
    parser.add_argument("--include-original", action="store_true", help="Copy original sequences into output.")
    parser.add_argument(
        "--split-by-session",
        action="store_true",
        help="Mirror the source directory structure under the output directory.",
    )
    return parser.parse_args()


def load_sequences(data_dirs: Sequence[Path]) -> List[Path]:
    paths: List[Path] = []
    for data_dir in data_dirs:
        paths.extend(sorted(data_dir.glob("*.json")))
    if not paths:
        joined = ", ".join(str(d) for d in data_dirs)
        raise FileNotFoundError(f"No JSON files found in {joined}.")
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


def time_shift(sequence: np.ndarray, rng: random.Random, max_ratio: float) -> np.ndarray:
    if sequence.shape[0] < 2 or max_ratio <= 0:
        return sequence
    max_shift = max(1, int(sequence.shape[0] * max_ratio))
    shift = rng.randint(-max_shift, max_shift)
    if shift == 0:
        return sequence
    return np.roll(sequence, shift, axis=0)


def amplitude_scale(sequence: np.ndarray, rng: random.Random, min_scale: float, max_scale: float) -> np.ndarray:
    if min_scale <= 0 or max_scale <= 0:
        return sequence
    scales = np.random.uniform(min_scale, max_scale, size=(sequence.shape[1],)).astype(np.float32)
    return sequence * scales


FEATURE_COLUMN_GROUPS = {
    "pressure": [0],
    "accelerometer": [1, 2, 3],
    "gyroscope": [4, 5, 6],
}


def time_mask(sequence: np.ndarray, rng: random.Random, ratio: float, chunks: int, targets: List[str]) -> np.ndarray:
    if ratio <= 0 or sequence.shape[0] < 2:
        return sequence
    total_frames = max(1, int(sequence.shape[0] * min(ratio, 1.0)))
    chunk_len = max(1, total_frames // max(1, chunks))
    masked = sequence.copy()
    if "all" in targets:
        columns = list(range(sequence.shape[1]))
    else:
        columns = []
        for target in targets:
            columns.extend(FEATURE_COLUMN_GROUPS.get(target, []))
        columns = sorted(set(columns))
    if not columns:
        columns = FEATURE_COLUMN_GROUPS["pressure"]
    for _ in range(max(1, chunks)):
        start = rng.randint(0, max(0, sequence.shape[0] - chunk_len))
        masked[start : start + chunk_len, columns] = 0.0
    return masked


def apply_ops(sequence: np.ndarray, ops: List[str], rng: random.Random, args: argparse.Namespace) -> np.ndarray:
    augmented = sequence.copy()
    for op in ops:
        if op == "random_crop":
            augmented = random_crop(augmented, rng, args.min_crop_ratio, args.max_crop_ratio)
        elif op == "time_scale":
            augmented = time_scale(augmented, rng, args.min_scale, args.max_scale)
        elif op == "noise":
            augmented = add_noise(augmented, rng, args.noise_std)
        elif op == "time_shift":
            augmented = time_shift(augmented, rng, args.time_shift_ratio)
        elif op == "amplitude_scale":
            augmented = amplitude_scale(augmented, rng, args.amplitude_scale_min, args.amplitude_scale_max)
        elif op == "time_mask":
            augmented = time_mask(augmented, rng, args.time_mask_ratio, args.time_mask_chunks, args.time_mask_targets)
        else:
            raise ValueError(f"Unsupported op: {op}")
    return augmented


def save_sequence(
    base_payload: Dict,
    sequence: np.ndarray,
    output_dir: Path,
    suffix: str,
    index: int,
    session_name: str | None,
) -> Path:
    target_dir = output_dir / session_name if session_name else output_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{Path(base_payload['source']).stem}_{suffix}_{index:02d}.json"
    payload = {
        **base_payload,
        "frame_count": sequence.shape[0],
        "features": sequence.tolist(),
    }
    path = target_dir / filename
    path.write_text(json.dumps(payload, indent=2), encoding="utf8")
    return path


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    np.random.seed(args.seed)

    input_paths = load_sequences(args.data_dirs)
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
        session_name = Path(path).parent.name if args.split_by_session else None
        if args.include_original:
            save_sequence(base_payload, features, args.output_dir, "orig", 0, session_name)
            written += 1
        if not args.ops:
            continue
        for copy_idx in range(1, args.copies + 1):
            augmented = apply_ops(features, args.ops, rng, args)
            save_sequence(base_payload, augmented, args.output_dir, "aug", copy_idx, session_name)
            written += 1

    print(f"Augmentation complete. Wrote {written} sequences to {args.output_dir}")


if __name__ == "__main__":
    main()
