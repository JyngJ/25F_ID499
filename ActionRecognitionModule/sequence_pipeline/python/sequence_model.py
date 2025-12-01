"""
Neural network architectures for PillowMate sequence classification.
"""

from __future__ import annotations

from typing import Tuple

import torch
from torch import nn
from torch.nn.utils.rnn import pack_padded_sequence


class SequenceGRU(nn.Module):
    """Bidirectional GRU classifier with a small MLP head."""

    def __init__(
        self,
        feature_dim: int,
        hidden_dim: int,
        num_classes: int,
        num_layers: int = 2,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.gru = nn.GRU(
            input_size=feature_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.classifier = nn.Sequential(
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, num_classes),
        )

    def forward(self, sequences: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        """
        Args:
            sequences: Tensor of shape (batch, max_len, feature_dim).
            lengths: Actual lengths for each sequence (batch,).
        """
        packed = pack_padded_sequence(
            sequences,
            lengths.cpu(),
            batch_first=True,
            enforce_sorted=False,
        )
        _, hidden = self.gru(packed)
        # hidden shape: (num_layers * 2, batch, hidden_dim)
        forward_final = hidden[-2]
        backward_final = hidden[-1]
        encoded = torch.cat([forward_final, backward_final], dim=1)
        logits = self.classifier(encoded)
        return logits