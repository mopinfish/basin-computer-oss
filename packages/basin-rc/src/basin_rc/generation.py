"""Compute fixed candidate forecasts and publish validated prediction artifacts.

This module has no basin-data dependency. Dataset provenance must be supplied
by the caller; computation never reads data or writes files.
"""
from collections.abc import Iterable, Iterator, Mapping
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any

import pandas as pd
import basin_rc


@dataclass(frozen=True)
class ForecastArtifact:
    """Full target grid and calculation metadata, without identity or estimator."""

    series: pd.DataFrame
    result: dict[str, Any]


def compute_forecast(observations: pd.DataFrame) -> ForecastArtifact:
    """Use the fixed 12-hour context and six-hour candidate forecast settings."""
    observations = basin_rc.prepare_observations(observations)
    samples = basin_rc.make_forecast_samples(observations, tau_h=12, horizon_h=6)
    split = basin_rc.temporal_split(samples)
    selected = basin_rc.select_forecaster(split)
    from .validation import _validate_alpha_selection, require
    candidates = _validate_alpha_selection(
        selected.model.alpha,
        {str(alpha): value for alpha, value in selected.validation_rmse.items()},
    )
    require(set(candidates) == {0.1, 1.0, 10.0}, "Unexpected fixed demo alpha candidates")
    require(selected.model.alpha == min(candidates, key=lambda alpha: (candidates[alpha], alpha)),
            "Fixed demo requires smallest alpha among saved RMSE minima")
    prediction = selected.model.predict(split.test.X)
    score = basin_rc.evaluate(prediction, split.test)
    persistence = basin_rc.persistence_prediction(split.test)
    persistence_score = basin_rc.evaluate(persistence, split.test)
    metadata = pd.concat(
        [
            part.metadata.assign(partition=name)
            for name, part in (
                ("train", split.train),
                ("valid", split.valid),
                ("test", split.test),
            )
        ]
    )
    metadata["q"] = observations.q
    metadata["rain"] = observations.rain
    metadata["observed"] = samples.y
    metadata["prediction"] = prediction.reindex(metadata.index)
    item = {
        "task": "forecast",
        "status": "local_candidate_not_public_release",
        "inputs": ["q", "rain"],
        "target": "q",
        "horizon_h": 6,
        "tau_h": 12,
        "alpha": selected.model.alpha,
        "standardize": True,
        "train_period_start": split.train.period_start.isoformat(),
        "train_period_end": split.train.period_end.isoformat(),
        "valid_period_start": split.valid.period_start.isoformat(),
        "valid_period_end": split.valid.period_end.isoformat(),
        "period_start": split.test.period_start.isoformat(),
        "period_end": split.test.period_end.isoformat(),
        "split": "test",
        "metric": "NSE",
        "value": score.nse,
        **score.to_dict(),
        "fit_cutoff": split.train.period_end.isoformat(),
        "selection_cutoff": split.valid.period_end.isoformat(),
        "validation_rmse": {
            str(alpha): value for alpha, value in selected.validation_rmse.items()
        },
        "partitions": {
            name: {
                "n_samples": len(part.y),
                "n_context": part.n_context,
                "n_excluded": sum(part.excluded_by_reason.values()),
                "excluded_by_reason": part.excluded_by_reason,
            }
            for name, part in (
                ("train", split.train),
                ("valid", split.valid),
                ("test", split.test),
            )
        },
        "baselines": {
            "persistence": {
                "method": "origin_observation",
                "horizon_h": 6,
                **persistence_score.to_dict(),
            }
        },
    }
    return ForecastArtifact(metadata, item)


