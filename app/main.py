import csv
import io
import json
import math
import os
import secrets
import sqlite3
import tomllib
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator
from PIL import Image, ImageOps, UnidentifiedImageError

from .classifier import CATEGORIES, analyze, model
from .demo import DEMO
from .evaluation import evaluate_baseline

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("NERYUNGRI_DB", str(ROOT / "data" / "city.sqlite3")))
MAP_CONFIG_PATH = ROOT / "config.local.toml"
ALLOWED_ORIGINS = [value.strip().rstrip("/") for value in os.environ.get("NERYUNGRI_ALLOWED_ORIGINS", "").split(",") if value.strip()]
LOCAL_TZ = timezone(timedelta(hours=9))
STATUSES = {"new": "Новое", "in_progress": "В работе", "resolved": "Решено"}
PRIORITIES = {"high": "Высокий", "medium": "Повышенный", "normal": "Обычный"}
Category = Literal["snow", "lighting", "waste", "roads", "drainage", "other"]


def now():
    return datetime.now(LOCAL_TZ)


def connect():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
          lat REAL, lon REAL, category TEXT NOT NULL, priority TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL,
          demo INTEGER NOT NULL DEFAULT 0, analysis TEXT NOT NULL
        )""")
        db.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)")
        columns = {row[1] for row in db.execute("PRAGMA table_info(reports)")}
        for name, definition in {
            "problem_id": "INTEGER", "recurrence_of": "INTEGER",
            "resolved_at": "TEXT", "repair_confirmed": "INTEGER NOT NULL DEFAULT 0",
            "resolution_note": "TEXT NOT NULL DEFAULT ''", "priority_note": "TEXT NOT NULL DEFAULT ''",
            "assignee": "TEXT NOT NULL DEFAULT ''", "due_date": "TEXT",
            "bundle_id": "INTEGER", "source_text": "TEXT NOT NULL DEFAULT ''",
        }.items():
            if name not in columns:
                db.execute(f"ALTER TABLE reports ADD COLUMN {name} {definition}")
        if not db.execute("SELECT 1 FROM metadata WHERE key='demo_seeded'").fetchone():
            for text, address, lat, lon, status, age in DEMO:
                result = analyze(text)
                db.execute("INSERT INTO reports (text,address,lat,lon,category,priority,status,created_at,demo,analysis) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (text, address, lat, lon, result["category"], result["priority"], status,
                     (now() - timedelta(days=age, minutes=31)).isoformat(), 1, json.dumps(result, ensure_ascii=False)))
            db.execute("INSERT INTO metadata VALUES ('demo_seeded', '1')")
        db.execute("UPDATE reports SET problem_id=id WHERE problem_id IS NULL")
        db.execute("CREATE INDEX IF NOT EXISTS reports_problem ON reports(problem_id)")
        db.execute("""CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, created_at TEXT NOT NULL,
            action TEXT NOT NULL, changes TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS history_report ON history(report_id)")
        db.execute("""CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, phase TEXT NOT NULL,
            created_at TEXT NOT NULL, image BLOB NOT NULL)""")


@asynccontextmanager
async def lifespan(app):
    if os.environ.get("NERYUNGRI_PUBLIC") == "1" and len(os.environ.get("NERYUNGRI_WRITE_TOKEN", "")) < 32:
        raise RuntimeError("Public hosting requires NERYUNGRI_WRITE_TOKEN with at least 32 characters")
    model()
    init_db()
    yield


app = FastAPI(title="Neryungri AI City", lifespan=lifespan)


@app.middleware("http")
async def local_write_protection(request: Request, call_next):
    # A local demo has no accounts; browser cross-origin writes are rejected.
    if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/") and origin not in ALLOWED_ORIGINS:
            return Response("Cross-origin write blocked", status_code=403)
        token = os.environ.get("NERYUNGRI_WRITE_TOKEN", "")
        if token and request.url.path != "/api/analyze":
            provided = request.headers.get("authorization", "").removeprefix("Bearer ")
            if not secrets.compare_digest(provided.encode(), token.encode()):
                return JSONResponse({"detail": "Для изменения данных нужен код владельца сайта."}, status_code=401)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
                   allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
                   allow_headers=["Content-Type", "Authorization"])


