"""Validate saved viewer artifacts, identities, causal grids and metric counts."""

import argparse
import importlib.util
import sys
from pathlib import Path

_source = Path(__file__).resolve().parents[1] / "packages/basin-rc/src/basin_rc"
if _source.is_dir() and "basin_rc.validation" not in sys.modules:
    # A source checkout can validate saved results with Python + jsonschema only.
    # Give resources a package spec, without executing the SDK's prediction imports.
    _package_name = "_basin_rc_validation"
    if _package_name not in sys.modules:
        _spec = importlib.util.spec_from_file_location(
            _package_name, _source / "__init__.py", submodule_search_locations=[str(_source)]
        )
        sys.modules[_package_name] = importlib.util.module_from_spec(_spec)
    _module_name = _package_name + ".validation"
    if _module_name not in sys.modules:
        _spec = importlib.util.spec_from_file_location(_module_name, _source / "validation.py")
        _validation = importlib.util.module_from_spec(_spec)
        sys.modules[_module_name] = _validation
        _spec.loader.exec_module(_validation)
    else:
        _validation = sys.modules[_module_name]
else:
    from basin_rc import validation as _validation

# Preserve every existing helper as well as both validation entry points.
for _name in dir(_validation):
    if not _name.startswith("_"):
        globals()[_name] = getattr(_validation, _name)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args(argv)
    bundle = validate_directory(args.directory)
    print(f"Validated {len(bundle['results']['results'])} basin result(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
