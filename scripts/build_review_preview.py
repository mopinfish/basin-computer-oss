"""Build a reproducible synthetic viewer preview without touching the real demo."""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import importlib.util
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BASIN_IDS = ["synthetic-a", "synthetic-b", "synthetic-c"]
BASIN_NAMES = ["合成流域A", "合成流域B", "合成流域C"]
COLUMNS = ["origin_time", "target_time", "accepted", "reason", "partition", "q", "rain", "observed", "prediction"]


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def build_preview(output: Path) -> None:
    """Write isolated synthetic assets, then validate hashes and causal contracts."""
    output = output.resolve()
    if output == ROOT / "viewer" or output.is_relative_to(ROOT / "viewer"):
        raise ValueError("Preview output must not overwrite viewer assets or real data")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Preview output must be an empty directory")
    output.mkdir(parents=True, exist_ok=True)
    for path in (ROOT / "viewer").iterdir():
        if path.is_file() and path.suffix in {".html", ".css", ".mjs"}:
            shutil.copyfile(path, output / path.name)
    app_path = output / "app.mjs"
    app_path.write_text(app_path.read_text(encoding="utf-8").replace("生成日時", "合成データの基準日時"), encoding="utf-8")
    html_path = output / "index.html"
    html = html_path.read_text(encoding="utf-8")
    html = html.replace("流域の保存結果から、予測の適用条件と追加検証の必要性を確認します。リアルタイム予測ではありません。", "目視確認専用の合成データです。実際の観測・研究結果・流域形状ではありません。2024年1月の30日間の人工系列で表示を確認します。")
    html = html.replace("観測値：国土交通省 水文水質データベース（PDL1.0）。集水域：J-FlwDir（CC BY 4.0）。源泉と加工の詳細は配布物のデータ来歴一覧と利用条件を参照してください。", "値・流域形状・観測点はすべて合成データです。実データの出典・利用条件を示すものではありません。")
    html = html.replace("非公開アルファ版", "合成データで動作確認").replace("<title>", "<title>合成データ確認 | ")
    html_path.write_text(html, encoding="utf-8")
    data = output / "data"
    (data / "predictions").mkdir(parents=True)
    template = json.loads((ROOT / "tests/fixtures/viewer_bundle.json").read_text())
    results = copy.deepcopy(template["results"])
    results.update(schema_version="0.3", dataset_version="synthetic-public-v1", results=[], artifact_sha256={}, public_release_blockers=["表示確認専用の合成データです。研究結果や実際の観測ではありません。"], extensions={"synthetic": True, "purpose": "表示確認専用。値・形状はすべて合成。性能評価に使用しない。"})
    results["extensions"]["synthetic_identity_note"] = (
        "生成日時・パッケージ実装ハッシュはテストfixtureの合成値です。"
        "実際のデータ生成日や実行版の証拠として使用しません。"
        "generator_sha256のみ、この合成preview生成スクリプトの識別情報です。"
    )
    results["implementation"]["source_commit"] = None
    results["implementation"]["source_dirty"] = None
    results["implementation"]["generator_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    basins, stations = copy.deepcopy(template["basins"]), copy.deepcopy(template["stations"])
    for geo in (basins, stations):
        geo.update(schema_version="0.3", dataset_version=results["dataset_version"], features=[])
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    stamp = lambda hour: (start + timedelta(hours=hour)).isoformat()
    for number, (basin_id, name) in enumerate(zip(BASIN_IDS, BASIN_NAMES)):
        item = copy.deepcopy(template["results"]["results"][0])
        item.update(basin_id=basin_id, horizon_h=6, train_period_start=stamp(0), train_period_end=stamp(240), valid_period_start=stamp(240), valid_period_end=stamp(480), period_start=stamp(480), period_end=stamp(720), fit_cutoff=stamp(240), selection_cutoff=stamp(480), prediction_path=f"predictions/{basin_id}.csv")
        rows = []
        for i in range(720):
            partition = "train" if i < 240 else "valid" if i < 480 else "test"
            reason = "context" if i < 6 else "origin_before_cutoff" if partition != "train" and i % 240 < 6 else "accepted"
            q = float(10 + number * 5 + i)
            rows.append(dict(origin_time=stamp(i - 6), target_time=stamp(i), accepted=reason == "accepted", reason=reason, partition=partition, q=q, rain=float(i % 7), observed=q, prediction=q + 1 if partition == "test" and reason == "accepted" else None))
        item["partitions"] = {}
        for partition in ("train", "valid", "test"):
            group = [r for r in rows if r["partition"] == partition]
            item["partitions"][partition] = dict(n_samples=sum(r["accepted"] for r in group), n_context=sum(r["reason"] == "context" for r in group), n_excluded=sum(r["reason"] == "origin_before_cutoff" for r in group), excluded_by_reason={"missing": 0, "origin_before_cutoff": sum(r["reason"] == "origin_before_cutoff" for r in group)})
        item.update(copy.deepcopy(item["partitions"]["test"]))
        # Accepted test values are 234 consecutive integers.
        # SSE_model=n; SST=n*(n^2-1)/12. Persistence error is six per row.
        n = item["n_samples"]
        sst = n * (n * n - 1) / 12
        item.update(rmse=1.0, nse=1 - n / sst, value=1 - n / sst, nse_reason=None)
        item["baselines"]["persistence"].update(copy.deepcopy(item["partitions"]["test"]))
        item["baselines"]["persistence"].update(horizon_h=6, rmse=6.0, nse=1 - 36 * n / sst, nse_reason=None)
        item["extensions"] = {"synthetic": True, "series": [
            dict(id="synthetic_full", label="動作確認用の流量系列（連続）", unit="m³/s", evaluation_conditions="表示確認専用・評価対象外", style="dashed", values=[r["q"] + 35 for r in rows], source="合成流量に35m³/sを加えた値"),
            dict(id="synthetic_gap", label="動作確認用の流量系列（欠測あり）", unit="m³/s", evaluation_conditions="表示確認専用・評価対象外", style="dotted", values=[None if 539 <= i <= 541 else r["q"] - 35 for i, r in enumerate(rows)], source="合成流量から35m³/sを引いた値。一部を欠測に設定"),
            dict(id="synthetic_other", label="動作確認用の別単位系列", unit="mm", evaluation_conditions="別単位のため流量軸への表示対象外", style="solid", values=[float(i % 9) for i in range(720)], source="0〜8mmを9時間周期で繰り返す人工系列"),
        ]}
        results["results"].append(item)
        with (data / item["prediction_path"]).open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=COLUMNS)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: "True" if value is True else "False" if value is False else "" if value is None else value for key, value in row.items()})
        basin = copy.deepcopy(template["basins"]["features"][0])
        basin["properties"].update(basin_id=basin_id, source_id=basin_id, name=f"{name}（形状は合成）")
        basins["features"].append(basin)
        for role in ("streamflow", "rain"):
            station = copy.deepcopy(template["stations"]["features"][0])
            station["properties"].update(basin_id=basin_id, station_id=basin_id if role == "streamflow" else f"{basin_id}-rain", name="動作確認用の流量観測点" if role == "streamflow" else "動作確認用の雨量観測点", role=role, source_url="https://example.invalid/synthetic")
            stations["features"].append(station)
    write_json(data / "basins.geojson", basins)
    write_json(data / "stations.geojson", stations)
    for path in ["basins.geojson", "stations.geojson"] + [r["prediction_path"] for r in results["results"]]:
        results["artifact_sha256"][path] = hashlib.sha256((data / path).read_bytes()).hexdigest()
    write_json(data / "results.json", results)
    spec = importlib.util.spec_from_file_location("preview_validator", ROOT / "scripts/validate_viewer_data.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.validate_directory(data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "review-preview")
    build_preview(parser.parse_args().output)