def assemble_result(artifact: ForecastArtifact, *, basin_id: str,
                    prediction_path: str) -> dict[str, Any]:
    """Attach safe caller-owned identity without overriding calculation fields."""
    from .validation import safe_path
    if not isinstance(basin_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", basin_id):
        raise ValueError("Unsafe basin ID")
    safe_path(prediction_path)
    if not prediction_path.endswith(".csv") or prediction_path == "results.json":
        raise ValueError("Prediction path must be a relative CSV path")
    if "basin_id" in artifact.result or "prediction_path" in artifact.result:
        raise ValueError("Artifact cannot override caller-owned identity")
    return {"basin_id": basin_id, **deepcopy(artifact.result),
            "prediction_path": prediction_path}


ArtifactCollection = Mapping[str, ForecastArtifact] | Iterable[tuple[str, ForecastArtifact]]


def _artifact_items(artifacts: ArtifactCollection) -> list[tuple[str, ForecastArtifact]]:
    items = list(artifacts.items() if isinstance(artifacts, Mapping) else artifacts)
    if not items or len({key for key, _ in items}) != len(items):
        raise ValueError('Require nonempty unique basin IDs')
    for basin_id, artifact in items:
        if not isinstance(artifact, ForecastArtifact):
            raise ValueError('Expected ForecastArtifact')
        assemble_result(artifact, basin_id=basin_id,
                        prediction_path=f'predictions/{basin_id}.csv')
    return items


def _forecast_document(items: list[tuple[str, ForecastArtifact]], provenance: Mapping[str, Any],
                       implementation: Mapping[str, Any]) -> dict[str, Any]:
    from datetime import datetime, timezone
    from .validation import validate_forecast_document
    required = {'dataset_version', 'dataset_status', 'public_release_blockers',
                'library_version', 'data_library_version'}
    allowed = required | {'schema_version', 'library_name', 'data_library_name', 'extensions'}
    if not isinstance(provenance, Mapping) or not required <= provenance.keys() or not provenance.keys() <= allowed:
        raise ValueError('Require genuine dataset provenance and package versions')
    result = {'schema_version': '0.2', 'library_name': 'basin-rc',
              'data_library_name': 'basin-data', **deepcopy(dict(provenance)),
              'implementation': deepcopy(dict(implementation)),
              'generated_at': datetime.now(timezone.utc).isoformat(),
              'results': [assemble_result(artifact, basin_id=basin_id,
                          prediction_path=f'predictions/{basin_id}.csv')
                          for basin_id, artifact in items],
              'artifact_sha256': {f'predictions/{basin_id}.csv': '0' * 64 for basin_id, _ in items}}
    validate_forecast_document(result)
    return result


def _write_forecast_files(stage: Path, *, artifacts: ArtifactCollection,
                          provenance: Mapping[str, Any], implementation: Mapping[str, Any],
                          normalize_timestamps: bool = True) -> dict[str, Any]:
    """Write prediction files into an owned stage; publication is caller-owned."""
    import hashlib
    import json
    items = _artifact_items(artifacts)
    result = _forecast_document(items, provenance, implementation)
    stage = Path(stage)
    _reject_symlinks(stage)
    for (_, artifact), item in zip(items, result['results']):
        path = stage / item['prediction_path']
        _reject_symlinks(path)
        if path.exists():
            raise FileExistsError(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        series = artifact.series.copy()
        if normalize_timestamps:
            for column in ('origin_time', 'target_time'):
                series[column] = series[column].map(lambda value: value.isoformat())
        series.to_csv(path, index=False)
        result['artifact_sha256'][item['prediction_path']] = hashlib.sha256(path.read_bytes()).hexdigest()
    _reject_symlinks(stage / 'results.json')
    (stage / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2,
                                      allow_nan=False) + '\n', encoding='utf-8')
    return result


def _reject_symlinks(path: Path) -> None:
    for component in (path, *path.parents):
        if component.is_symlink():
            raise ValueError('Symlink output paths are unsupported')


def _rename_no_replace(source: Path, destination: Path) -> None:
    """Use OS exclusive rename; never replace even an empty racing directory."""
    import ctypes
    import errno
    import os
    import sys
    if os.name == 'nt':
        os.rename(source, destination)  # Windows rename refuses existing targets.
        return
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        symbol = 'renamex_np'
    elif sys.platform.startswith('linux'):
        symbol = 'renameat2'
    else:
        raise OSError('Exclusive directory publication unsupported on this platform')
    rename = getattr(libc, symbol, None)
    if rename is None:
        raise OSError(errno.ENOSYS,
                      f'Exclusive directory publication unsupported: {symbol} unavailable')
    if sys.platform == 'darwin':
        rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        status = rename(os.fsencode(source), os.fsencode(destination), 4)  # RENAME_EXCL
    elif sys.platform.startswith('linux'):
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        status = rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1)  # RENAME_NOREPLACE
    if status:
        code = ctypes.get_errno()
        if code in (errno.EEXIST, errno.ENOTEMPTY):
            raise FileExistsError(code, os.strerror(code), destination)
        raise OSError(code, os.strerror(code), destination)


@contextmanager
def _atomic_output(output: Path) -> Iterator[Path]:
    """Yield a same-filesystem stage, then publish once under a parent lock."""
    import os
    import shutil
    import tempfile
    output = Path(output).absolute()
    _reject_symlinks(output)
    if output.exists():
        raise FileExistsError(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f'.{output.name}-stage-', dir=output.parent))
    try:
        yield stage
        _reject_symlinks(output)
        # Lock the parent directory itself: no removable lock-file inode race.
        if os.name == 'nt':
            _rename_no_replace(stage, output)
        else:
            import fcntl
            descriptor = os.open(output.parent, os.O_RDONLY)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX)
                if output.exists() or output.is_symlink():
                    raise FileExistsError(output)
                _rename_no_replace(stage, output)
            finally:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def write_forecast(output: Path, *, artifacts: ArtifactCollection,
                   provenance: Mapping[str, Any], implementation: Mapping[str, Any]) -> dict[str, Any]:
    """Publish prediction-only JSON and CSV to a new directory after validation.

    ``artifacts`` maps safe basin IDs to ForecastArtifact values (an iterable
    of pairs also permits explicit duplicate detection). ``provenance`` owns
    dataset_version, dataset_status, public_release_blockers, library_version
    and data_library_version; implementation must identify both distributions.
    Existing directories, including empty ones, are never replaced.
    """
    from .validation import validate_forecast_directory
    items = _artifact_items(artifacts)
    _forecast_document(items, provenance, implementation)  # Reject before stage creation.
    with _atomic_output(output) as stage:
        result = _write_forecast_files(stage, artifacts=items, provenance=provenance,
                                       implementation=implementation)
        validate_forecast_directory(stage)
    return result
