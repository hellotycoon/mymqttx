#!/usr/bin/env python3
"""MyMQTTX local server and MQTT bridge."""

from __future__ import annotations

import argparse
import errno
import json
import mimetypes
import os
import signal
import threading
import time
import traceback
import urllib.parse
import webbrowser
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from defaults import default_config, message_type_for_topic
from mqtt_client import MQTTClient, MQTTError, MQTTMessage


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
CONFIG_DIR = Path.home() / ".config" / "mymqttx"
CONFIG_FILE = CONFIG_DIR / "config.json"
MAX_BODY = 2 * 1024 * 1024


class ConfigStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._config = self._load()

    def _load(self) -> dict:
        if CONFIG_FILE.exists():
            try:
                value = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
                if isinstance(value, dict):
                    normalized = self._normalize(value)
                    # Version 1 preloaded every topic as active. Migrate that
                    # generated configuration once; later user choices remain.
                    if _bounded_int(value.get("version", 1), 1, 99, 1) < 2:
                        for subscription in normalized["subscriptions"]:
                            subscription["enabled"] = False
                        self._write(normalized)
                    return normalized
            except (OSError, json.JSONDecodeError) as exc:
                print(f"配置读取失败，将使用内置默认值：{exc}")
        value = default_config()
        self._write(value)
        return value

    def get(self) -> dict:
        with self._lock:
            return json.loads(json.dumps(self._config, ensure_ascii=False))

    def save(self, value: dict) -> dict:
        normalized = self._normalize(value)
        with self._lock:
            self._write(normalized)
            self._config = normalized
            return self.get()

    def save_broker(self, broker: dict) -> dict:
        with self._lock:
            updated = self.get()
            updated["broker"] = broker
            return self.save(updated)

    def _write(self, value: dict) -> None:
        CONFIG_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
        tmp = CONFIG_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(CONFIG_FILE)

    def _normalize(self, value: dict) -> dict:
        defaults = default_config()
        broker = value.get("broker") if isinstance(value.get("broker"), dict) else {}
        normalized_broker = {
            "host": str(broker.get("host", "127.0.0.1")).strip()[:255] or "127.0.0.1",
            "port": _bounded_int(broker.get("port", 1883), 1, 65535, 1883),
            "clientId": str(broker.get("clientId", defaults["broker"]["clientId"]))[:128],
            "username": str(broker.get("username", ""))[:512],
            "password": str(broker.get("password", ""))[:4096],
            "keepalive": _bounded_int(broker.get("keepalive", 60), 10, 65535, 60),
            "cleanSession": bool(broker.get("cleanSession", True)),
        }
        return {
            "version": 2,
            "broker": normalized_broker,
            "publishTopics": _normalize_publish_topics(value.get("publishTopics")),
            "subscriptions": _normalize_subscriptions(value.get("subscriptions")),
        }


