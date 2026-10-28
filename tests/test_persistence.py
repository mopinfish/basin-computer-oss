"""Persistence uses origin observations on the same adopted target rows."""

from dataclasses import replace

import numpy as np
import pandas as pd
import pytest
import basin_rc


def partition(constant: bool = False, missing: bool = False):
    index = pd.date_range("2024-01-01", periods=80, freq="h", tz="UTC")
    q = np.full(80, 2.0) if constant else np.arange(80, dtype=float)
    frame = pd.DataFrame({"q": q, "rain": np.arange(80, dtype=float) % 5}, index=index)
    if missing:
        frame.loc[index[70], "q"] = np.nan
    samples = basin_rc.make_forecast_samples(frame, tau_h=2, horizon_h=3)
    return basin_rc.temporal_split(samples).test


def test_persistence_uses_origin_q_on_target_time_index():
    part = partition()
    prediction = basin_rc.persistence_prediction(part)
    assert prediction.name == "prediction"
    pd.testing.assert_index_equal(prediction.index, part.y.index)
    np.testing.assert_array_equal(prediction.to_numpy(), part.y.to_numpy() - 3)
    score = basin_rc.evaluate(prediction, part)
    assert score.rmse == 3
    assert score.n_samples == len(part.y)
    expected = 1 - len(part.y) * 9 / np.sum((part.y - part.y.mean()) ** 2)
    assert score.nse == pytest.approx(expected)


def test_persistence_keeps_ridge_adoption_missing_and_cutoff_exclusions():
    part = partition(missing=True)
    prediction = basin_rc.persistence_prediction(part)
    assert prediction.index.equals(part.X.index)
    assert prediction.index.equals(part.metadata.index[part.metadata.accepted])
    score = basin_rc.evaluate(prediction, part)
    assert score.excluded_by_reason == part.excluded_by_reason
    assert score.excluded_by_reason["missing"] > 0
    assert score.excluded_by_reason["origin_before_cutoff"] == 3
    assert score.n_samples == len(part.X)


def test_persistence_returns_independent_copy_without_modifying_partition():
    part = partition()
    before = part.X.copy(deep=True)
    prediction = basin_rc.persistence_prediction(part)
    prediction.iloc[0] = -999.0
    pd.testing.assert_frame_equal(part.X, before)
    part.X.iloc[1, part.X.columns.get_loc("q_lag_0h")] = -888.0
    assert prediction.iloc[1] != -888.0


def test_constant_persistence_metrics_are_zero_and_undefined_nse():
    part = partition(constant=True)
    score = basin_rc.evaluate(basin_rc.persistence_prediction(part), part)
    assert score.rmse == 0
    assert score.nse is None
    assert score.nse_reason == "constant_target"


@pytest.mark.parametrize(
    "problem",
    [
        "empty",
        "missing_column",
        "duplicate_column",
        "nan",
        "inf",
        "string",
        "boolean",
        "complex",
        "target_mismatch",
        "target_empty",
        "target_nonstring",
        "y_nan",
        "y_order",
        "extra_row",
        "metadata_adoption",
        "metadata_bool",
        "metadata_column",
        "duplicate_time",
        "missing_time",
        "reverse_time",
        "naive_time",
        "jst_time",
        "subhour_time",
    ],
)
def test_persistence_rejects_invalid_partition(problem):
    part = partition()
    X, y, metadata = part.X.copy(), part.y.copy(), part.metadata.copy()
    target = "q"
    if problem == "empty":
        X, y = X.iloc[:0], y.iloc[:0]
    elif problem == "missing_column":
        X = X.drop(columns="q_lag_0h")
    elif problem == "duplicate_column":
        X = pd.concat([X, X[["q_lag_0h"]]], axis=1)
    elif problem in ("nan", "inf", "string", "boolean", "complex"):
        value = {
            "nan": np.nan,
            "inf": np.inf,
            "string": "bad",
            "boolean": True,
            "complex": 1 + 2j,
        }[problem]
        X["q_lag_0h"] = value
    elif problem == "target_mismatch":
        target = "rain"
    elif problem == "target_empty":
        target = ""
    elif problem == "target_nonstring":
        target = None
    elif problem == "y_nan":
        y.iloc[0] = np.nan
    elif problem == "y_order":
        y = y.iloc[::-1]
    elif problem == "extra_row":
        X = pd.concat([X, part.X.iloc[:1].set_axis([metadata.index[0]])]).sort_index()
        y = pd.concat([y, part.y.iloc[:1].set_axis([metadata.index[0]])]).sort_index()
    elif problem == "metadata_adoption":
        metadata.loc[X.index[0], "accepted"] = False
    elif problem == "metadata_bool":
        metadata["accepted"] = "True"
    elif problem == "metadata_column":
        metadata = metadata.drop(columns="accepted")
    elif problem == "reverse_time":
        X, y, metadata = X.iloc[::-1], y.iloc[::-1], metadata.iloc[::-1]
    elif problem in ("duplicate_time", "missing_time"):
        altered = list(X.index)
        altered[1] = altered[0] if problem == "duplicate_time" else pd.NaT
        X.index = y.index = pd.DatetimeIndex(altered)
    elif problem in ("naive_time", "jst_time", "subhour_time"):

        def transform(index):
            if problem == "naive_time":
                return index.tz_localize(None)
            if problem == "jst_time":
                return index.tz_convert("Asia/Tokyo")
            return index + pd.Timedelta(microseconds=1)

        X.index, y.index, metadata.index = (
            transform(X.index),
            transform(y.index),
            transform(metadata.index),
        )
    damaged = replace(part, X=X, y=y, metadata=metadata)
    with pytest.raises(ValueError):
        basin_rc.persistence_prediction(damaged, target=target)


@pytest.mark.parametrize("standardize", [True, False])
def test_fit_predict_preserve_raw_x_y_before_persistence(standardize):
    part = partition()
    X_before, y_before = part.X.copy(deep=True), part.y.copy(deep=True)
    model = basin_rc.DelayRidgeForecaster(standardize=standardize).fit(part.X, part.y)
    model.predict(part.X)
    pd.testing.assert_frame_equal(part.X, X_before)
    pd.testing.assert_series_equal(part.y, y_before)
    pd.testing.assert_series_equal(
        basin_rc.persistence_prediction(part),
        X_before["q_lag_0h"].rename("prediction"),
    )
