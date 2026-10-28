"""Normalize observation time without filling missing measurements."""
import numpy as np
import pandas as pd
from pandas.api.types import is_numeric_dtype, is_bool_dtype, is_complex_dtype


def prepare_observations(frame: pd.DataFrame, missing: str = 'preserve') -> pd.DataFrame:
    """Return a UTC hourly grid; gaps and invalid negative q/rain remain NaN.

    Numeric measurement columns are validated; ``*_quality`` columns are
    retained and updated for restored gaps and negative measurements.
    """
    if missing != 'preserve':
        raise ValueError("Only missing='preserve' is supported")
    if not isinstance(frame, pd.DataFrame) or frame.empty or not frame.columns.is_unique:
        raise ValueError('Observations require nonempty unique columns')
    index = frame.index
    if not isinstance(index, pd.DatetimeIndex) or index.tz is None or index.hasnans:
        raise ValueError('Observations require timezone-aware timestamps')
    if not index.is_unique or not index.is_monotonic_increasing:
        raise ValueError('Timestamps must be unique and increasing')
    utc = index.tz_convert('UTC')
    if not (utc == utc.floor('h')).all():
        raise ValueError('Timestamps must fall on UTC hourly boundaries')
    result = frame.copy()
    result.index = utc
    for column in result.columns:
        if str(column).endswith('_quality'):
            continue
        values = result[column]
        if not is_numeric_dtype(values) or is_bool_dtype(values) or is_complex_dtype(values):
            raise ValueError('Measurements must be real numeric values')
        if np.isinf(values.to_numpy(dtype=float, na_value=np.nan)).any():
            raise ValueError('Infinite measurements are not supported')
    result = result.reindex(pd.date_range(utc[0], utc[-1], freq='h', name=index.name))
    for column in ('q', 'rain'):
        if column not in result:
            continue
        negative = result[column] < 0
        result.loc[negative, column] = np.nan
        quality = column + '_quality'
        if quality in result:
            result.loc[negative, quality] = 'negative'
            result.loc[result[quality].isna(), quality] = 'missing'
            # Reject an existing flag that claims a missing value is present.
            if not (result[column].notna() == result[quality].eq('present')).all():
                raise ValueError('Quality flags disagree with measurements')
    return result
