"""Catches holdout scaling, misalignment, refit and undefined metrics."""
import json
import numpy as np
import pandas as pd
import pytest
import basin_rc


def data():
    index = pd.date_range('2024-01-01', periods=100, freq='h', tz='UTC')
    return pd.DataFrame({'q':np.arange(100.) + np.sin(np.arange(100.)), 'rain':np.arange(100.)%7},index=index)


def split():
    return basin_rc.temporal_split(basin_rc.make_forecast_samples(data(),tau_h=2,horizon_h=6))


def test_scaler_uses_train_and_prediction_retains_index():
    part = split()
    model = basin_rc.DelayRidgeForecaster(alpha=1).fit(part.train.X,part.train.y)
    np.testing.assert_allclose(model.scaler_.mean_,part.train.X.mean())
    prediction = model.predict(part.test.X)
    assert isinstance(prediction,pd.Series)
    assert prediction.index.equals(part.test.y.index)
    score = basin_rc.evaluate(prediction,part.test)
    residual = prediction.to_numpy()-part.test.y.to_numpy()
    assert score.rmse == pytest.approx(np.sqrt(np.mean(residual**2)))
    assert score.nse == pytest.approx(1-np.sum(residual**2)/np.sum((part.test.y-part.test.y.mean())**2))
    assert score.n_samples == 14
    assert score.n_excluded == 6
    assert score.excluded_by_reason == {'missing':0,'origin_before_cutoff':6}
    json.dumps(score.to_dict(),allow_nan=False)


@pytest.mark.parametrize('problem',['nan','inf','empty','misaligned','nonnumeric'])
def test_fit_rejects_invalid_samples(problem):
    part = split().train
    X,y = part.X.copy(),part.y.copy()
    if problem == 'nan': X.iloc[0,0] = np.nan
    elif problem == 'inf': y.iloc[0] = np.inf
    elif problem == 'empty': X,y = X.iloc[:0],y.iloc[:0]
    elif problem == 'misaligned': y = y.iloc[::-1]
    elif problem == 'nonnumeric': X[X.columns[0]] = 'bad'
    with pytest.raises(ValueError): basin_rc.DelayRidgeForecaster().fit(X,y)


@pytest.mark.parametrize('problem',['columns','order','nan','empty'])
def test_predict_rejects_changed_features(problem):
    parts = split()
    model = basin_rc.DelayRidgeForecaster().fit(parts.train.X,parts.train.y)
    X = parts.test.X.copy()
    if problem == 'columns': X = X.rename(columns={X.columns[0]:'wrong'})
    elif problem == 'order': X = X.iloc[:,::-1]
    elif problem == 'nan': X.iloc[0,0] = np.nan
    elif problem == 'empty': X = X.iloc[:0]
    with pytest.raises(ValueError): model.predict(X)


def test_evaluation_rejects_swapped_or_extra_target_index_and_empty():
    part = split().test
    for prediction in (part.y.iloc[::-1],part.y.iloc[1:],pd.Series(dtype=float),part.y*float('inf')):
        with pytest.raises(ValueError): basin_rc.evaluate(prediction,part)


def test_constant_nse_is_null_with_reason():
    observations = data()
    observations.q = 2.
    parts = basin_rc.temporal_split(basin_rc.make_forecast_samples(observations,tau_h=2,horizon_h=6))
    score = basin_rc.evaluate(parts.test.y,parts.test)
    assert score.rmse == 0
    assert score.nse is None
    assert score.nse_reason == 'constant_target'
    assert json.loads(json.dumps(score.to_dict(),allow_nan=False))['nse'] is None


def test_test_changes_do_not_change_selection_or_train_model():
    observations = data()
    parts = split()
    changed = observations.copy()
    changed.iloc[80:] = changed.iloc[80:]*1000
    other = basin_rc.temporal_split(basin_rc.make_forecast_samples(changed,tau_h=2,horizon_h=6))
    selected = basin_rc.select_forecaster(parts)
    changed_selected = basin_rc.select_forecaster(other)
    assert selected.model.alpha == changed_selected.model.alpha
    assert selected.validation_rmse == changed_selected.validation_rmse
    np.testing.assert_allclose(selected.model.model_.coef_,changed_selected.model.model_.coef_,atol=0,rtol=0)
    assert selected.model.n_fit_samples_ == len(parts.train.X)
    assert selected.model.alpha in [0.1,1.,10.]


@pytest.mark.parametrize('bad',['1.0',True,1+2j])
def test_fit_rejects_coercible_nonreal_measurements(bad):
    parts = split()
    X = parts.train.X.copy()
    X[X.columns[0]] = bad
    with pytest.raises(ValueError): basin_rc.DelayRidgeForecaster().fit(X,parts.train.y)


@pytest.mark.parametrize('alpha',['bad',np.nan,np.inf,-1,1+2j])
def test_alpha_rejects_invalid_numeric_configuration(alpha):
    with pytest.raises(ValueError): basin_rc.DelayRidgeForecaster(alpha)
