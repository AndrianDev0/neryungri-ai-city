from importlib.metadata import PackageNotFoundError

from scripts.check_dependencies import missing_requirements


def test_interrupted_install_requires_repair(tmp_path):
    lock = tmp_path / "requirements-lock.txt"
    lock.write_text("fastapi==1.0\nuvicorn==2.0\n", encoding="utf-8-sig")

    def partially_installed(name):
        if name == "fastapi":
            return "1.0"
        raise PackageNotFoundError(name)

    assert missing_requirements(lock, partially_installed) == ["uvicorn==2.0"]


def test_incorrect_dependency_version_requires_repair(tmp_path):
    lock = tmp_path / "requirements-lock.txt"
    lock.write_text("# pinned packages\n\nfastapi==1.0\n", encoding="utf-8")
    assert missing_requirements(lock, lambda name: "0.9") == ["fastapi==1.0"]
    assert missing_requirements(lock, lambda name: "1.0") == []
