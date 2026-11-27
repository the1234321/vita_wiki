#!/usr/bin/env python3
"""Append missing glossary translations to cn.json.

Usage:
    python alterapso/sync_cn.py [--dry-run] [--data PATH] [--cn PATH]

By default, paths are relative to this script. Existing translations are never
overwritten. New entries are appended in source discovery order.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


SHARD_CHARS = "0123456789abcdef"
SS_RANK_TYPES = {
    "Akimbo": "Mechgun",
    "Cane Style": "Cane",
    "Crossbow": "Shot",
    "Lone Virtue": "Saber",
    "Lone Wolf": "Rifle",
    "Niten": "Twin Sword",
    "Rod Style": "Rod",
    "Slicer": "Slicer",
    "Wand Style": "Wand",
}


def read_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8-sig") as stream:
            return json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Cannot read valid JSON from {path}: {exc}") from exc


def require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} must be a JSON object")
    return value


class CatalogSync:
    def __init__(self, cn: dict[str, Any]) -> None:
        self.cn = cn
        self.item_names: set[str] = set()
        self.keyed_enemy_names: set[str] = set()
        self.counters: Counter[str] = Counter()
        self.additions: list[tuple[str, str, str]] = []

    def record(self, section: str, key: str, detail: str = "") -> None:
        self.counters[section] += 1
        self.additions.append((section, str(key), detail))

    def add_blank(self, section: str, key: Any, detail: str = "") -> None:
        if not isinstance(key, str) or not key or key in self.cn[section]:
            return
        self.cn[section][key] = ""
        self.record(section, key, detail)

    def add_term(self, value: Any) -> None:
        if not isinstance(value, str) or not value.strip():
            return
        key = value
        if key in self.cn["terms"] or key in self.cn["categories"] or key in self.cn["types"]:
            return
        if re.fullmatch(r"[\d\s.,/%:+\-×x★]+", key, re.IGNORECASE):
            return
        if re.fullmatch(r"[0-9a-f]{4,8}", key, re.IGNORECASE):
            return
        # Shared rate formatting handles these phrases without per-rate entries.
        if re.fullmatch(r"\s*\d+\s*/\s*\d+(?:[,.]\d+)?(?:\s+(?:per|base)\b.*)?\s*", key, re.IGNORECASE):
            return
        if re.fullmatch(r"\s*\d+(?:[,.]\d+)?\s*%\s*", key):
            return
        if key in self.item_names or key in self.keyed_enemy_names:
            return
        self.cn["terms"][key] = ""
        self.record("terms", key)

    @staticmethod
    def category_for(item: dict[str, Any]) -> str:
        category = item.get("g")
        if category in {"Weapons", "S-Rank", "SS-Rank"}:
            return "Weapons"
        if category == "Items":
            return "Other"
        return category or "Other"

    @staticmethod
    def type_for(item: dict[str, Any]) -> str:
        if item.get("g") == "SS-Rank":
            return SS_RANK_TYPES.get(item.get("n"), item.get("t") or "Other")
        return item.get("t") or "Other"

    @staticmethod
    def unique_entries(value: Any) -> list[dict[str, Any]]:
        entries = value if isinstance(value, list) else [value] if value else []
        return [entry for entry in entries if isinstance(entry, dict) and entry.get("l") != "Weapon type"]

    @staticmethod
    def unique_source(entry: dict[str, Any]) -> dict[str, Any]:
        raw_description = entry.get("t")
        if isinstance(raw_description, list):
            description = [str(line) for line in raw_description]
        elif raw_description:
            description = [str(raw_description)]
        else:
            description = []
        return {
            "name": str(entry.get("n") or ""),
            "type": str(entry.get("l") or ""),
            "description": description,
        }

    @staticmethod
    def unique_source_key(source: Any) -> str | None:
        if not isinstance(source, dict):
            return None
        raw_description = source.get("description", source.get("t"))
        if isinstance(raw_description, list):
            description = [str(line) for line in raw_description]
        elif raw_description:
            description = [str(raw_description)]
        else:
            description = []
        signature = [
            str(source.get("name", source.get("n", "")) or ""),
            str(source.get("type", source.get("l", "")) or ""),
            description,
        ]
        return json.dumps(signature, ensure_ascii=False, separators=(",", ":"))

    def add_missing_unique(self, item_id: str, detail: dict[str, Any]) -> None:
        raw_entries = self.unique_entries(detail.get("un", detail.get("us")))
        if not raw_entries:
            return
        existing = self.cn["unique"].get(item_id, [])
        if not isinstance(existing, list):
            raise RuntimeError(f"cn.unique.{item_id} must be an array")
        available = Counter(
            key for entry in existing
            if (key := self.unique_source_key(entry.get("source") if isinstance(entry, dict) else None))
        )
        for raw in raw_entries:
            source = self.unique_source(raw)
            key = self.unique_source_key(source)
            if available[key] > 0:
                available[key] -= 1
                continue
            existing.append({
                "name": "",
                "type": "",
                "description": [""] * len(source["description"]),
                "source": source,
            })
            self.cn["unique"].setdefault(item_id, existing)
            self.record("unique", item_id, source["name"] or source["type"] or "Unique entry")

    def collect_mode_terms(self, value: Any) -> None:
        if not isinstance(value, str):
            return
        for part in re.split(r",\s*", value):
            self.add_term(part.strip())

    def collect_detail_terms(self, detail: dict[str, Any]) -> None:
        self.add_term(detail.get("sp"))
        for effect in detail.get("ef", []):
            self.add_term(effect)
        for class_name in detail.get("cl", []):
            self.add_term(class_name)
        for source in detail.get("so", []):
            if not isinstance(source, dict):
                continue
            is_quest = source.get("q") == 1
            title_is_description = (
                not is_quest
                and not source.get("c")
                and isinstance(source.get("t"), str)
                and re.search(r"[.!?;]", source["t"])
            )
            if source.get("k") and (not source.get("t") or title_is_description):
                self.add_term(source["k"])
            # Quest names stay English; their descriptions are translatable.
            if not is_quest:
                self.add_term(source.get("t"))
            self.collect_mode_terms(source.get("m"))
            self.add_term(source.get("r"))
            self.add_term(source.get("c"))

    @staticmethod
    def merge_enemy(target: dict[str, dict[str, Any]], source: dict[str, Any]) -> None:
        enemy_key = source.get("k")
        if not enemy_key:
            return
        key = str(enemy_key)
        current = target.setdefault(key, {"k": key, "n": "", "u": None})
        if not current["n"] and source.get("n"):
            current["n"] = source["n"]
        if not current["u"] and source.get("u"):
            current["u"] = source["u"]

    def scan(self, data_dir: Path) -> None:
        index = read_json(data_dir / "index.json")
        gacha = read_json(data_dir / "gacha.json")
        bestiary = read_json(data_dir / "bestiary.json")
        if not isinstance(index.get("items"), list) or not isinstance(index.get("enemies"), list):
            raise RuntimeError("index.json is missing items or enemies arrays")
        if not isinstance(gacha.get("names"), list):
            raise RuntimeError("gacha.json is missing names")
        if not isinstance(bestiary.get("enemies"), list):
            raise RuntimeError("bestiary.json is missing enemies array")

        shards: dict[str, dict[str, Any]] = {}
        for shard_char in SHARD_CHARS:
            shard = require_object(read_json(data_dir / f"d{shard_char}.json"), f"d{shard_char}.json")
            normalized: dict[str, Any] = {}
            for raw_id, detail in shard.items():
                item_id = str(raw_id).upper()
                if item_id[-1:].lower() != shard_char:
                    raise RuntimeError(f"d{shard_char}.json contains item {raw_id} routed to a different shard")
                normalized[item_id] = detail
            shards[shard_char] = normalized

        seen_item_ids: set[str] = set()
        item_records: dict[str, str] = {}
        for item in index["items"]:
            item_id = str(item.get("c") or "").upper()
            if not re.fullmatch(r"[0-9A-F]{4,8}", item_id):
                raise RuntimeError(f"Invalid item ID in index.json: {item.get('c')}")
            if item_id in seen_item_ids:
                raise RuntimeError(f"Duplicate item ID in index.json: {item_id}")
            seen_item_ids.add(item_id)
            item_records[item_id] = item.get("n") or ""
        for raw_id, item in (bestiary.get("items") or {}).items():
            item_id = str(raw_id).upper()
            if item_id not in item_records:
                item_records[item_id] = item[0] if isinstance(item, list) and item else ""

        # Item entries are appended in index order, followed by bestiary-only IDs.
        for item_id, name in item_records.items():
            self.item_names.add(name)
            self.add_blank("items", item_id, name)

        for item in index["items"]:
            if item.get("t") == "Technique Disk":
                continue
            self.add_blank("categories", self.category_for(item))
            self.add_blank("types", self.type_for(item))

        enemies: dict[str, dict[str, Any]] = {}
        for enemy in index["enemies"]:
            self.merge_enemy(enemies, enemy)
        for enemy in bestiary["enemies"]:
            self.merge_enemy(enemies, enemy)
        for enemy_key, enemy in enemies.items():
            self.keyed_enemy_names.update(name for name in (enemy.get("n"), enemy.get("u")) if name)
            if enemy_key not in self.cn["enemies"]:
                self.cn["enemies"][enemy_key] = {
                    "normal": "",
                    **({"ultimate": ""} if enemy.get("u") else {}),
                }
                self.record("enemies", enemy_key, enemy.get("n", ""))
                continue
            translation = require_object(self.cn["enemies"][enemy_key], f"cn.enemies.{enemy_key}")
            if "normal" not in translation and enemy.get("n"):
                translation["normal"] = ""
                self.record("enemyForms", f"{enemy_key}.normal", enemy["n"])
            if "ultimate" not in translation and enemy.get("u"):
                translation["ultimate"] = ""
                self.record("enemyForms", f"{enemy_key}.ultimate", enemy["u"])

        for enemy in index["enemies"]:
            if not enemy.get("k"):
                self.add_term(enemy.get("n"))
        for tier in gacha["names"]:
            self.add_term(tier)

        # Scan detail phrases in item-index order for repeatable append order.
        for item in index["items"]:
            item_id = str(item["c"]).upper()
            detail = shards[item_id[-1].lower()].get(item_id)
            if not isinstance(detail, dict):
                continue
            self.add_missing_unique(item_id, detail)
            self.collect_detail_terms(detail)

        # Bestiary labels are displayed in special-drop groups and need terms too.
        for enemy in bestiary["enemies"]:
            for section in enemy.get("sd", []):
                self.add_term(section.get("h"))
                self.add_term(section.get("t"))
                for group in section.get("g", []):
                    self.add_term(group.get("n"))
                    self.add_term(group.get("w"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Append missing glossary translations to cn.json.")
    parser.add_argument("--dry-run", action="store_true", help="Report missing entries without writing cn.json.")
    parser.add_argument("--data", type=Path, help="Glossary data directory; defaults to alterapso_data/glossary-data.")
    parser.add_argument("--cn", type=Path, help="Translation file; defaults to the project cn.json.")
    return parser.parse_args()


def write_atomically(cn_path: Path, cn: dict[str, Any]) -> None:
    output = json.dumps(cn, ensure_ascii=False, indent=4) + "\n"
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=cn_path.parent,
            prefix=f".{cn_path.name}.", suffix=".tmp", delete=False,
        ) as stream:
            temp_path = Path(stream.name)
            stream.write(output)
        os.replace(temp_path, cn_path)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


def main() -> int:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    project_dir = script_dir.parent
    data_dir = (args.data or script_dir / "alterapso_data" / "glossary-data").resolve()
    cn_path = (args.cn or project_dir / "cn.json").resolve()

    cn = require_object(read_json(cn_path), "cn.json")
    for section in ("items", "enemies", "categories", "types", "terms", "unique"):
        require_object(cn.get(section), f"cn.json.{section}")

    sync = CatalogSync(cn)
    sync.scan(data_dir)
    if not sync.additions:
        print("cn.json is up to date. No entries were added.")
        return 0

    if not args.dry_run:
        write_atomically(cn_path, cn)

    verb = "Would add" if args.dry_run else "Added"
    print(f"{verb} {len(sync.additions)} translation entries:")
    for section, count in sync.counters.items():
        print(f"  {section}: {count}")
    for section, key, detail in sync.additions:
        suffix = f" — {detail}" if detail else ""
        print(f"  {section}.{key}{suffix}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError) as exc:
        print(f"cn.json scan failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
