"""Metrics on precisely the adopted target-time rows."""

from dataclasses import dataclass, asdict
import numpy as np
import pandas as pd
from .forecast import _finite_values, _validate_X
from .splitting import ForecastPartition


@dataclass(frozen=True)
class ForecastEvaluation:
    rmse: float
    nse: float | None
    nse_reason: str | None
    n_samples: int
    n_excluded: int
    excluded_by_reason: dict[str, int]
    n_context: int

    def to_dict(self) -> dict:
        return asdict(self)


def evaluate(prediction: pd.Series, partition: ForecastPartition) -> ForecastEvaluation:
    """Reject partial or reordered predictions rather than silently realign."""
    if not isinstance(prediction, pd.Series) or prediction.empty:
        raise ValueError("Prediction must be a nonempty Series")
    adopted = partition.metadata.index[partition.metadata.accepted]
    if (
        not prediction.index.equals(partition.y.index)
        or not prediction.index.equals(partition.X.index)
        or not prediction.index.equals(adopted)
        or not prediction.index.is_unique
    ):
        raise ValueError("Prediction index must exactly match adopted partition rows")
    predicted, observed = _finite_values(prediction), _finite_values(partition.y)
    residual = predicted - observed
    with np.errstate(over="ignore", invalid="ignore"):
        mse = float(np.mean(residual**2))
        denominator = float(np.sum((observed - observed.mean()) ** 2))
        numerator = float(np.sum(residual**2))
    if not np.isfinite([mse, denominator, numerator]).all():
        raise ValueError("Metric calculation overflowed")
    nse = None if denominator == 0 else float(1 - numerator / denominator)
    if nse is not None and not np.isfinite(nse):
        raise ValueError("NSE calculation overflowed")
    excluded = partition.excluded_by_reason
    return ForecastEvaluation(
        float(np.sqrt(mse)),
        nse,
        "constant_target" if nse is None else None,
        len(observed),
        sum(excluded.values()),
        excluded,
        partition.n_context,
    )


def _validate_hourly_target_index(index: pd.Index) -> None:
    if (
        not isinstance(index, pd.DatetimeIndex)
        or str(index.tz) != "UTC"
        or index.hasnans
        or not index.is_unique
        or not index.is_monotonic_increasing
        or not (index == index.floor("h")).all()
    ):
        raise ValueError(
            "Partition indices must be unique, increasing hourly UTC timestamps"
        )


def persistence_prediction(
    partition: ForecastPartition, target: str = "q"
) -> pd.Series:
    """Repeat the origin observation on the partition's adopted target rows.

    Pass the raw delay-feature partition, before any feature standardization.
    Rejected/context rows are not reselected or dropped by this function.
    """
    if not isinstance(partition, ForecastPartition):
        raise ValueError("Persistence requires a ForecastPartition")
    if not isinstance(target, str) or not target:
        raise ValueError("target must be a nonempty measurement name")
    if not isinstance(partition.y, pd.Series) or partition.y.name != target:
        raise ValueError("target must match the partition target Series name")
    _validate_X(partition.X)
    _finite_values(partition.y)
    _validate_hourly_target_index(partition.X.index)
    metadata = partition.metadata
    if (
        not isinstance(metadata, pd.DataFrame)
        or metadata.empty
        or not metadata.columns.is_unique
        or "accepted" not in metadata
    ):
        raise ValueError("Partition metadata must contain an accepted column")
    _validate_hourly_target_index(metadata.index)
    if (
        not pd.api.types.is_bool_dtype(metadata.accepted)
        or metadata.accepted.isna().any()
    ):
        raise ValueError("Partition accepted flags must be nonmissing booleans")
    adopted = metadata.index[metadata.accepted]
    if not partition.X.index.equals(partition.y.index) or not partition.X.index.equals(
        adopted
    ):
        raise ValueError(
            "X, y and accepted metadata must have the same ordered target index"
        )
    column = f"{target}_lag_0h"
    if column not in partition.X:
        raise ValueError(f"Persistence requires origin observation feature {column}")
    return partition.X[column].copy(deep=True).rename("prediction")
