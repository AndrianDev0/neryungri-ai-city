"""Check the lock file without downloading anything on an ordinary startup."""

from importlib.metadata import PackageNotFoundError, version
from pathlib import Path


def missing_requirements(lock_path, installed_version=version):
    missing = []
    for line in lock_path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, expected = line.split("==", 1)
        try:
            if installed_version(name) != expected:
                missing.append(line)
        except PackageNotFoundError:
            missing.append(line)
    return missing


if __name__ == "__main__":
    lock = Path(__file__).resolve().parent.parent / "requirements-lock.txt"
    missing = missing_requirements(lock)
    if missing:
        print("Dependencies to restore: " + ", ".join(missing))
    raise SystemExit(bool(missing))
