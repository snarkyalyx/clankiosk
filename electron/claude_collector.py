#!/usr/bin/env python3
"""Durable Claude Code usage collector. Stores usage fields, never prompt content."""

import datetime as dt
import argparse
import hmac
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ROOT = pathlib.Path.home()
MAC_BASE = ROOT / "Library/Application Support/Clankiosk"
CONFIG_DIR = pathlib.Path(os.environ.get("CLANKIOSK_CONFIG_DIR") or (MAC_BASE if sys.platform == "darwin" else pathlib.Path(os.environ.get("XDG_CONFIG_HOME", ROOT / ".config")) / "clankiosk"))
DATA_DIR = pathlib.Path(os.environ.get("CLANKIOSK_DATA_DIR") or (MAC_BASE if sys.platform == "darwin" else pathlib.Path(os.environ.get("XDG_DATA_HOME", ROOT / ".local/share")) / "clankiosk"))
CONFIG = CONFIG_DIR / "claude-collector.json"
DEFAULT_DB = DATA_DIR / "claude-usage.sqlite"
MAX_BODY = 2 * 1024 * 1024
DAY_MS = 86_400_000
DEVICE_RE = re.compile(r"^[a-z][a-z0-9-]{0,30}$")


def value(raw):
    if isinstance(raw, dict):
        for key in ("stringValue", "intValue", "doubleValue", "boolValue", "string_value", "int_value"):
            if key in raw:
                return raw[key]
    return raw


def attributes(raw):
    return {item.get("key"): value(item.get("value")) for item in raw or [] if isinstance(item, dict) and item.get("key")}


def integer(raw):
    try:
        n = int(raw)
        return n if 0 <= n <= 1_000_000_000_000 else None
    except (TypeError, ValueError, OverflowError):
        return None


def timestamp_ms(raw):
    if not raw:
        return None
    try:
        if isinstance(raw, (int, float)) or str(raw).isdigit():
            n = int(raw)
            return n // 1_000_000 if n > 10**16 else n if n > 10**11 else n * 1000
        parsed = dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return int(parsed.timestamp() * 1000)
    except (TypeError, ValueError, OverflowError):
        return None


def normalize_usage(fields, source, at_ms, session_id=None, message_id=None, priority=2):
    model = fields.get("model")
    if not isinstance(model, str) or not model or len(model) > 120 or at_ms is None:
        return None
    names = ("input_tokens", "cache_creation_tokens", "cache_read_tokens", "output_tokens")
    counts = [integer(fields.get(name, 0)) for name in names]
    if any(n is None for n in counts) or sum(counts) == 0:
        return None
    client_id = fields.get("client_request_id") or fields.get("requestId")
    server_id = fields.get("request_id")
    sequence = fields.get("event.sequence")
    if client_id:
        key = "client:" + str(client_id)
    elif server_id:
        key = "server:" + str(server_id)
    elif session_id and sequence is not None:
        key = "event:" + str(session_id) + ":" + str(sequence)
    elif session_id and message_id:
        key = "message:" + str(session_id) + ":" + str(message_id)
    else:
        return None
    if len(key) > 300:
        return None
    cost = fields.get("cost_usd")
    if cost is None and fields.get("cost_usd_micros") is not None:
        cost = float(fields["cost_usd_micros"]) / 1_000_000
    try:
        cost = float(cost) if cost is not None else None
        if cost is not None and not 0 <= cost < 1_000_000:
            cost = None
    except (TypeError, ValueError, OverflowError):
        cost = None
    return {
        "source_device": source, "request_key": key, "at_ms": at_ms,
        "session_id": str(session_id)[:120] if session_id else None,
        "model": model, "input_tokens": counts[0], "cache_creation_tokens": counts[1],
        "cache_read_tokens": counts[2], "output_tokens": counts[3],
        "cost_usd": cost, "priority": priority,
    }


def parse_otlp(payload, source):
    if not isinstance(payload, dict):
        return []
    rows = []
    for resource in payload.get("resourceLogs", []):
        if not isinstance(resource, dict):
            continue
        common = attributes((resource.get("resource") or {}).get("attributes"))
        for scope in resource.get("scopeLogs", []):
            if not isinstance(scope, dict):
                continue
            for record in scope.get("logRecords", []):
                if not isinstance(record, dict):
                    continue
                fields = {**common, **attributes(record.get("attributes"))}
                body = value(record.get("body"))
                name = fields.get("event.name") or fields.get("event_name") or body
                if name not in ("api_request", "claude_code.api_request"):
                    continue
                at_ms = timestamp_ms(fields.get("event.timestamp") or record.get("timeUnixNano") or record.get("observedTimeUnixNano"))
                row = normalize_usage(fields, source, at_ms, fields.get("session.id"))
                if row:
                    rows.append(row)
    return rows


