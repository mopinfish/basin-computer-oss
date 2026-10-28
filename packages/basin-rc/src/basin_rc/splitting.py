"""Target-time partitions with causal origin cutoffs."""
from dataclasses import dataclass
import math
import pandas as pd
from .embedding import ForecastSamples


@dataclass(frozen=True)
class ForecastPartition:
    X: pd.DataFrame
    y: pd.Series
    metadata: pd.DataFrame
    period_start: pd.Timestamp
    period_end: pd.Timestamp
    origin_cutoff: pd.Timestamp | None

    @property
    def n_context(self) -> int:
        return int(self.metadata.reason.eq('context').sum())

    @property
    def excluded_by_reason(self) -> dict[str, int]:
        # Context is not an evaluation sample and never enters its denominator.
        return {reason: int(self.metadata.reason.eq(reason).sum())
                for reason in ('missing', 'origin_before_cutoff')}


@dataclass(frozen=True)
class TemporalSplit:
    train: ForecastPartition
    valid: ForecastPartition
    test: ForecastPartition


def temporal_split(samples: ForecastSamples, train: float = 0.6,
                   valid: float = 0.2, by: str = 'target_time') -> TemporalSplit:
    """Compute boundaries on the full grid before missing-value exclusions."""
    if by != 'target_time' or not (0 < train < 1 and 0 < valid < 1 and train+valid < 1):
        raise ValueError('Require target-time train/valid ratios with a nonempty test remainder')
    n = len(samples.metadata)
    first, second = math.floor(n*train), math.floor(n*(train+valid))
    if not 0 < first < second < n:
        raise ValueError('Grid is too short for three nonempty periods')
    index = samples.metadata.index
    ends = [index[first], index[second], index[-1]+pd.Timedelta(hours=1)]
    partitions = []
    for position, (start, stop) in enumerate(((0,first),(first,second),(second,n))):
        metadata = samples.metadata.iloc[start:stop].copy()
        cutoff = None if position == 0 else ends[position-1]
        if cutoff is not None:
            purge = metadata.origin_time < cutoff
            # Context stays context; a cutoff exclusion has precedence over missing.
            purge &= metadata.reason.ne('context')
            metadata.loc[purge, 'reason'] = 'origin_before_cutoff'
            metadata.loc[purge, 'accepted'] = False
        adopted = metadata.index[metadata.accepted]
        partitions.append(ForecastPartition(samples.X.loc[adopted].copy(),
                          samples.y.loc[adopted].copy(), metadata,
                          index[start], ends[position], cutoff))
    return TemporalSplit(*partitions)
