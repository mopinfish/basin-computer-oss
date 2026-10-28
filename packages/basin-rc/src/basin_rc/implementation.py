"""Identify executed code without retaining local paths or archive URLs.

The commit describes the generator's repository, not the installed wheel's
source. Dirty state includes staged and unstaged tracked changes and excludes
untracked files. Unknown repository or wheel provenance is represented by None.
"""

import hashlib
import json
import subprocess
from importlib import metadata
from pathlib import Path
from types import ModuleType


def _source_identity(generator: Path) -> tuple[str | None, bool | None]:
    def git(*args: str) -> str:
        return subprocess.run(
            ['git', '-C', str(generator.parent), *args], check=True,
            capture_output=True, text=True,
        ).stdout.strip()

    try:
        root = Path(git('rev-parse', '--show-toplevel')).resolve()
        relative = generator.resolve().relative_to(root).as_posix()
        # An installed or untracked file inside a checkout is not its source.
        git('-C', str(root), 'ls-files', '--error-unmatch', '--', f':(literal){relative}')
        commit = git('rev-parse', '--verify', 'HEAD')
        dirty = bool(git('status', '--porcelain', '--untracked-files=no'))
        return commit, dirty
    except (OSError, subprocess.SubprocessError, ValueError):
        return None, None


def _python_sources_sha256(module: ModuleType) -> str:
    source = Path(module.__file__).resolve()
    root = source.parent
    files = sorted(root.rglob('*.py')) if source.name == '__init__.py' else [source]
    digest = hashlib.sha256()
    for path in files:
        name = path.relative_to(root).as_posix().encode('utf-8')
        content = path.read_bytes()
        # Length framing prevents ambiguity between names and file contents.
        digest.update(len(name).to_bytes(8, 'big'))
        digest.update(name)
        digest.update(len(content).to_bytes(8, 'big'))
        digest.update(content)
    return digest.hexdigest()


def _wheel_sha256(name: str, module: ModuleType) -> str | None:
    try:
        distribution = metadata.distribution(name)
        if distribution.version != module.__version__:
            return None
        source = Path(module.__file__).resolve()
        if not any(
            Path(distribution.locate_file(file)).resolve() == source
            for file in (distribution.files or ())
        ):
            return None
        direct_url = json.loads(distribution.read_text('direct_url.json') or '{}')
        archive = direct_url.get('archive_info', {})
        value = archive.get('hashes', {}).get('sha256')
        if value is None:
            legacy = archive.get('hash', '')
            value = legacy.removeprefix('sha256=') if legacy.startswith('sha256=') else None
        if isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdefABCDEF' for c in value):
            return value.lower()
    except (metadata.PackageNotFoundError, OSError, ValueError, TypeError, AttributeError):
        pass
    return None


def implementation_identity(generator: Path, modules: dict[str, ModuleType]) -> dict:
    """Return generator and imported package fingerprints using local evidence.

    Package keys must be distribution names. Python source digests hash sorted
    relative .py names and contents, each framed with an eight-byte big-endian
    length. A wheel digest is reported only from matching installed metadata;
    no wheel digest is embedded into its own source tree.
    """
    generator = generator.resolve()
    commit, dirty = _source_identity(generator)
    return {
        'generator_sha256': hashlib.sha256(generator.read_bytes()).hexdigest(),
        'source_commit': commit,
        'source_dirty': dirty,
        'packages': {
            name: {
                'version': module.__version__,
                'python_sources_sha256': _python_sources_sha256(module),
                'wheel_sha256': _wheel_sha256(name, module),
            }
            for name, module in sorted(modules.items())
        },
    }
