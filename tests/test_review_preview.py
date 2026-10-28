import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def preview_module():
    spec = importlib.util.spec_from_file_location("build_review_preview", ROOT / "scripts/build_review_preview.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_preview_is_synthetic_valid_and_reproducible(tmp_path):
    module = preview_module()
    first, second = tmp_path / "first", tmp_path / "second"
    module.build_preview(first)
    module.build_preview(second)
    data = json.loads((first / "data/results.json").read_text())
    assert data["schema_version"] == "0.3"
    assert [r["basin_id"] for r in data["results"]] == module.BASIN_IDS
    assert data["extensions"]["synthetic"] is True
    assert "合成値" in data["extensions"]["synthetic_identity_note"]
    assert data["implementation"]["source_commit"] is None
    assert "合成データの基準日時" in (first / "app.mjs").read_text()
    assert data["artifact_sha256"] == json.loads((second / "data/results.json").read_text())["artifact_sha256"]
    for result in data["results"]:
        assert result["horizon_h"] == 6
        assert result["n_samples"] == 234
        assert result["n_excluded"] == 6
        assert len(result["extensions"]["series"]) == 3
        assert any(value is None for value in result["extensions"]["series"][1]["values"])
    html = (first / "index.html").read_text()
    assert "合成データ" in html
    assert "観測値：国土交通省" not in html
    assert "2023〜2024年の保存済み観測" not in html
    assert not (first / "data/manifest.json").exists()


def test_preview_never_overwrites_existing_or_real_viewer(tmp_path):
    import pytest
    module = preview_module()
    protected = tmp_path / "protected"
    protected.mkdir()
    existing = protected / "keep.txt"
    existing.write_text("keep")
    with pytest.raises(ValueError, match="empty directory"):
        module.build_preview(protected)
    assert existing.read_text() == "keep"
    with pytest.raises(ValueError, match="must not overwrite"):
        module.build_preview(ROOT / "viewer")