def db_connect(path):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    db = sqlite3.connect(str(path), timeout=5)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=5000")
    db.executescript("""
    CREATE TABLE IF NOT EXISTS requests (
      source_device TEXT NOT NULL, request_key TEXT NOT NULL,
      at_ms INTEGER NOT NULL, session_id TEXT, model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
      cost_usd REAL, priority INTEGER NOT NULL,
      PRIMARY KEY (source_device, request_key)
    );
    CREATE INDEX IF NOT EXISTS idx_requests_at ON requests(at_ms);
    CREATE TABLE IF NOT EXISTS source_sync (
      source_device TEXT PRIMARY KEY, last_scan_ms INTEGER,
      last_otel_ms INTEGER, last_error TEXT
    );
    """)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return db


def insert_rows(db, rows):
    inserted = 0
    for row in rows:
        before = db.total_changes
        db.execute("""INSERT INTO requests
          (source_device,request_key,at_ms,session_id,model,input_tokens,cache_creation_tokens,
           cache_read_tokens,output_tokens,cost_usd,priority)
          VALUES (:source_device,:request_key,:at_ms,:session_id,:model,:input_tokens,
                  :cache_creation_tokens,:cache_read_tokens,:output_tokens,:cost_usd,:priority)
          ON CONFLICT(source_device,request_key) DO UPDATE SET
            at_ms=excluded.at_ms, session_id=excluded.session_id, model=excluded.model,
            input_tokens=excluded.input_tokens, cache_creation_tokens=excluded.cache_creation_tokens,
            cache_read_tokens=excluded.cache_read_tokens, output_tokens=excluded.output_tokens,
            cost_usd=excluded.cost_usd, priority=excluded.priority
          WHERE excluded.priority > requests.priority OR
            (excluded.priority = requests.priority AND
             excluded.input_tokens + excluded.cache_creation_tokens + excluded.cache_read_tokens + excluded.output_tokens >
             requests.input_tokens + requests.cache_creation_tokens + requests.cache_read_tokens + requests.output_tokens)""", row)
        inserted += db.total_changes - before
    db.commit()
    return inserted


def transcript_rows(since_file_mtime_ms=0, projects=None):
    root = pathlib.Path(projects).expanduser() if projects else ROOT / ".claude/projects"
    if not root.is_dir():
        return
    cutoff = int(time.time() * 1000) - 8 * DAY_MS
    messages = {}
    for file in root.rglob("*.jsonl"):
        try:
            if file.stat().st_mtime * 1000 < since_file_mtime_ms:
                continue
            with file.open(encoding="utf-8", errors="replace") as stream:
                for line in stream:
                    try:
                        event = json.loads(line)
                    except (ValueError, TypeError):
                        continue
                    message = event.get("message") or {}
                    usage = message.get("usage") or {}
                    if event.get("type") != "assistant" or not usage:
                        continue
                    at_ms = timestamp_ms(event.get("timestamp"))
                    if not at_ms or at_ms < cutoff:
                        continue
                    session_id = event.get("sessionId") or file.stem
                    fields = {
                        "model": message.get("model"), "requestId": event.get("requestId"),
                        "input_tokens": usage.get("input_tokens", 0),
                        "cache_creation_tokens": usage.get("cache_creation_input_tokens", 0),
                        "cache_read_tokens": usage.get("cache_read_input_tokens", 0),
                        "output_tokens": usage.get("output_tokens", 0),
                    }
                    row = normalize_usage(fields, "", at_ms, session_id, message.get("id"), priority=1)
                    if row:
                        old = messages.get(row["request_key"])
                        total = lambda r: sum(r[k] for k in ("input_tokens", "cache_creation_tokens", "cache_read_tokens", "output_tokens"))
                        if not old or total(row) >= total(old):
                            messages[row["request_key"]] = row
        except OSError:
            continue
    yield from messages.values()