@app.get("/api/health")
def health():
    with connect() as db:
        db.execute("SELECT 1").fetchone()
    return {"status": "ok"}


class TextInput(BaseModel):
    text: str = Field(min_length=5, max_length=4000)

    @field_validator("text")
    @classmethod
    def strip_text(cls, value):
        value = value.strip()
        if len(value) < 5:
            raise ValueError("Опишите проблему хотя бы в нескольких словах")
        return value


class ReportInput(TextInput):
    address: str = Field(default="", max_length=300)
    lat: float | None = None
    lon: float | None = None
    category: Category | None = None
    created_at: datetime | None = None

    @model_validator(mode="after")
    def validate_location(self):
        if (self.lat is None) != (self.lon is None):
            raise ValueError("Укажите обе координаты или оставьте обе пустыми")
        if self.lat is not None and not (56.50 <= self.lat <= 56.80 and 124.45 <= self.lon <= 124.95):
            raise ValueError("Выберите точку в пределах Нерюнгри и ближайших окрестностей")
        if self.created_at:
            if self.created_at.tzinfo is None:
                self.created_at = self.created_at.replace(tzinfo=LOCAL_TZ)
            if self.created_at > now() + timedelta(minutes=5):
                raise ValueError("Дата обращения не может быть в будущем")
        return self


class ReportUpdate(BaseModel):
    status: Literal["new", "in_progress", "resolved"] | None = None
    priority: Literal["high", "medium", "normal"] | None = None
    category: Category | None = None
    repair_confirmed: bool | None = None
    resolution_note: str | None = Field(default=None, max_length=1000)
    priority_note: str | None = Field(default=None, max_length=500)
    assignee: str | None = Field(default=None, max_length=150)
    due_date: date | None = None
    address: str | None = Field(default=None, max_length=300)
    lat: float | None = None
    lon: float | None = None

    @model_validator(mode="after")
    def location_pair(self):
        supplied = self.model_fields_set
        if ("lat" in supplied) != ("lon" in supplied):
            raise ValueError("Укажите обе координаты")
        if "lat" in supplied:
            ReportInput(text="Проверка места", lat=self.lat, lon=self.lon)
        if any(getattr(self, key) is None for key in supplied - {"due_date", "lat", "lon"}):
            raise ValueError("Поле не может быть пустым")
        return self


class SplitInput(ReportInput):
    parts: list[TextInput] = Field(min_length=2, max_length=6)
    categories: list[Category] = Field(min_length=2, max_length=6)

    @model_validator(mode="after")
    def matching_parts(self):
        if len(self.parts) != len(self.categories) or len(set(self.categories)) != len(self.categories):
            raise ValueError("Для каждой отдельной темы нужна своя категория")
        return self


class RelationInput(BaseModel):
    target_id: int
    kind: Literal["duplicate", "recurrence"]


class ImportInput(BaseModel):
    csv: str = Field(max_length=2_000_000)


def zone_for(lat, lon):
    if lat is None:
        return "Место не указано"
    # Analytical sectors are not administrative neighbourhood boundaries.
    vertical = "Север" if lat >= 56.668 else "Юг" if lat < 56.655 else "Центр"
    horizontal = "запад" if lon < 124.707 else "восток" if lon >= 124.723 else "середина"
    return f"{vertical} / {horizontal}"


def serialize(row):
    item = dict(row)
    item["demo"] = bool(item["demo"])
    item["analysis"] = json.loads(item["analysis"])
    item["zone"] = zone_for(item["lat"], item["lon"])
    item["category_label"] = CATEGORIES[item["category"]]
    item["status_label"] = STATUSES[item["status"]]
    item["priority_label"] = PRIORITIES[item["priority"]]
    item["reference"] = f"{'Д' if item['demo'] else 'Н'}-{item['id']:03d}"
    item["repair_confirmed"] = bool(item["repair_confirmed"])
    item["problem_reference"] = f"{'Д' if item['demo'] else 'Н'}-{item['problem_id']:03d}"
    return item


def read_reports(dataset):
    with connect() as db:
        rows = db.execute("SELECT * FROM reports WHERE demo=? ORDER BY created_at DESC,id DESC", (dataset == "demo",)).fetchall()
    items = [serialize(row) for row in rows]
    counts = {}
    for item in items:
        counts[item["problem_id"]] = counts.get(item["problem_id"], 0) + 1
    for item in items:
        item["problem_report_count"] = counts[item["problem_id"]]
    return items