def _bounded_int(value: Any, low: int, high: int, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(low, min(high, parsed))


def _safe_id(value: Any, index: int) -> str:
    text = str(value or "").strip()
    return text[:80] if text else f"item-{int(time.time() * 1000)}-{index}"


def _normalize_publish_topics(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return default_config()["publishTopics"]
    result = []
    for index, item in enumerate(value[:200]):
        if not isinstance(item, dict):
            continue
        topic = str(item.get("topic", "")).strip()
        payload = str(item.get("payload", "{}"))
        if not topic or len(topic.encode("utf-8")) > 65535 or len(payload.encode("utf-8")) > MAX_BODY:
            continue
        result.append(
            {
                "id": _safe_id(item.get("id"), index),
                "topic": topic,
                "messageType": _normalize_message_type(item.get("messageType"), topic),
                "payload": payload,
                "qos": _bounded_int(item.get("qos", 0), 0, 2, 0),
                "retain": bool(item.get("retain", False)),
                "intervalMs": _bounded_int(item.get("intervalMs", 0), 0, 86_400_000, 0),
            }
        )
    return result


def _normalize_message_type(value: Any, topic: str) -> str:
    inferred = message_type_for_topic(topic)
    if inferred != "JSON":
        return inferred
    text = str(value or "").strip()
    return text[:80] if text else "JSON"


def _normalize_subscriptions(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return default_config()["subscriptions"]
    result = []
    seen = set()
    for index, item in enumerate(value[:500]):
        if not isinstance(item, dict):
            continue
        topic = str(item.get("topic", "")).strip()
        if not topic or topic in seen or len(topic.encode("utf-8")) > 65535:
            continue
        seen.add(topic)
        result.append(
            {
                "id": _safe_id(item.get("id"), index),
                "topic": topic,
                "qos": _bounded_int(item.get("qos", 0), 0, 2, 0),
                "enabled": bool(item.get("enabled", False)),
            }
        )
    return result


class AppState:
    def __init__(self) -> None:
        self.config = ConfigStore()
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._events: deque[dict] = deque(maxlen=3000)
        self._sequence = 0
        self._client: MQTTClient | None = None
        self.connection = {"connected": False, "connecting": False, "message": "未连接"}

    def add_event(self, kind: str, **values: Any) -> dict:
        with self._condition:
            self._sequence += 1
            event = {
                "seq": self._sequence,
                "kind": kind,
                "timestamp": time.time(),
                **values,
            }
            self._events.append(event)
            self._condition.notify_all()
            return event

    def events_after(self, sequence: int, wait_seconds: float = 20.0) -> list[dict]:
        with self._condition:
            if not any(event["seq"] > sequence for event in self._events):
                self._condition.wait(timeout=wait_seconds)
            return [event for event in self._events if event["seq"] > sequence][:250]

    def status(self) -> dict:
        with self._lock:
            status = dict(self.connection)
            status["seq"] = self._sequence
            return status

    def connect(self, broker: dict) -> dict:
        normalized = self.config.save_broker({
            "host": broker.get("host", "127.0.0.1"),
            "port": broker.get("port", 1883),
            "clientId": broker.get("clientId", "mymqttx"),
            "username": broker.get("username", ""),
            "password": broker.get("password", ""),
            "keepalive": broker.get("keepalive", 60),
            "cleanSession": broker.get("cleanSession", True),
        })["broker"]
        with self._lock:
            if self.connection["connected"]:
                raise MQTTError("已经连接到 Broker")
            if self.connection["connecting"]:
                raise MQTTError("正在连接 Broker")
            self.connection = {"connected": False, "connecting": True, "message": "正在连接…"}

        client = MQTTClient(on_message=self._on_message, on_disconnect=self._on_disconnect)
        try:
            client.connect(
                normalized["host"],
                normalized["port"],
                normalized["clientId"],
                normalized["username"],
                normalized["password"],
                normalized["keepalive"],
                normalized["cleanSession"],
            )
            with self._lock:
                self._client = client
                self.connection = {
                    "connected": True,
                    "connecting": False,
                    "message": f'{normalized["host"]}:{normalized["port"]}',
                }
            failed = []
            for subscription in self.config.get()["subscriptions"]:
                if not subscription["enabled"]:
                    continue
                try:
                    client.subscribe(subscription["topic"], subscription["qos"])
                except MQTTError as exc:
                    failed.append(f'{subscription["topic"]}: {exc}')
            self.add_event("status", connected=True, message=self.connection["message"])
            return {"ok": True, "status": self.status(), "subscriptionErrors": failed}
        except Exception:
            client.disconnect()
            with self._lock:
                self._client = None
                self.connection = {"connected": False, "connecting": False, "message": "连接失败"}
            raise

    def disconnect(self) -> dict:
        with self._lock:
            client, self._client = self._client, None
        if client:
            client.disconnect()
        with self._lock:
            self.connection = {"connected": False, "connecting": False, "message": "未连接"}
        self.add_event("status", connected=False, message="未连接")
        return {"ok": True, "status": self.status()}

    def publish(self, topic: str, payload: str, qos: int, retain: bool) -> dict:
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSON 格式错误：第 {exc.lineno} 行，第 {exc.colno} 列，{exc.msg}") from exc
        with self._lock:
            client = self._client
        if not client or not client.connected:
            raise MQTTError("尚未连接 Broker，请先点击右上角连接按钮")
        client.publish(topic, payload, qos, retain)
        pretty = json.dumps(parsed, ensure_ascii=False, indent=2)
        self.add_event("message", direction="sent", topic=topic, payload=pretty, qos=qos, retain=retain)
        return {"ok": True}

    def subscribe(self, topic: str, qos: int) -> dict:
        with self._lock:
            client = self._client
        if client and client.connected:
            client.subscribe(topic, qos)
        return {"ok": True, "active": bool(client and client.connected)}

    def unsubscribe(self, topic: str) -> dict:
        with self._lock:
            client = self._client
        if client and client.connected:
            client.unsubscribe(topic)
        return {"ok": True, "active": False}

    def _on_message(self, message: MQTTMessage) -> None:
        text = message.payload.decode("utf-8", errors="replace")
        try:
            text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        except (json.JSONDecodeError, TypeError):
            pass
        self.add_event(
            "message",
            direction="received",
            topic=message.topic,
            payload=text,
            qos=message.qos,
            retain=message.retain,
        )

    def _on_disconnect(self, reason: str) -> None:
        with self._lock:
            self._client = None
            self.connection = {"connected": False, "connecting": False, "message": reason}
        self.add_event("status", connected=False, message=reason)


STATE = AppState()


class Handler(BaseHTTPRequestHandler):
    server_version = "MyMQTTX/1.0"

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/config":
            return self._json(STATE.config.get())
        if parsed.path == "/api/status":
            return self._json(STATE.status())
        if parsed.path == "/api/events":
            query = urllib.parse.parse_qs(parsed.query)
            try:
                sequence = max(0, int(query.get("after", ["0"])[0]))
            except ValueError:
                sequence = 0
            return self._json({"events": STATE.events_after(sequence)})
        return self._static(parsed.path)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        try:
            body = self._read_json()
            if parsed.path == "/api/config":
                return self._json(STATE.config.save(body))
            if parsed.path == "/api/connect":
                return self._json(STATE.connect(body))
            if parsed.path == "/api/disconnect":
                return self._json(STATE.disconnect())
            if parsed.path == "/api/publish":
                return self._json(
                    STATE.publish(
                        str(body.get("topic", "")).strip(),
                        str(body.get("payload", "")),
                        _bounded_int(body.get("qos", 0), 0, 2, 0),
                        bool(body.get("retain", False)),
                    )
                )
            if parsed.path == "/api/subscribe":
                return self._json(
                    STATE.subscribe(
                        str(body.get("topic", "")).strip(),
                        _bounded_int(body.get("qos", 0), 0, 2, 0),
                    )
                )
            if parsed.path == "/api/unsubscribe":
                return self._json(STATE.unsubscribe(str(body.get("topic", "")).strip()))
            return self._error(HTTPStatus.NOT_FOUND, "接口不存在")
        except (ValueError, MQTTError) as exc:
            return self._error(HTTPStatus.BAD_REQUEST, str(exc))
        except (ConnectionError, OSError) as exc:
            return self._error(HTTPStatus.BAD_GATEWAY, f"MQTT 连接错误：{exc}")
        except Exception as exc:  # pragma: no cover - last-resort guard
            traceback.print_exc()
            return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, f"内部错误：{exc}")

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Content-Length 无效") from exc
        if length < 0 or length > MAX_BODY:
            raise ValueError("请求内容过大")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"请求 JSON 无效：{exc}") from exc
        if not isinstance(value, dict):
            raise ValueError("请求 JSON 必须是对象")
        return value

    def _json(self, value: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, status: HTTPStatus, message: str) -> None:
        self._json({"ok": False, "error": message}, status)

    def _static(self, request_path: str) -> None:
        routes = {"/": "index.html", "/index.html": "index.html", "/styles.css": "styles.css", "/app.js": "app.js"}
        name = routes.get(request_path)
        if not name:
            return self._error(HTTPStatus.NOT_FOUND, "页面不存在")
        path = STATIC_DIR / name
        try:
            payload = path.read_bytes()
        except OSError:
            return self._error(HTTPStatus.NOT_FOUND, "资源不存在")
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args: object) -> None:
        if self.path.startswith("/api/events"):
            return
        super().log_message(fmt, *args)


class ReusableHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    parser = argparse.ArgumentParser(description="MyMQTTX — 轻量级 Agent MQTT 测试台")
    parser.add_argument("--host", default="127.0.0.1", help="Web UI 监听地址，默认 127.0.0.1")
    parser.add_argument("--port", type=int, default=9000, help="Web UI 监听端口，默认 9000")
    parser.add_argument("--no-browser", action="store_true", help="启动时不自动打开浏览器")
    args = parser.parse_args()

    server = None
    port = args.port
    for offset in range(20):
        candidate = port + offset
        if candidate > 65535:
            break
        try:
            server = ReusableHTTPServer((args.host, candidate), Handler)
            break
        except OSError as exc:
            if exc.errno != errno.EADDRINUSE:
                raise
    if server is None:
        raise OSError(errno.EADDRINUSE, "未找到可用端口")

    url = f"http://{args.host}:{server.server_port}"

    def stop_server(*_: object) -> None:
        STATE.disconnect()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop_server)
    signal.signal(signal.SIGTERM, stop_server)
    if server.server_port != args.port:
        print(f"端口 {args.port} 已被占用，已自动改用 {server.server_port}")
    print(f"MyMQTTX 已启动：{url}")
    print(f"配置目录：{CONFIG_DIR}")
    print("按 Ctrl+C 退出。")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=0.4)
    finally:
        STATE.disconnect()
        server.server_close()


if __name__ == "__main__":
    main()
