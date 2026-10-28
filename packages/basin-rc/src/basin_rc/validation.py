"""Validate saved viewer artifacts, identities, causal grids and metric counts."""

import csv
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from importlib.resources import files
from typing import Any

SCHEMAS = files(__package__).joinpath("_schemas")
HOUR = 3600
DECIMAL_NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def safe_path(path: str) -> str:
    require(
        isinstance(path, str)
        and bool(re.fullmatch(r"[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*", path)),
        "Unsafe artifact path",
    )
    require(
        all(part not in (".", "..") for part in path.split("/")), "Unsafe artifact path"
    )
    return path


def utc_seconds(value: str) -> float:
    require(
        isinstance(value, str)
        and bool(
            re.fullmatch(
                r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)", value
            )
        ),
        "Expected explicit UTC timestamp",
    )
    # Python 3.10 accepts exactly 3 or 6 fractional digits. Normalize only
    # for datetime parsing; hourly_utc_seconds checks every original digit
    # before this microsecond conversion so discarded digits cannot hide a
    # nonzero subhour timestamp.
    normalized = re.sub(
        r"\.([0-9]+)(?=Z|\+00:00$)",
        lambda match: "." + match[1][:6].ljust(6, "0"),
        value,
    )
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00")).timestamp()
    except ValueError as error:
        raise ValueError("Invalid UTC timestamp") from error


def hourly_utc_seconds(value: str) -> float:
    require(
        not re.search(r"\.\d*[1-9]\d*(?:Z|\+00:00)$", value),
        "Subhour timestamp precision is unsupported",
    )
    seconds = utc_seconds(value)
    require(seconds % HOUR == 0, "Expected hourly UTC timestamp")
    return seconds


def finite(value: Any) -> bool:
    try:
        return (
            isinstance(value, (float, int))
            and not isinstance(value, bool)
            and math.isfinite(value)
        )
    except OverflowError:
        return False


def _validate_alpha_selection(alpha: Any, metrics: Any) -> dict[float, float]:
    """Check saved candidate consistency, without recomputing validation RMSE."""
    require(isinstance(metrics, dict) and bool(metrics), "Invalid validation metrics")
    candidates = {}
    for key, rmse in metrics.items():
        require(isinstance(key, str) and DECIMAL_NUMBER.fullmatch(key) is not None,
                "Invalid alpha candidate key")
        candidate = float(key)
        require(finite(candidate) and candidate >= 0, "Invalid alpha candidate")
        require(candidate not in candidates, "Duplicate numeric alpha candidate")
        require(finite(rmse) and rmse >= 0, "Invalid validation RMSE")
        candidates[candidate] = rmse
    require(finite(alpha) and alpha >= 0 and alpha in candidates,
            "Selected alpha missing from validation candidates")
    require(candidates[alpha] == min(candidates.values()),
            "Selected alpha is not a saved validation RMSE minimum")
    return candidates


def schema_validate(value: Any, name: str) -> None:
    try:
        from jsonschema import Draft202012Validator
    except ImportError as error:
        raise ImportError(
            'Saved-result validation requires jsonschema; install "basin-rc[validation]" '
            'for the SDK, or "jsonschema" for standalone candidates and checkout scripts.'
        ) from error

    schema = json.loads((SCHEMAS / f"{name}.schema.json").read_text())
    errors = list(Draft202012Validator(schema).iter_errors(value))
    require(not errors, f"{name} schema: {errors[0].message if errors else ''}")

    def no_nan(data: Any) -> None:
        if isinstance(data, (int, float)) and not isinstance(data, bool):
            try:
                is_finite = math.isfinite(data)
            except OverflowError:
                is_finite = False
            require(is_finite, "Nonfinite JSON number")
        elif isinstance(data, dict):
            for item in data.values():
                no_nan(item)
        elif isinstance(data, list):
            for item in data:
                no_nan(item)

    no_nan(value)
    if name == "results":
        for result in value["results"]:
            _validate_alpha_selection(result["alpha"], result["validation_rmse"])