def insert_report(db, report: ReportInput):
    result = analyze(report.text)
    category = report.category or result["category"]
    if report.category:
        result["category_confirmed"] = True
    cursor = db.execute("INSERT INTO reports (text,address,lat,lon,category,priority,status,created_at,demo,analysis) VALUES (?,?,?,?,?,?,'new',?,0,?)",
        (report.text, report.address.strip(), report.lat, report.lon, category, result["priority"],
         (report.created_at or now()).isoformat(), json.dumps(result, ensure_ascii=False)))
    db.execute("UPDATE reports SET problem_id=id WHERE id=?", (cursor.lastrowid,))
    return cursor.lastrowid


def record_history(db, report_id, action, changes):
    db.execute("INSERT INTO history(report_id,created_at,action,changes) VALUES(?,?,?,?)",
               (report_id, now().isoformat(), action, json.dumps(changes, ensure_ascii=False)))


def audit_changes(db, before, action):
    for old in before:
        new = db.execute("SELECT * FROM reports WHERE id=?", (old["id"],)).fetchone()
        changes = {key: {"before": old[key], "after": new[key]} for key in old.keys()
                   if old[key] != new[key] and key != "analysis"}
        if changes:
            record_history(db, old["id"], action, changes)


@app.get("/api/meta")
def meta():
    return {"categories": CATEGORIES, "statuses": STATUSES, "priorities": PRIORITIES,
            "today": now().date().isoformat(), "center": [56.662, 124.715],
            "model": "TF-IDF + логистическая регрессия", "training": "Учебные примеры",
            "temporary_storage": os.environ.get("NERYUNGRI_PUBLIC") == "1"}


@app.get("/api/reports")
def reports(dataset: Literal["demo", "user"] = "demo"):
    return {"reports": read_reports(dataset)}


@app.get("/api/map-config")
def map_config():
    # JS API keys are public browser credentials; never expose other settings.
    key = os.environ.get("NERYUNGRI_YANDEX_MAPS_API_KEY", "").strip()
    if not key and MAP_CONFIG_PATH.exists():
        try:
            config = tomllib.loads(MAP_CONFIG_PATH.read_text(encoding="utf-8-sig"))
            key = config.get("yandex_maps_api_key", "")
            if not isinstance(key, str):
                raise ValueError("Map key must be a string")
            key = key.strip()
        except (OSError, ValueError):
            return JSONResponse({"detail": "Проверьте config.local.toml: ключ должен быть строкой в кавычках."},
                                status_code=400, headers={"Cache-Control": "no-store"})
    return JSONResponse({"provider": "yandex", "api_key": key}, headers={"Cache-Control": "no-store"})


@app.post("/api/analyze")
def analyze_report(payload: TextInput):
    return analyze(payload.text)


@app.post("/api/reports", status_code=201)
def create_report(payload: ReportInput):
    with connect() as db:
        report_id = insert_report(db, payload)
        return serialize(db.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone())


@app.post("/api/reports/split", status_code=201)
def split_report(payload: SplitInput):
    with connect() as db:
        ids = []
        for part, category in zip(payload.parts, payload.categories):
            item = ReportInput(**{**payload.model_dump(exclude={"parts", "categories"}), "text": part.text, "category": category})
            ids.append(insert_report(db, item))
        for report_id in ids:
            db.execute("UPDATE reports SET bundle_id=?,source_text=? WHERE id=?", (ids[0], payload.text, report_id))
            record_history(db, report_id, "Разделено по темам", {"source_text": {"before": None, "after": payload.text}})
        return {"reports": [serialize(db.execute("SELECT * FROM reports WHERE id=?", (i,)).fetchone()) for i in ids]}


