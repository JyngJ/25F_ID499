"""
Interactive data collection helper for the PillowMate Action Recognition Module.

Usage example (once Arduino is streaming data at 115200 baud):

    python collect_data.py --port /dev/ttyACM0 --duration 6 --trials 3

The script will walk you through recording each interaction label
(tap / rest_head / hug / shake by default) for the requested number of
trials, then store everything into data/raw/YYYYMMDD_HHMMSS.csv.
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Iterable, List

import serial  # type: ignore


DEFAULT_LABELS = ["tap", "rest_head", "hug", "shake"]
CSV_HEADER = [
    "timestamp_ms",
    "pressure",
    "ax",
    "ay",
    "az",
    "gx",
    "gy",
    "gz",
    "label",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect labeled PillowMate action-recognition sensor data.")
    parser.add_argument("--port", required=True, help="Serial port connected to the Arduino (e.g., /dev/ttyACM0).")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate. Must match the sketch (default: 115200).")
    parser.add_argument(
        "--labels",
        nargs="+",
        default=DEFAULT_LABELS,
        help="Interaction labels recorded per session.",
    )
    parser.add_argument("--duration", type=float, default=5.0, help="Recording duration per trial in seconds.")
    parser.add_argument("--trials", type=int, default=3, help="Number of repetitions per label.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("../data/raw"),
        help="Where to store the CSV file (relative to this script).",
    )
    parser.add_argument("--quiet", action="store_true", help="Suppress live console echo of sensor values.")
    return parser.parse_args()


def open_serial(port: str, baud: int) -> serial.Serial:
    try:
        ser = serial.Serial(port, baudrate=baud, timeout=1.0)
        # Give the Arduino a couple seconds to reset after opening the port.
        time.sleep(2.0)
        ser.reset_input_buffer()
        return ser
    except serial.SerialException as exc:  # type: ignore[attr-defined]
        sys.exit(f"Failed to open serial port {port}: {exc}")


def parse_stream_line(line: str) -> List[float] | None:
    """
    Parses one CSV line emitted by the Arduino sketch.

    Returns:
        List of floats [timestamp_ms, pressure, ax, ay, az, gx, gy, gz]
        or None if the line is malformed or a comment.
    """
    if not line or line.startswith("#"):
        return None

    tokens = line.split(",")
    if len(tokens) != 8:
        return None

    try:
        values = [float(token.strip()) for token in tokens]
    except ValueError:
        return None

    return values


def prompt_user(label: str, trial_idx: int, duration: float) -> None:
    input(f"\nPrepare to record '{label}' (trial {trial_idx}). Press Enter to start.")
    print(f"Recording {label} for {duration:.1f}s ... hold the interaction steady.")


def collect_trial(
    ser: serial.Serial,
    label: str,
    duration: float,
    quiet: bool,
) -> Iterable[List[float]]:
    start_time = time.time()
    while time.time() - start_time < duration:
        try:
            raw = ser.readline().decode("utf-8", errors="ignore").strip()
        except serial.SerialException:
            print("Serial read error. Retrying ...")
            continue
        parsed = parse_stream_line(raw)
        if not parsed:
            continue
        if not quiet:
            print(f"{label:>10}: {parsed}")
        yield parsed


def ensure_output_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def main() -> None:
    args = parse_args()
    ensure_output_dir(args.output_dir)

    port_path = args.port
    ser = open_serial(port_path, args.baud)
    print(f"Connected to {port_path} at {args.baud} baud.")

    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = args.output_dir / f"action_module_{session_id}.csv"

    rows = []
    for label in args.labels:
        for trial in range(1, args.trials + 1):
            prompt_user(label, trial, args.duration)
            for sample in collect_trial(ser, label, args.duration, args.quiet):
                rows.append(sample + [label])

    if not rows:
        sys.exit("No samples were captured. Check the wiring and try again.")

    with output_path.open("w", newline="") as fp:
        writer = csv.writer(fp)
        writer.writerow(CSV_HEADER)
        writer.writerows(rows)

    print(f"\nSaved {len(rows)} samples to {output_path}")


if __name__ == "__main__":
    main()
