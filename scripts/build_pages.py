"""Package the browser client without local data, documents or credentials."""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def build(api_base: str, destination: Path):
    address = urlsplit(api_base)
    if (address.scheme != "https" or not address.hostname or address.username
            or address.password or address.query or address.fragment or address.path not in ("", "/")):
        raise ValueError("Укажите HTTPS-адрес сервера без пути, пароля и параметров")
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / "static", destination / "static", dirs_exist_ok=True)
    shutil.copyfile(ROOT / "static" / "index.html", destination / "index.html")
    config = {"apiBase": api_base.rstrip("/")}
    (destination / "static" / "config.js").write_text(
        "'use strict';\nwindow.CITY_CONFIG = " + json.dumps(config) + ";\n", encoding="utf-8")
    html_path = destination / "index.html"
    def version_script(match):
        path = match.group(1)
        version = hashlib.sha256((destination / path).read_bytes()).hexdigest()[:12]
        return f'src="{path}?v={version}"'
    html_path.write_text(re.sub(r'src="(static/[^"?]+\.js)(?:\?[^\"]*)?"', version_script,
                               html_path.read_text(encoding="utf-8")), encoding="utf-8")
    (destination / ".nojekyll").write_text("", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "pages")
    args = parser.parse_args()
    build(args.api_base, args.output)