@app.patch("/api/reports/{report_id}")
def update_report(report_id: int, payload: ReportUpdate):
    updates = payload.model_dump(exclude_unset=True, mode="json")
    if not updates:
        raise HTTPException(400, "Нет изменений")
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Обращение не найдено")
        before = db.execute("SELECT * FROM reports WHERE problem_id=?", (row["problem_id"],)).fetchall()
        local = {key: updates.pop(key) for key in ("address", "lat", "lon") if key in updates}
        if "assignee" in updates:
            updates["assignee"] = updates["assignee"].strip()
        status = updates.get("status", row["status"])
        confirmed = updates.get("repair_confirmed", row["repair_confirmed"])
        note = updates.get("resolution_note", row["resolution_note"]).strip()
        has_recurrence = db.execute("SELECT 1 FROM reports WHERE recurrence_of=?", (row["problem_id"],)).fetchone()
        if has_recurrence and (status != "resolved" or not confirmed):
            raise HTTPException(409, "Сначала снимите связь с повторной поломкой. Она опирается на этот подтверждённый ремонт.")
        if updates.get("category", row["category"]) != row["category"] and (has_recurrence or row["recurrence_of"]):
            raise HTTPException(409, "Сначала снимите связь повторной поломки, затем меняйте категорию.")
        if confirmed and (status != "resolved" or not note):
            raise HTTPException(400, "Для подтверждения ремонта выберите «Решено» и укажите результат проверки.")
        if status != "resolved":
            updates.update(resolved_at=None, repair_confirmed=0, resolution_note="")
        elif status != row["status"] or ("status" in updates and not row["resolved_at"]):
            updates["resolved_at"] = now().isoformat()
        if "resolution_note" in updates:
            updates["resolution_note"] = updates["resolution_note"].strip()
        if updates.get("priority", row["priority"]) != row["priority"]:
            updates["priority_note"] = updates.get("priority_note", "").strip() or "Приоритет изменён вручную."
        if updates:
            fields = ",".join(f"{key}=?" for key in updates)
            db.execute(f"UPDATE reports SET {fields} WHERE problem_id=?", (*updates.values(), row["problem_id"]))
        if local:
            fields = ",".join(f"{key}=?" for key in local)
            db.execute(f"UPDATE reports SET {fields} WHERE id=?", (*local.values(), report_id))
        audit_changes(db, before, "Изменение карточки")
        return serialize(db.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone())


@app.put("/api/reports/{report_id}/relation")
def link_report(report_id: int, payload: RelationInput):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        source = db.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone()
        target = db.execute("SELECT * FROM reports WHERE id=?", (payload.target_id,)).fetchone()
        if not source or not target:
            raise HTTPException(404, "Обращение не найдено")
        target = db.execute("SELECT * FROM reports WHERE id=?", (target["problem_id"],)).fetchone()
        before = db.execute("SELECT * FROM reports WHERE problem_id IN (?,?)", (source["problem_id"], target["problem_id"])).fetchall()
        if source["demo"] != target["demo"] or source["category"] != target["category"]:
            raise HTTPException(400, "Связывайте обращения одной категории из одного набора данных.")
        if source["problem_id"] == target["problem_id"]:
            raise HTTPException(400, "Обращения уже относятся к одной проблеме.")
        size = db.execute("SELECT COUNT(*) FROM reports WHERE problem_id=?", (source["problem_id"],)).fetchone()[0]
        referenced = db.execute("SELECT 1 FROM reports WHERE recurrence_of=?", (source["problem_id"],)).fetchone()
        if size != 1 or source["recurrence_of"] or referenced:
            raise HTTPException(409, "У этого обращения уже есть связи. Для дубля выберите отдельное обращение; существующую связь повтора сначала снимите.")
        if payload.kind == "duplicate":
            if source["status"] == "resolved" or target["status"] == "resolved":
                raise HTTPException(400, "Дубли связываются до закрытия проблемы. После ремонта используйте связь повторной поломки.")
            if target["recurrence_of"]:
                previous = db.execute("SELECT resolved_at FROM reports WHERE id=?", (target["recurrence_of"],)).fetchone()
                if datetime.fromisoformat(source["created_at"]) <= datetime.fromisoformat(previous["resolved_at"]):
                    raise HTTPException(400, "Это обращение получено до ремонта и не относится к новому повтору.")
            # Keep the more urgent assessment when combining reports.
            rank = {"normal": 0, "medium": 1, "high": 2}
            priority = max((source["priority"], target["priority"]), key=rank.get)
            db.execute("UPDATE reports SET problem_id=?,status=?,recurrence_of=? WHERE id=?",
                       (target["id"], target["status"], target["recurrence_of"], report_id))
            db.execute("UPDATE reports SET priority=?,priority_note=? WHERE problem_id=?",
                       (priority, "Сохранён наибольший приоритет связанных обращений. Проверьте исходные оценки в карточках.", target["id"]))
            db.execute("UPDATE reports SET assignee=?,due_date=? WHERE id=?", (target["assignee"], target["due_date"], report_id))
        else:
            if not target["repair_confirmed"] or not target["resolved_at"] or target["status"] != "resolved":
                raise HTTPException(400, "Сначала подтвердите ремонт предыдущей проблемы и опишите результат проверки.")
            if datetime.fromisoformat(source["created_at"]) <= datetime.fromisoformat(target["resolved_at"]):
                raise HTTPException(400, "Повторное обращение должно поступить после зафиксированного ремонта.")
            db.execute("UPDATE reports SET recurrence_of=? WHERE id=?", (target["id"], report_id))
        audit_changes(db, before, "Связь: дубль" if payload.kind == "duplicate" else "Связь: повтор после ремонта")
    return {"linked": True}


