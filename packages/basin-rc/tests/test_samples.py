"""Catches time compression, incorrect lag direction and label leakage."""
import numpy as np
import pandas as pd
import pytest
import basin_rc


def frame(n=100):
    return pd.DataFrame({'q': np.arange(n, dtype=float), 'rain': np.arange(n, dtype=float)+100}, index=pd.date_range('2024-01-01', periods=n, freq='h', tz='UTC'))


def test_gap_restored_negative_invalid_and_timezone():
    data = frame(6).drop(frame(6).index[2])
    data.index = data.index.tz_convert('Asia/Tokyo')
    data.iloc[0, 0] = -1
    result = basin_rc.prepare_observations(data)
    assert str(result.index.tz) == 'UTC'
    assert len(result) == 6
    assert np.isnan(result.iloc[0].q)
    assert result.iloc[2].isna().all()
    assert result.iloc[3].q == 3


@pytest.mark.parametrize('change', ['naive','duplicate','reverse','half_hour','infinite','text','empty'])
def test_preparation_rejects_invalid_observations(change):
    data = frame(6)
    if change == 'naive': data.index = data.index.tz_localize(None)
    elif change == 'duplicate': data.index = pd.DatetimeIndex([data.index[0]]*6)
    elif change == 'reverse': data = data.iloc[::-1]
    elif change == 'half_hour': data.index = data.index + pd.Timedelta(minutes=30)
    elif change == 'infinite': data.iloc[0,0] = np.inf
    elif change == 'text': data['q'] = 'bad'
    elif change == 'empty': data = data.iloc[:0]
    with pytest.raises(ValueError): basin_rc.prepare_observations(data)


def test_current_lags_target_origin_and_gap_do_not_compress_time():
    data = frame(20)
    samples = basin_rc.make_forecast_samples(data, tau_h=2, horizon_h=3)
    t = data.index[8]
    assert samples.X.loc[t].tolist() == [5.,4.,3.,105.,104.,103.]
    assert samples.y.loc[t] == 8
    assert samples.metadata.loc[t,'origin_time'] == data.index[5]
    assert samples.metadata.iloc[:5].reason.tolist() == ['context']*5
    assert samples.metadata.iloc[5].accepted
    damaged = basin_rc.make_forecast_samples(data.drop(data.index[4]), tau_h=2, horizon_h=3)
    assert len(damaged.metadata) == 20
    assert damaged.metadata.loc[data.index[8],'reason'] == 'missing'
    assert np.isnan(damaged.X.loc[data.index[9],'q_lag_2h'])


def test_target_grid_boundaries_purge_and_adopted_indices():
    data = frame()
    samples = basin_rc.make_forecast_samples(data, tau_h=2, horizon_h=6)
    split = basin_rc.temporal_split(samples)
    assert split.train.period_end == data.index[60]
    assert split.valid.period_end == data.index[80]
    assert split.valid.metadata.iloc[:6].reason.tolist() == ['origin_before_cutoff']*6
    assert split.test.metadata.iloc[:6].reason.tolist() == ['origin_before_cutoff']*6
    assert split.valid.X.index[0] == data.index[66]
    assert split.test.X.index[0] == data.index[86]
    assert split.train.X.index.equals(split.train.y.index)
    assert split.train.n_context == 8
    data.iloc[45:70] = np.nan
    damaged = basin_rc.temporal_split(basin_rc.make_forecast_samples(data, tau_h=2,horizon_h=6))
    assert damaged.train.period_end == split.train.period_end
    assert damaged.valid.period_end == split.valid.period_end
    assert damaged.valid.metadata.iloc[0].reason == 'origin_before_cutoff'
    assert damaged.valid.metadata.iloc[6].reason == 'missing'


@pytest.mark.parametrize('kwargs',[{'tau_h':-1},{'tau_h':1.2},{'horizon_h':0},{'inputs':[]},{'inputs':['q','q']},{'inputs':['missing']}])
def test_bad_embedding_configuration(kwargs):
    with pytest.raises(ValueError): basin_rc.make_forecast_samples(frame(),**kwargs)


def test_quality_flags_track_normalized_negatives_and_restored_gaps():
    observations = frame(6)
    observations['q_quality'] = 'present'
    observations['rain_quality'] = 'present'
    observations.iloc[0,0] = -1
    observations = observations.drop(observations.index[2])
    prepared = basin_rc.prepare_observations(observations)
    assert prepared.iloc[0].q_quality == 'negative'
    assert prepared.iloc[2].q_quality == 'missing'
    assert prepared.iloc[2].rain_quality == 'missing'
    assert prepared.iloc[1].q_quality == 'present'


def test_timestamp_resolution_does_not_change_hourly_gaps():
    observations = frame(6)
    observations.index = observations.index.as_unit('s')
    prepared = basin_rc.prepare_observations(observations.drop(observations.index[2]))
    assert prepared.index[2] == pd.Timestamp('2024-01-01T02:00:00Z')
    assert prepared.iloc[2].isna().all()


@pytest.mark.parametrize('kwargs',[{'train':0},{'valid':0},{'train':.8,'valid':.3},{'by':'origin_time'}])
def test_split_rejects_invalid_configuration(kwargs):
    with pytest.raises(ValueError): basin_rc.temporal_split(basin_rc.make_forecast_samples(frame()),**kwargs)
