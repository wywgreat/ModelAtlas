from __future__ import annotations

import math
import os
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any

import requests
from flask import Flask, jsonify, render_template

app = Flask(__name__)

HF_API = "https://huggingface.co/api/models"
MS_API = "https://www.modelscope.cn/api/v1/models"

HF_PAGE_SIZE = 100
MS_PAGE_SIZE = 100
MAX_PAGES = 20


@dataclass
class ModelRecord:
    source: str
    family: str
    model_id: str
    downloads: int | None
    likes: int | None
    created_at: str | None
    last_modified: str | None
    tags: list[str]
    license: str | None
    raw: dict[str, Any]


def _family_match(model_id: str, family: str) -> bool:
    lowered = model_id.lower()
    return family.lower() in lowered


def _safe_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch_huggingface_models(family: str) -> list[ModelRecord]:
    records: list[ModelRecord] = []

    for page in range(MAX_PAGES):
        params = {
            "search": family,
            "sort": "downloads",
            "direction": -1,
            "limit": HF_PAGE_SIZE,
            "full": "true",
            "config": "true",
        }

        cursor = page * HF_PAGE_SIZE
        if cursor > 0:
            params["cursor"] = cursor

        response = requests.get(HF_API, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()

        if not data:
            break

        page_records = []
        for item in data:
            model_id = item.get("id") or ""
            if not model_id or not _family_match(model_id, family):
                continue
            tags = item.get("tags") or []
            license_tag = next((t for t in tags if t.startswith("license:")), None)
            license_value = license_tag.replace("license:", "") if license_tag else None

            page_records.append(
                ModelRecord(
                    source="huggingface",
                    family=family.lower(),
                    model_id=model_id,
                    downloads=_safe_int(item.get("downloads")),
                    likes=_safe_int(item.get("likes")),
                    created_at=item.get("createdAt"),
                    last_modified=item.get("lastModified"),
                    tags=tags,
                    license=license_value,
                    raw=item,
                )
            )

        records.extend(page_records)

        if len(data) < HF_PAGE_SIZE:
            break

    dedup: dict[str, ModelRecord] = {r.model_id: r for r in records}
    return list(dedup.values())


def fetch_modelscope_models(family: str) -> list[ModelRecord]:
    records: list[ModelRecord] = []

    for page_number in range(1, MAX_PAGES + 1):
        params = {
            "PageNumber": page_number,
            "PageSize": MS_PAGE_SIZE,
            "Search": family,
        }
        response = requests.get(MS_API, params=params, timeout=30)
        response.raise_for_status()
        payload = response.json()
        items = payload.get("Data", {}).get("Models", [])

        if not items:
            break

        for item in items:
            model_id = item.get("Name") or ""
            if not model_id or not _family_match(model_id, family):
                continue

            tags = item.get("Tags") or []
            created = item.get("CreatedTime")
            modified = item.get("ModifiedTime")

            records.append(
                ModelRecord(
                    source="modelscope",
                    family=family.lower(),
                    model_id=model_id,
                    downloads=_safe_int(item.get("DownloadCount") or item.get("Downloads")),
                    likes=_safe_int(item.get("LikeCount") or item.get("Likes")),
                    created_at=created,
                    last_modified=modified,
                    tags=tags,
                    license=item.get("License"),
                    raw=item,
                )
            )

        total_count = payload.get("Data", {}).get("TotalCount")
        if isinstance(total_count, int):
            total_pages = math.ceil(total_count / MS_PAGE_SIZE)
            if page_number >= total_pages:
                break
        elif len(items) < MS_PAGE_SIZE:
            break

    dedup: dict[str, ModelRecord] = {r.model_id: r for r in records}
    return list(dedup.values())


def _top_n(records: list[ModelRecord], key: str, n: int = 10) -> list[dict[str, Any]]:
    valid = [r for r in records if getattr(r, key) is not None]
    valid.sort(key=lambda x: getattr(x, key) or 0, reverse=True)
    return [
        {
            "model_id": r.model_id,
            key: getattr(r, key),
            "source": r.source,
            "family": r.family,
        }
        for r in valid[:n]
    ]


def build_summary(records: list[ModelRecord]) -> dict[str, Any]:
    groups: dict[str, list[ModelRecord]] = {}
    for record in records:
        group_key = f"{record.source}:{record.family}"
        groups.setdefault(group_key, []).append(record)

    summary_rows = []
    for key, items in sorted(groups.items()):
        source, family = key.split(":", 1)
        downloads = [r.downloads for r in items if r.downloads is not None]
        likes = [r.likes for r in items if r.likes is not None]

        summary_rows.append(
            {
                "source": source,
                "family": family,
                "model_count": len(items),
                "downloads_sum": sum(downloads) if downloads else 0,
                "downloads_avg": round(sum(downloads) / len(downloads), 2) if downloads else 0,
                "likes_sum": sum(likes) if likes else 0,
                "likes_avg": round(sum(likes) / len(likes), 2) if likes else 0,
            }
        )

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "summary": summary_rows,
        "top_downloads": _top_n(records, "downloads", n=12),
        "top_likes": _top_n(records, "likes", n=12),
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/models/refresh", methods=["GET"])
def refresh_models():
    families = ["qwen", "llama"]
    all_records: list[ModelRecord] = []
    errors = []

    for family in families:
        try:
            all_records.extend(fetch_huggingface_models(family))
        except Exception as exc:  # noqa: BLE001
            errors.append({"source": "huggingface", "family": family, "error": str(exc)})

        try:
            all_records.extend(fetch_modelscope_models(family))
        except Exception as exc:  # noqa: BLE001
            errors.append({"source": "modelscope", "family": family, "error": str(exc)})

    payload = {
        "meta": build_summary(all_records),
        "records": [asdict(r) for r in all_records],
        "errors": errors,
    }
    return jsonify(payload)


if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    app.run(host=host, port=port, debug=True)