@app.delete("/api/reports/{report_id}/relation")
def unlink_report(report_id: int):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Обращение не найдено")
        before = db.execute("SELECT * FROM reports WHERE problem_id=?", (row["problem_id"],)).fetchall()
        if row["problem_id"] != report_id:
            db.execute("UPDATE reports SET problem_id=id,recurrence_of=NULL WHERE id=?", (report_id,))
        elif row["recurrence_of"]:
            db.execute("UPDATE reports SET recurrence_of=NULL WHERE problem_id=?", (report_id,))
        else:
            raise HTTPException(400, "Нет связи для снятия. Чтобы отделить дубль, откройте его карточку.")
        audit_changes(db, before, "Связь снята")
    return {"unlinked": True}


@app.get("/api/reports/{report_id}/history")
def history(report_id: int):
    with connect() as db:
        if not db.execute("SELECT 1 FROM reports WHERE id=?", (report_id,)).fetchone():
            raise HTTPException(404, "Обращение не найдено")
        rows = db.execute("SELECT * FROM history WHERE report_id=? ORDER BY id DESC", (report_id,)).fetchall()
    return {"events": [{**dict(row), "changes": json.loads(row["changes"])} for row in rows]}


@app.get("/api/reports/{report_id}/photos")
def photos(report_id: int):
    with connect() as db:
        if not db.execute("SELECT 1 FROM reports WHERE id=?", (report_id,)).fetchone():
            raise HTTPException(404, "Обращение не найдено")
        rows = db.execute("SELECT id,phase,created_at FROM photos WHERE report_id=? ORDER BY id", (report_id,)).fetchall()
    return {"photos": [dict(row) for row in rows]}


@app.post("/api/reports/{report_id}/photos", status_code=201)
async def upload_photo(report_id: int, request: Request, phase: Literal["before", "after"]):
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > 5_000_000:
            raise HTTPException(413, "Фото должно быть не больше 5 МБ")
    try:
        with Image.open(io.BytesIO(content)) as original:
            if original.format not in {"JPEG", "PNG", "WEBP"} or original.width * original.height > 20_000_000:
                raise ValueError("unsupported image")
            original.load()
            normalized = ImageOps.exif_transpose(original).convert("RGB")
            normalized.thumbnail((2400, 2400))
            output = io.BytesIO()
            normalized.save(output, format="JPEG", quality=88)
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
        raise HTTPException(400, "Нужен корректный JPEG, PNG или WebP, до 20 мегапикселей")
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if not db.execute("SELECT 1 FROM reports WHERE id=?", (report_id,)).fetchone():
            raise HTTPException(404, "Обращение не найдено")
        if db.execute("SELECT COUNT(*) FROM photos WHERE report_id=?", (report_id,)).fetchone()[0] >= 12:
            raise HTTPException(400, "Для одного обращения можно сохранить до 12 фотографий")
        cursor = db.execute("INSERT INTO photos(report_id,phase,created_at,image) VALUES(?,?,?,?)",
                            (report_id, phase, now().isoformat(), output.getvalue()))
        record_history(db, report_id, "Добавлено фото", {"photo": {"before": None, "after": f"{cursor.lastrowid}: {phase}"}})
        return {"id": cursor.lastrowid}