def parse_series_csv(text: str) -> list[dict[str, Any]]:
    require(isinstance(text, str) and '"' not in text, "Unsupported/malformed CSV")
    text = text.replace("\r\n", "\n")
    require("\r" not in text, "Unsupported/malformed CSV")
    lines = text.split("\n")
    if lines[-1] == "":
        lines.pop()
    require(len(lines) > 1 and all(lines), "Empty/malformed CSV")
    reader = csv.DictReader(lines)
    require(
        reader.fieldnames is not None
        and len(set(reader.fieldnames)) == 9
        and set(reader.fieldnames)
        == {
            "origin_time",
            "target_time",
            "accepted",
            "reason",
            "partition",
            "q",
            "rain",
            "observed",
            "prediction",
        },
        "Unexpected CSV columns",
    )
    rows = []
    for raw in reader:
        require(
            None not in raw and all(value is not None for value in raw.values()),
            "Malformed CSV row",
        )
        require(
            raw["accepted"] in ("True", "False"), "Expected Python boolean CSV value"
        )
        row = {**raw, "accepted": raw["accepted"] == "True"}
        for name in ("q", "rain", "observed", "prediction"):
            require(raw[name] == "" or DECIMAL_NUMBER.fullmatch(raw[name]), "Invalid CSV numeric value")
            row[name] = None if raw[name] == "" else float(raw[name])
            require(row[name] is None or finite(row[name]), "Nonfinite CSV value")
        rows.append(row)
    schema_validate(rows, "series")
    return rows


def validate_bundle(
    results: dict[str, Any],
    basins: dict[str, Any],
    stations: dict[str, Any],
    series: dict[str, list[dict[str, Any]]],
) -> bool:
    schema_validate(results, "results")
    for rows in series.values():
        schema_validate(rows, "series")
    return _validate_bundle_semantics(results, basins, stations, series)


def _validate_bundle_semantics(
    results: dict[str, Any],
    basins: dict[str, Any],
    stations: dict[str, Any],
    series: dict[str, list[dict[str, Any]]],
) -> bool:
    """Results and every series must already have passed schema validation."""
    for package, key in (
        ("basin-rc", "library_version"),
        ("basin-data", "data_library_version"),
    ):
        require(
            results["implementation"]["packages"][package]["version"] == results[key],
            "Implementation package version mismatch",
        )
    for geo in (basins, stations):
        schema_validate(geo, "geojson")
        for key in (
            "schema_version",
            "dataset_version",
            "library_version",
            "data_library_version",
        ):
            require(geo[key] == results[key], f"Mixed {key}")
    ids = [item["basin_id"] for item in results["results"]]
    require(
        len(set(ids)) == len(ids) and set(series) == set(ids),
        "Duplicate or unknown series ID",
    )
    basin_ids = [
        feature["properties"].get("basin_id") for feature in basins["features"]
    ]
    require(
        len(set(basin_ids)) == len(basin_ids) and set(basin_ids) == set(ids),
        "Unknown basin geometry ID",
    )
    for feature in basins["features"]:
        props = feature["properties"]
        require(
            set(props) == {"basin_id", "name", "area_km2", "source_id", "cand_id"},
            "Invalid basin properties",
        )
        require(
            isinstance(props["name"], str)
            and props["name"]
            and finite(props["area_km2"])
            and props["area_km2"] > 0
            and isinstance(props["source_id"], str)
            and (props["cand_id"] is None or isinstance(props["cand_id"], str)),
            "Invalid basin metadata",
        )
        require(
            feature["geometry"]["type"] in ("Polygon", "MultiPolygon"),
            "Expected basin polygon",
        )
        polygons = (
            [feature["geometry"]["coordinates"]]
            if feature["geometry"]["type"] == "Polygon"
            else feature["geometry"]["coordinates"]
        )
        require(bool(polygons), "Empty basin geometry")
        for polygon in polygons:
            require(bool(polygon), "Empty polygon")
            for ring in polygon:
                require(len(ring) >= 4 and ring[0] == ring[-1], "Invalid polygon ring")
                for point in ring:
                    validate_point(point)
    roles = {basin_id: [] for basin_id in ids}
    for feature in stations["features"]:
        props = feature["properties"]
        require(
            set(props) == {"basin_id", "station_id", "name", "role", "source_url"},
            "Invalid station properties",
        )
        require(
            props["basin_id"] in roles and props["role"] in ("streamflow", "rain"),
            "Unknown station ID/role",
        )
        require(
            all(
                isinstance(props[key], str) and props[key]
                for key in ("station_id", "name", "source_url")
            )
            and props["source_url"].startswith("https://"),
            "Invalid station metadata",
        )
        if props["role"] == "streamflow":
            expected = next(
                feature["properties"]["source_id"]
                for feature in basins["features"]
                if feature["properties"]["basin_id"] == props["basin_id"]
            )
            require(
                props["station_id"] == expected, "Streamflow station/source ID mismatch"
            )
        roles[props["basin_id"]].append(props["role"])
        require(feature["geometry"]["type"] == "Point", "Expected station Point")
        validate_point(feature["geometry"]["coordinates"])
    require(
        all(sorted(value) == ["rain", "streamflow"] for value in roles.values()),
        "Require two matching station roles",
    )
    paths = [safe_path(results["basins_path"]), safe_path(results["stations_path"])]
    paths += [safe_path(item["prediction_path"]) for item in results["results"]]
    require(
        len(set(paths)) == len(paths) and set(results["artifact_sha256"]) == set(paths),
        "Artifact hash/path identity mismatch",
    )
    for result in results["results"]:
        _validate_series_semantics(result, series[result["basin_id"]])
        validate_extension_series(result, series[result["basin_id"]])
    utc_seconds(results["generated_at"])
    return True