def scan_device(db_path, source, since_ms=0, remote=None, identity=None, projects=None):
    if remote:
        cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "StrictHostKeyChecking=accept-new"]
        if identity:
            cmd += ["-i", identity, "-o", "IdentitiesOnly=yes"]
        cmd += [remote, "python3 - export-transcripts " + str(int(since_ms))]
        result = subprocess.run(cmd, input=pathlib.Path(__file__).read_bytes(), capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError("remote transcript scan failed: " + result.stderr.decode("utf-8", "replace")[:120])
        rows = (json.loads(line) for line in result.stdout.splitlines() if line)
    else:
        rows = transcript_rows(since_ms, projects)
    db = db_connect(db_path)
    try:
        batch = []
        for row in rows:
            row["source_device"] = source
            batch.append(row)
        count = insert_rows(db, batch)
        db.execute("""INSERT INTO source_sync(source_device,last_scan_ms,last_error) VALUES(?,?,NULL)
          ON CONFLICT(source_device) DO UPDATE SET last_scan_ms=excluded.last_scan_ms,last_error=NULL""",
          (source, int(time.time() * 1000)))
        db.commit()
        return count
    finally:
        db.close()


def scanner(config, db_path):
    last_scans = {}
    while True:
        for source in config.get("sources", []):
            name = source.get("device")
            if not name or not DEVICE_RE.fullmatch(name):
                continue
            since = max(0, last_scans.get(name, 0) - 120_000)
            try:
                scan_device(db_path, name, since, source.get("sshHost"), source.get("sshIdentityFile"), config.get("projects"))
                last_scans[name] = int(time.time() * 1000)
            except Exception as exc:
                db = db_connect(db_path)
                try:
                    db.execute("""INSERT INTO source_sync(source_device,last_error) VALUES(?,?)
                      ON CONFLICT(source_device) DO UPDATE SET last_error=excluded.last_error""", (name, str(exc)[:120]))
                    db.commit()
                finally:
                    db.close()
        time.sleep(30)


def serve(config, db_path):
    token = config.get("token")
    if not isinstance(token, str) or len(token) < 24:
        raise SystemExit("collector token must contain at least 24 characters")
    allowed = {source.get("device") for source in config.get("sources", [])}
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/v1/logs":
                self.send_error(404)
                return
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.send_error(401)
                return
            source = self.headers.get("X-Kiosk-Device", "")
            if source not in allowed or not DEVICE_RE.fullmatch(source):
                self.send_error(400, "unknown device")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > MAX_BODY:
                    self.send_error(413)
                    return
                payload = json.loads(self.rfile.read(length))
                rows = parse_otlp(payload, source)
                db = db_connect(db_path)
                try:
                    insert_rows(db, rows)
                    db.execute("""INSERT INTO source_sync(source_device,last_otel_ms) VALUES(?,?)
                      ON CONFLICT(source_device) DO UPDATE SET last_otel_ms=excluded.last_otel_ms""",
                      (source, int(time.time() * 1000)))
                    db.commit()
                finally:
                    db.close()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{}')
            except (ValueError, TypeError):
                self.send_error(400, "invalid JSON")
            except Exception:
                self.send_error(500)

        def log_message(self, fmt, *args):
            # Do not log event bodies, headers, or credentials.
            if args and str(args[1] if len(args) > 1 else args[0]).startswith("5"):
                sys.stderr.write("collector request failed\n")

    thread = threading.Thread(target=scanner, args=(config, db_path), daemon=True)
    thread.start()
    server = ThreadingHTTPServer((config.get("bind", "127.0.0.1"), int(config.get("port", 4318))), Handler)
    server.serve_forever()


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "export-transcripts":
        since = int(sys.argv[2]) if len(sys.argv) > 2 else 0
        for row in transcript_rows(since):
            print(json.dumps(row, separators=(",", ":")))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=["scan-once"])
    parser.add_argument("--config", type=pathlib.Path, default=CONFIG)
    parser.add_argument("--scan-only", action="store_true", help="Read transcripts without opening an HTTP listener")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    db_path = pathlib.Path(config.get("database", str(DEFAULT_DB))).expanduser()
    db_connect(db_path).close()
    if args.command == "scan-once":
        for source in config.get("sources", []):
            count = scan_device(db_path, source["device"], 0, source.get("sshHost"), source.get("sshIdentityFile"), config.get("projects"))
            print(source["device"], count)
        return
    if args.scan_only:
        scanner(config, db_path)
    else:
        serve(config, db_path)


if __name__ == "__main__":
    main()
