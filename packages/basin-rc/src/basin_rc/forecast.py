"""Train-only scaling and validation-only fixed alpha selection."""
from dataclasses import dataclass
from numbers import Real
from pandas.api.types import is_numeric_dtype, is_bool_dtype, is_complex_dtype
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from .splitting import TemporalSplit


def _finite_values(value: pd.DataFrame | pd.Series) -> np.ndarray:
    dtypes = value.dtypes if isinstance(value, pd.DataFrame) else [value.dtype]
    if any(not is_numeric_dtype(dtype) or is_bool_dtype(dtype) or is_complex_dtype(dtype) for dtype in dtypes):
        raise ValueError('Samples must contain real numeric measurements')
    try:
        array = value.to_numpy(dtype=float)
    except (TypeError, ValueError) as error:
        raise ValueError('Samples must contain real numeric values') from error
    if np.iscomplexobj(value.to_numpy()) or not np.isfinite(array).all():
        raise ValueError('Samples must be finite real values')
    return array


def _validate_X(X: pd.DataFrame) -> np.ndarray:
    if not isinstance(X, pd.DataFrame) or X.empty or not X.columns.is_unique:
        raise ValueError('X must be a nonempty DataFrame with unique features')
    if not X.index.is_unique or X.index.hasnans:
        raise ValueError('X requires unique nonmissing sample indices')
    return _finite_values(X)


class DelayRidgeForecaster:
    """Ridge on already aligned delay features; no implicit shift or split."""
    def __init__(self, alpha: float = 1.0, standardize: bool = True):
        if not isinstance(alpha, Real) or isinstance(alpha, bool) or not np.isfinite(alpha) or alpha < 0:
            raise ValueError('alpha must be a finite nonnegative number')
        self.alpha = float(alpha)
        self.standardize = standardize

    def fit(self, X: pd.DataFrame, y: pd.Series) -> 'DelayRidgeForecaster':
        values = _validate_X(X)
        if not isinstance(y, pd.Series) or not y.index.equals(X.index):
            raise ValueError('y must have exactly the same ordered sample index as X')
        targets = _finite_values(y)
        scaler = StandardScaler().fit(values) if self.standardize else None
        transformed = scaler.transform(values) if scaler is not None else values
        model = Ridge(alpha=self.alpha).fit(transformed, targets)
        self.scaler_, self.model_ = scaler, model
        self.feature_names_in_ = X.columns.copy()
        self.n_fit_samples_ = len(X)
        return self

    def predict(self, X: pd.DataFrame) -> pd.Series:
        values = _validate_X(X)
        if not hasattr(self, 'model_'):
            raise ValueError('Forecaster has not been fitted')
        if not X.columns.equals(self.feature_names_in_):
            raise ValueError('Prediction feature names and order must match fit')
        transformed = self.scaler_.transform(values) if self.scaler_ is not None else values
        prediction = self.model_.predict(transformed)
        if not np.isfinite(prediction).all():
            raise ValueError('Prediction is nonfinite')
        return pd.Series(prediction, index=X.index, name='prediction')


@dataclass(frozen=True)
class ForecastSelection:
    model: DelayRidgeForecaster
    validation_rmse: dict[float, float]


def select_forecaster(split: TemporalSplit, standardize: bool = True) -> ForecastSelection:
    """Select among 0.1, 1, 10 by validation RMSE, retaining train-only fit."""
    from .metrics import evaluate
    scores: dict[float, float] = {}
    best_model = None
    best_score = float('inf')
    for alpha in (0.1, 1.0, 10.0):
        model = DelayRidgeForecaster(alpha, standardize).fit(split.train.X, split.train.y)
        score = evaluate(model.predict(split.valid.X), split.valid).rmse
        scores[alpha] = score
        if score < best_score:
            best_model, best_score = model, score
    return ForecastSelection(best_model, scores)