def validate_extension_series(result: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    """Validate saved display values; never infer adoption or comparison metrics."""
    items = result.get("extensions", {}).get("series", [])
    ids = [item["id"] for item in items]
    require(len(set(ids)) == len(ids), "Duplicate extension series ID")
    for item in items:
        require(len(item["values"]) == len(rows), "Extension series must match full CSV grid")


def validate_point(point: list) -> None:
    require(
        len(point) == 2
        and all(finite(value) for value in point)
        and -180 <= point[0] <= 180
        and -90 <= point[1] <= 90,
        "Invalid geometry coordinates",
    )


def validate_series(result: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    schema_validate(rows, "series")
    _validate_series_semantics(result, rows)


def _validate_series_semantics(result: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    """Rows must already have passed schema validation."""
    horizon_h = int(result["horizon_h"])
    tau_h = int(result["tau_h"])
    times = [hourly_utc_seconds(row["target_time"]) for row in rows]
    require(
        all(value % HOUR == 0 for value in times)
        and all(right - left == HOUR for left, right in zip(times, times[1:])),
        "CSV must preserve full hourly grid",
    )
    keys = [
        "train_period_start",
        "train_period_end",
        "valid_period_start",
        "valid_period_end",
        "period_start",
        "period_end",
    ]
    ts = {
        key: hourly_utc_seconds(result[key])
        for key in keys + ["fit_cutoff", "selection_cutoff"]
    }
    require(
        ts[keys[0]] == times[0]
        and ts[keys[-1]] == times[-1] + HOUR
        and ts[keys[1]] == ts[keys[2]]
        and ts[keys[3]] == ts[keys[4]]
        and ts[keys[0]] < ts[keys[1]] < ts[keys[3]] < ts[keys[5]],
        "Partition periods must cover the full grid",
    )
    require(
        ts["fit_cutoff"] == ts["train_period_end"]
        and ts["selection_cutoff"] == ts["valid_period_end"],
        "Causal cutoff mismatch",
    )
    grouped = {name: [] for name in ("train", "valid", "test")}
    for i, row in enumerate(rows):
        time = times[i]
        origin = hourly_utc_seconds(row["origin_time"])
        require(
            time - origin == result["horizon_h"] * HOUR,
            "Origin/target horizon mismatch",
        )
        partition = (
            "train"
            if time < ts["train_period_end"]
            else "valid"
            if time < ts["valid_period_end"]
            else "test"
        )
        require(row["partition"] == partition, "CSV partition mismatch")
        for key in ("q", "rain", "observed", "prediction"):
            require(row[key] is None or finite(row[key]), "Nonfinite series number")
        require(
            row["q"] == row["observed"], "Observed target must match q at target_time"
        )
        require(
            all(row[key] is None or row[key] >= 0 for key in ("q", "rain", "observed")),
            "Negative observation",
        )
        context = i < result["tau_h"] + result["horizon_h"]
        cutoff = (
            None
            if partition == "train"
            else ts["fit_cutoff"]
            if partition == "valid"
            else ts["selection_cutoff"]
        )
        missing = row["observed"] is None or (
            not context
            and any(
                rows[j][name] is None
                for j in range(
                    i - horizon_h - tau_h,
                    i - horizon_h + 1,
                )
                for name in result["inputs"]
            )
        )
        reason = (
            "context"
            if context
            else "origin_before_cutoff"
            if cutoff is not None and origin < cutoff
            else "missing"
            if missing
            else "accepted"
        )
        require(
            row["reason"] == reason and row["accepted"] == (reason == "accepted"),
            "CSV acceptance/reason violates causal or missing contract",
        )
        require(
            (row["prediction"] is not None)
            == (partition == "test" and row["accepted"]),
            "Predictions only belong to accepted test rows",
        )
        grouped[partition].append(row)
    for name, group in grouped.items():
        counts = {
            "n_samples": sum(row["accepted"] for row in group),
            "n_context": sum(row["reason"] == "context" for row in group),
            "excluded_by_reason": {
                reason: sum(row["reason"] == reason for row in group)
                for reason in ("missing", "origin_before_cutoff")
            },
        }
        counts["n_excluded"] = sum(counts["excluded_by_reason"].values())
        require(counts == result["partitions"][name], f"{name} counts mismatch")
        if name == "test":
            require(
                all(result[key] == value for key, value in counts.items()),
                "Metric denominator/count mismatch",
            )
    accepted = [row for row in grouped["test"] if row["accepted"]]
    require(bool(accepted), "Empty accepted test rows")
    observed = [row["observed"] for row in accepted]
    numerator = sum((row["prediction"] - row["observed"]) ** 2 for row in accepted)
    mean = sum(observed) / len(observed)
    denominator = sum((value - mean) ** 2 for value in observed)
    rmse = math.sqrt(numerator / len(observed))
    nse = None if denominator == 0 else 1 - numerator / denominator
    require(
        math.isclose(result["rmse"], rmse, rel_tol=1e-9, abs_tol=1e-10), "RMSE mismatch"
    )
    require(result["value"] == result["nse"], "NSE/value mismatch")
    if nse is None:
        require(
            result["nse"] is None and result["nse_reason"] == "constant_target",
            "Undefined NSE needs constant_target reason",
        )
    else:
        require(
            finite(result["nse"])
            and math.isclose(result["nse"], nse, rel_tol=1e-9, abs_tol=1e-10)
            and result["nse_reason"] is None,
            "NSE mismatch",
        )

    baseline = result["baselines"]["persistence"]
    require(
        baseline["method"] == "origin_observation"
        and baseline["horizon_h"] == result["horizon_h"],
        "Persistence method/horizon mismatch",
    )
    for key in ("n_samples", "n_excluded", "excluded_by_reason", "n_context"):
        require(baseline[key] == result[key], "Persistence evaluation counts mismatch")
    q_by_time = {time: row["q"] for time, row in zip(times, rows)}
    origin_values = [
        q_by_time.get(hourly_utc_seconds(row["origin_time"])) for row in accepted
    ]
    require(
        all(finite(value) for value in origin_values),
        "Persistence needs finite origin q from the complete CSV grid",
    )
    persistence_error = sum(
        (origin - row["observed"]) ** 2 for origin, row in zip(origin_values, accepted)
    )
    persistence_rmse = math.sqrt(persistence_error / len(accepted))
    persistence_nse = None if denominator == 0 else 1 - persistence_error / denominator
    require(
        math.isclose(baseline["rmse"], persistence_rmse, rel_tol=1e-9, abs_tol=1e-10),
        "Persistence RMSE mismatch",
    )
    if persistence_nse is None:
        require(
            baseline["nse"] is None and baseline["nse_reason"] == "constant_target",
            "Undefined persistence NSE needs constant_target reason",
        )
    else:
        require(
            finite(baseline["nse"])
            and math.isclose(
                baseline["nse"], persistence_nse, rel_tol=1e-9, abs_tol=1e-10
            )
            and baseline["nse_reason"] is None,
            "Persistence NSE mismatch",
        )


def validate_directory(root: Path) -> dict[str, Any]:
    results = json.loads((root / "results.json").read_text())
    schema_validate(results, "results")
    # Paths are rejected before any artifact is opened, including symlink escapes.
    declared = [results["basins_path"], results["stations_path"]] + [
        item["prediction_path"] for item in results["results"]
    ]
    require(
        len(set(declared)) == len(declared)
        and set(declared) == set(results["artifact_sha256"]),
        "Artifact hash/path identity mismatch",
    )
    safe_path(results["basins_path"])
    safe_path(results["stations_path"])
    for item in results["results"]:
        safe_path(item["prediction_path"])
    for path, digest in results["artifact_sha256"].items():
        safe_path(path)
        resolved = (root / path).resolve()
        require(
            resolved.is_relative_to(root.resolve()),
            "Artifact symlink escapes output directory",
        )
        require(
            hashlib.sha256(resolved.read_bytes()).hexdigest() == digest,
            "Artifact SHA-256 mismatch",
        )
    basins = json.loads((root / results["basins_path"]).read_text())
    stations = json.loads((root / results["stations_path"]).read_text())
    series = {
        item["basin_id"]: parse_series_csv((root / item["prediction_path"]).read_text())
        for item in results["results"]
    }
    _validate_bundle_semantics(results, basins, stations, series)
    return {
        "results": results,
        "basins": basins,
        "stations": stations,
        "series": series,
    }



def validate_forecast_document(results: dict[str, Any]) -> None:
    """Validate prediction-only metadata using the unchanged results schema.

    The schema's geographic path requirements are projected solely for schema
    checking. No geometry is created, opened, or claimed to have been checked.
    """
    require('basins_path' not in results and 'stations_path' not in results,
            'Prediction-only results must not declare geographic artifacts')
    schema_validate({**results, 'basins_path': 'basins.geojson',
                     'stations_path': 'stations.geojson'}, 'results')
    for package, key in (('basin-rc', 'library_version'), ('basin-data', 'data_library_version')):
        require(results['implementation']['packages'][package]['version'] == results[key],
                'Implementation package version mismatch')
    ids = [item['basin_id'] for item in results['results']]
    require(len(set(ids)) == len(ids), 'Duplicate series ID')
    require(all(re.fullmatch(r'[A-Za-z0-9_-]+', identifier) for identifier in ids),
            'Unsafe basin ID')
    paths = [safe_path(item['prediction_path']) for item in results['results']]
    require(len(set(paths)) == len(paths) and set(results['artifact_sha256']) == set(paths),
            'Artifact hash/path identity mismatch')
    require(all(path.endswith('.csv') for path in paths), 'Expected prediction CSV paths')
    utc_seconds(results['generated_at'])


def validate_forecast_directory(root: Path, *, normalize_timestamps: bool = False) -> dict[str, Any]:
    """Check prediction-only hashes, schema and causal series; no geography.

    Legacy wrappers may normalize space-separated UTC CSV timestamps only for
    validation. Hashes always refer to the original bytes on disk.
    """
    root = Path(root)
    require(not any(path.is_symlink() for path in (root, *root.parents)),
            'Symlink result directory')
    require(not (root / 'results.json').is_symlink(), 'Symlink results JSON')
    results = json.loads((root / 'results.json').read_text(encoding='utf-8'))
    validate_forecast_document(results)
    series = {}
    for item in results['results']:
        relative = item['prediction_path']
        path = root / relative
        require(not any(part.is_symlink() for part in (path, *path.parents)),
                'Symlink prediction artifact')
        require(path.resolve().is_relative_to(root.resolve()), 'Artifact escapes result directory')
        payload = path.read_bytes()
        require(hashlib.sha256(payload).hexdigest() == results['artifact_sha256'][relative],
                'Artifact SHA-256 mismatch')
        text = payload.decode('utf-8')
        if normalize_timestamps:
            reader = csv.DictReader(text.splitlines())
            raw_rows = list(reader)
            for row in raw_rows:
                for key in ('origin_time', 'target_time'):
                    row[key] = row[key].replace(' ', 'T')
            import io
            buffer = io.StringIO()
            writer = csv.DictWriter(buffer, fieldnames=reader.fieldnames, lineterminator='\n')
            writer.writeheader()
            writer.writerows(raw_rows)
            text = buffer.getvalue()
        rows = parse_series_csv(text)
        validate_series(item, rows)
        validate_extension_series(item, rows)
        series[item['basin_id']] = rows
    return {'results': results, 'series': series}