@app.get("/api/photos/{photo_id}")
def photo_image(photo_id: int):
    with connect() as db:
        row = db.execute("SELECT image FROM photos WHERE id=?", (photo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Фото не найдено")
    return Response(row["image"], media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.delete("/api/reports/{report_id}/photos/{photo_id}")
def delete_photo(report_id: int, photo_id: int):
    with connect() as db:
        row = db.execute("SELECT phase FROM photos WHERE id=? AND report_id=?", (photo_id, report_id)).fetchone()
        if not row:
            raise HTTPException(404, "Фото не найдено")
        db.execute("DELETE FROM photos WHERE id=?", (photo_id,))
        record_history(db, report_id, "Удалено фото", {"photo": {"before": f"{photo_id}: {row['phase']}", "after": None}})
    return {"deleted": True}


@app.post("/api/import")
def import_reports(payload: ImportInput):
    content = payload.csv.lstrip("\ufeff")
    try:
        # Infer the separator from column names, not from commas inside messages.
        header = content.splitlines()[0] if content else ""
        dialect = csv.Sniffer().sniff(header, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(content, newline=""), delimiter=dialect.delimiter, strict=True)
    parsed = []
    try:
        fields = [name.strip() for name in (reader.fieldnames or [])]
        if len(fields) != len(set(fields)):
            raise HTTPException(400, "Заголовки столбцов не должны повторяться. Ничего не загружено.")
        if not fields or "text" not in fields or "" in fields:
            raise HTTPException(400, "Нужен столбец text и непустые заголовки. Скачайте шаблон CSV.")
        reader.fieldnames = fields
        for row in reader:
            line = reader.line_num
            if len(parsed) >= 500:
                raise HTTPException(400, "За один раз можно загрузить не более 500 обращений")
            if None in row or any(value is None for value in row.values()):
                raise HTTPException(400, f"Строка {line}: число ячеек не совпадает с заголовком. Текст с разделителем заключите в кавычки; пустые ячейки сохраните. Ничего не загружено.")
            provenance = row.get("demo", "").strip().lower()
            if provenance in {"true", "1", "yes", "да"}:
                raise HTTPException(400, f"Строка {line}: учебные обращения нельзя загрузить в раздел «Добавленные». Они доступны в разделе «Учебные». Ничего не загружено.")
            if provenance not in {"", "false", "0", "no", "нет"}:
                raise HTTPException(400, f"Строка {line}: неизвестное значение demo. Используйте true или false. Ничего не загружено.")
            try:
                parsed.append(ReportInput(
                    text=row.get("text", ""), address=row.get("address", ""),
                    lat=float(row["lat"]) if row.get("lat", "").strip() else None,
                    lon=float(row["lon"]) if row.get("lon", "").strip() else None,
                    category=row.get("category", "").strip() or None,
                    created_at=row.get("created_at", "").strip() or None,
                ))
            except (ValueError, TypeError) as exc:
                raise HTTPException(400, f"Строка {line}: проверьте текст, координаты, категорию и дату. Ничего не загружено.") from exc
    except csv.Error as exc:
        raise HTTPException(400, f"Ошибка CSV около строки {max(1, reader.line_num)}: проверьте кавычки и длину полей. Ничего не загружено.") from exc
    if not parsed:
        raise HTTPException(400, "В файле нет обращений")
    with connect() as db:
        for report in parsed:
            insert_report(db, report)
    return {"imported": len(parsed)}


@app.get("/api/template.csv")
def csv_template():
    return Response("\ufefftext,address,lat,lon,category,created_at\r\n", media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="appeals-template.csv"'})


def safe_csv(value):
    text = str(value) if value is not None else ""
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


@app.get("/api/export.csv")
def export_reports(dataset: Literal["demo", "user"] = "demo"):
    stream = io.StringIO()
    fields = ["text", "address", "lat", "lon", "category", "created_at", "status", "priority", "demo",
              "reference", "problem_id", "recurrence_of", "resolved_at", "repair_confirmed", "resolution_note", "priority_note",
              "assignee", "due_date", "bundle_id", "source_text"]
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for row in read_reports(dataset):
        writer.writerow({key: safe_csv(row[key]) for key in fields})
    return Response("\ufeff" + stream.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="neryungri-appeals.csv"'})


@app.get("/api/analytics")
def analytics(dataset: Literal["demo", "user"] = "demo"):
    items = read_reports(dataset)
    today = now().date()
    days = []
    for offset in range(13, -1, -1):
        date = today - timedelta(days=offset)
        days.append({"date": date.isoformat(), "count": sum(datetime.fromisoformat(r["created_at"]).astimezone(LOCAL_TZ).date() == date for r in items)})
    dates = [datetime.fromisoformat(r["created_at"]).astimezone(LOCAL_TZ).date() for r in items]
    # A partial current day must not replace a completed day in the baseline.
    completed_dates = [d for d in dates if d < today]
    coverage = (today - min(completed_dates)).days if completed_dates else 0
    forecasts = []
    roots = [r for r in items if r["id"] == r["problem_id"]]
    sectors = []
    for zone in sorted({r["zone"] for r in roots}):
        problems = [r for r in roots if r["zone"] == zone]
        sectors.append({"zone": zone, "problems": len(problems),
                        "reports": sum(r["problem_report_count"] for r in problems),
                        "recurrences": sum(r["recurrence_of"] is not None for r in problems),
                        "open": sum(r["status"] != "resolved" for r in problems)})
    sector_forecasts = []
    if coverage >= 28 and len(completed_dates) >= 30:
        for key, label in CATEGORIES.items():
            count = sum(r["category"] == key and today - timedelta(days=28) <= datetime.fromisoformat(r["created_at"]).astimezone(LOCAL_TZ).date() < today for r in items)
            forecasts.append({"category": key, "label": label, "expected": round(count / 4, 1)})
        for zone in sorted({r["zone"] for r in items}):
            count = sum(r["zone"] == zone and today - timedelta(days=28) <= datetime.fromisoformat(r["created_at"]).astimezone(LOCAL_TZ).date() < today for r in items)
            sector_forecasts.append({"zone": zone, "expected": round(count / 4, 1)})
    evaluation = evaluate_baseline(completed_dates, today, coverage)
    accuracy_note = ("Ошибка на прошлых данных показана ниже. Точность на будущих обращениях пока не проверена."
                     if evaluation["available"] else "Для проверки точности пока недостаточно истории.")
    return {"days": days, "coverage_days": coverage, "forecasts": forecasts,
            "open_problems": sum(r["status"] != "resolved" for r in roots),
            "overdue_problems": sum(r["status"] != "resolved" and bool(r["due_date"]) and r["due_date"] < today.isoformat() for r in roots),
            "problems": len(roots), "duplicate_reports": len(items) - len(roots),
            "recurrences": sum(r["recurrence_of"] is not None for r in roots), "sectors": sectors,
            "sector_forecasts": sector_forecasts, "evaluation": evaluation,
            "forecast_method": "Среднее число обращений за четыре недели",
            "forecast_note": "Расчёт использует 28 завершённых дней и не оценивает вероятность аварии. " + accuracy_note,
            "categories": [{"category": key, "label": label, "count": sum(r["category"] == key for r in items)} for key, label in CATEGORIES.items()]}


@app.get("/api/similar/{report_id}")
def similar(report_id: int):
    with connect() as db:
        row = db.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Обращение не найдено")
    item = serialize(row)
    matches = []
    if item["lat"] is not None:
        for other in read_reports("demo" if item["demo"] else "user"):
            if other["id"] == item["id"] or other["category"] != item["category"] or other["lat"] is None:
                continue
            dy = math.radians(other["lat"] - item["lat"])
            dx = math.radians(other["lon"] - item["lon"]) * math.cos(math.radians(item["lat"]))
            distance = math.hypot(dx, dy) * 6371000
            age = abs((datetime.fromisoformat(other["created_at"]) - datetime.fromisoformat(item["created_at"])).total_seconds())
            if distance < 120 and age <= 7 * 86400:
                matches.append({"reference": other["reference"], "id": other["id"], "distance_m": round(distance)})
    return {"matches": matches}


@app.get("/")
def index(request: Request):
    # Yandex's HTTP Referer form accepts localhost, but rejects a loopback IP.
    if request.url.hostname == "127.0.0.1":
        return RedirectResponse(str(request.url.replace(hostname="localhost")), status_code=307)
    return FileResponse(ROOT / "static" / "index.html")


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
