"""Time-preserving multivariate delay samples."""
from dataclasses import dataclass
from numbers import Integral
from collections.abc import Sequence
import numpy as np
import pandas as pd
from .preprocessing import prepare_observations


@dataclass(frozen=True)
class ForecastSamples:
    """Full target grid, including context and rejected measurement rows."""
    X: pd.DataFrame
    y: pd.Series
    metadata: pd.DataFrame
    tau_h: int
    horizon_h: int


def make_forecast_samples(
    observations: pd.DataFrame, inputs: Sequence[str] = ('q', 'rain'),
    target: str = 'q', tau_h: int = 12, horizon_h: int = 6,
) -> ForecastSamples:
    """Index every sample by target time; each feature ends at its origin."""
    if (not isinstance(tau_h, Integral) or isinstance(tau_h, bool) or tau_h < 0
            or not isinstance(horizon_h, Integral) or isinstance(horizon_h, bool) or horizon_h <= 0):
        raise ValueError('tau_h must be nonnegative and horizon_h positive integers')
    if isinstance(inputs, str) or not inputs or len(set(inputs)) != len(inputs):
        raise ValueError('inputs must be a nonempty sequence of unique columns')
    data = prepare_observations(observations)
    if any(column not in data for column in (*inputs, target)):
        raise ValueError('Requested measurement column is missing')
    if any(str(column).endswith('_quality') for column in (*inputs, target)):
        raise ValueError('Quality columns are not measurements')
    X = pd.DataFrame({f'{column}_lag_{lag}h': data[column].shift(horizon_h+lag)
                      for column in inputs for lag in range(tau_h+1)}, index=data.index)
    y = data[target].copy()
    y.index = X.index = data.index.rename('target_time')
    context = np.arange(len(data)) < tau_h+horizon_h
    missing = X.isna().any(axis=1) | y.isna()
    reason = np.where(context, 'context', np.where(missing, 'missing', 'accepted'))
    metadata = pd.DataFrame({'origin_time': data.index-pd.Timedelta(hours=horizon_h),
                             'target_time': data.index,
                             'accepted': reason == 'accepted', 'reason': reason}, index=y.index)
    return ForecastSamples(X, y, metadata, int(tau_h), int(horizon_h))
