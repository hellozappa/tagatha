#!/usr/bin/env python3
"""Install Tagatha's built runtime files with a recoverable backup."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", required=True, type=Path, help="Existing vault path")
    parser.add_argument("--dry-run", action="store_true", help="Show targets without writing")
    parser.add_argument(
        "--reload", action="store_true", help="Reload Tagatha using Obsidian CLI after installation"
    )
    args = parser.parse_args()
    vault = args.vault.expanduser().resolve()
    repo = Path(__file__).resolve().parent.parent
    if not (vault / ".obsidian").is_dir():
        parser.error(f"Not an Obsidian vault: {vault}")
    assets = [repo / "main.js", repo / "manifest.json"]
    for asset in assets:
        if not asset.is_file():
            parser.error(f"Missing runtime asset: {asset}. Run npm run build first.")
    manifest = json.loads(assets[1].read_text())
    if manifest.get("id") != "tagatha":
        parser.error("The build manifest must identify tagatha")
    target = vault / ".obsidian" / "plugins" / "tagatha"
    if target.exists() and not target.is_dir():
        parser.error(f"Plugin destination is not a directory: {target}")
    if args.reload and not args.dry_run and shutil.which("obsidian") is None:
        parser.error("Obsidian CLI is required for --reload")
    print(f"Destination: {target}", flush=True)
    if args.dry_run:
        for asset in assets:
            print(f"Install: {asset.name}")
        print("Settings: data.json is not copied or replaced")
        if args.reload:
            print(f"Reload: obsidian vault={vault.name} plugin:reload id=tagatha")
        return

    backup = Path(tempfile.mkdtemp(prefix="tagatha-runtime-backup-"))
    print(f"Backup: {backup}", flush=True)
    for asset in assets:
        installed = target / asset.name
        if installed.exists():
            shutil.copy2(installed, backup / asset.name)
    target.mkdir(parents=True, exist_ok=True)
    for asset in assets:
        installed = target / asset.name
        shutil.copy2(asset, installed)
        if installed.read_bytes() != asset.read_bytes():
            raise RuntimeError(f"Installed asset differs from build: {installed}; backup: {backup}")
    print("Installed assets match the build; data.json was not replaced.", flush=True)
    if args.reload:
        subprocess.run(
            ["obsidian", f"vault={vault.name}", "plugin:reload", "id=tagatha"], check=True
        )
        subprocess.run(["obsidian", f"vault={vault.name}", "dev:errors"], check=True)


if __name__ == "__main__":
    main()
