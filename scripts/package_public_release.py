"""Create a reviewed allowlist deployment archive; never includes local secrets."""
import hashlib
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "release-20261021"
OUT.mkdir(parents=True, exist_ok=True)
files = [ROOT / name for name in ("Dockerfile", ".dockerignore", "requirements-public.txt")]
for folder in ("server", "static", "deploy"):
    for path in (ROOT / folder).rglob("*"):
        if not path.is_file() or "__pycache__" in path.parts:
            continue
        if path.name == "local_secrets.py" or path.suffix in {".pyc", ".log"} or path.name.startswith(".env"):
            continue
        files.append(path)
manifest = []
archive = OUT / "dongdongkou-20261021.tar.gz"
with tarfile.open(archive, "w:gz") as tar:
    for path in sorted(files):
        relative = path.relative_to(ROOT).as_posix()
        assert not any(s in relative.lower() for s in ("secret", ".env", "venv", "cache")), relative
        data = path.read_bytes()
        manifest.append({"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        tar.add(path, arcname=relative, recursive=False)
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"archive": str(archive), "files": len(files), "bytes": archive.stat().st_size, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}, ensure_ascii=False))
