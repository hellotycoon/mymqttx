"""Small dependency-free MQTT 3.1.1 client used by MyMQTTX.

It intentionally implements only the pieces the desktop tool needs: CONNECT,
PUBLISH, SUBSCRIBE, UNSUBSCRIBE, keep-alive, and QoS 0/1/2 handshakes.
"""

from __future__ import annotations

import socket
import struct
import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, Optional, Tuple


class MQTTError(RuntimeError):
    pass


@dataclass(frozen=True)
class MQTTMessage:
    topic: str
    payload: bytes
    qos: int
    retain: bool


def _utf8(value: str) -> bytes:
    encoded = value.encode("utf-8")
    if len(encoded) > 65535:
        raise MQTTError("MQTT 字符串长度超过 65535 字节")
    return struct.pack("!H", len(encoded)) + encoded


def _remaining_length(length: int) -> bytes:
    if length < 0 or length > 268435455:
        raise MQTTError("MQTT 报文长度无效")
    result = bytearray()
    while True:
        digit = length % 128
        length //= 128
        if length:
            digit |= 0x80
        result.append(digit)
        if not length:
            return bytes(result)


class MQTTClient:
    """Thread-safe MQTT client with a single background reader."""

    CONNACK_MESSAGES = {
        1: "Broker 拒绝连接：不支持的协议版本",
        2: "Broker 拒绝连接：Client ID 无效",
        3: "Broker 拒绝连接：服务不可用",
        4: "Broker 拒绝连接：用户名或密码错误",
        5: "Broker 拒绝连接：未授权",
    }

    def __init__(
        self,
        on_message: Optional[Callable[[MQTTMessage], None]] = None,
        on_disconnect: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.on_message = on_message
        self.on_disconnect = on_disconnect
        self._socket: Optional[socket.socket] = None
        self._send_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._ack_lock = threading.Lock()
        self._stop = threading.Event()
        self._reader: Optional[threading.Thread] = None
        self._packet_id = 0
        self._acks: Dict[Tuple[int, int], Tuple[threading.Event, dict]] = {}
        self._keepalive = 60
        self._last_io = time.monotonic()
        self._connected = False
        self._intentional_disconnect = False

    @property
    def connected(self) -> bool:
        with self._state_lock:
            return self._connected

    def connect(
        self,
        host: str,
        port: int = 1883,
        client_id: str = "mymqttx",
        username: str = "",
        password: str = "",
        keepalive: int = 60,
        clean_session: bool = True,
        timeout: float = 5.0,
    ) -> None:
        if self.connected:
            raise MQTTError("已经连接到 Broker")
        if not host.strip():
            raise MQTTError("Broker 地址不能为空")
        if not 1 <= int(port) <= 65535:
            raise MQTTError("Broker 端口必须在 1~65535 之间")

        self._stop.clear()
        self._intentional_disconnect = False
        self._keepalive = max(10, min(int(keepalive), 65535))
        sock = socket.create_connection((host.strip(), int(port)), timeout=timeout)
        sock.settimeout(1.0)
        self._socket = sock

        flags = 0x02 if clean_session else 0
        payload = _utf8(client_id or "mymqttx")
        if username:
            flags |= 0x80
            payload += _utf8(username)
        if password:
            flags |= 0x40
            payload += _utf8(password)
        variable = _utf8("MQTT") + bytes([4, flags]) + struct.pack("!H", self._keepalive)

        try:
            self._send_packet(0x10, variable + payload)
            packet_type, _, body = self._read_packet()
            if packet_type != 2 or len(body) != 2:
                raise MQTTError("Broker 返回了无效的 CONNACK")
            return_code = body[1]
            if return_code:
                raise MQTTError(self.CONNACK_MESSAGES.get(return_code, f"Broker 拒绝连接：代码 {return_code}"))
        except Exception:
            try:
                sock.close()
            finally:
                self._socket = None
            raise

        with self._state_lock:
            self._connected = True
        self._reader = threading.Thread(target=self._reader_loop, name="mymqttx-mqtt", daemon=True)
        self._reader.start()

    def disconnect(self) -> None:
        self._intentional_disconnect = True
        self._stop.set()
        if self.connected:
            try:
                self._send_packet(0xE0, b"")
            except OSError:
                pass
        self._close_socket()
        reader = self._reader
        if reader and reader is not threading.current_thread():
            reader.join(timeout=1.5)
        with self._state_lock:
            self._connected = False
        self._release_all_acks("连接已断开")

    def publish(self, topic: str, payload: bytes | str, qos: int = 0, retain: bool = False) -> None:
        self._require_connected()
        self._validate_topic(topic, allow_wildcards=False)
        if qos not in (0, 1, 2):
            raise MQTTError("QoS 必须是 0、1 或 2")
        data = payload.encode("utf-8") if isinstance(payload, str) else payload
        variable = _utf8(topic)
        packet_id = None
        if qos:
            packet_id = self._next_packet_id()
            variable += struct.pack("!H", packet_id)
        header = 0x30 | (qos << 1) | (1 if retain else 0)

        if qos == 0:
            self._send_packet(header, variable + data)
            return
        if qos == 1:
            waiter = self._register_ack(4, packet_id)
            self._send_packet(header, variable + data)
            self._wait_ack(waiter, 4, packet_id)
            return

        waiter = self._register_ack(5, packet_id)
        self._send_packet(header, variable + data)
        self._wait_ack(waiter, 5, packet_id)
        waiter = self._register_ack(7, packet_id)
        self._send_packet(0x62, struct.pack("!H", packet_id))
        self._wait_ack(waiter, 7, packet_id)

    def subscribe(self, topic: str, qos: int = 0) -> None:
        self._require_connected()
        self._validate_topic(topic, allow_wildcards=True)
        if qos not in (0, 1, 2):
            raise MQTTError("QoS 必须是 0、1 或 2")
        packet_id = self._next_packet_id()
        waiter = self._register_ack(9, packet_id)
        self._send_packet(0x82, struct.pack("!H", packet_id) + _utf8(topic) + bytes([qos]))
        result = self._wait_ack(waiter, 9, packet_id)
        codes = result.get("codes", [])
        if not codes or codes[0] == 0x80:
            raise MQTTError(f"Broker 拒绝订阅 {topic}")

    def unsubscribe(self, topic: str) -> None:
        self._require_connected()
        self._validate_topic(topic, allow_wildcards=True)
        packet_id = self._next_packet_id()
        waiter = self._register_ack(11, packet_id)
        self._send_packet(0xA2, struct.pack("!H", packet_id) + _utf8(topic))
        self._wait_ack(waiter, 11, packet_id)

    def _validate_topic(self, topic: str, allow_wildcards: bool) -> None:
        if not topic or "\x00" in topic:
            raise MQTTError("Topic 不能为空且不能包含空字符")
        if not allow_wildcards and ("#" in topic or "+" in topic):
            raise MQTTError("发布 Topic 不能包含通配符 # 或 +")
        _utf8(topic)

    def _require_connected(self) -> None:
        if not self.connected:
            raise MQTTError("尚未连接 Broker")

    def _next_packet_id(self) -> int:
        with self._state_lock:
            self._packet_id = self._packet_id % 65535 + 1
            return self._packet_id

    def _register_ack(self, packet_type: int, packet_id: int) -> Tuple[threading.Event, dict]:
        waiter = (threading.Event(), {})
        with self._ack_lock:
            self._acks[(packet_type, packet_id)] = waiter
        return waiter

    def _wait_ack(
        self,
        waiter: Tuple[threading.Event, dict],
        packet_type: int,
        packet_id: int,
        timeout: float = 5.0,
    ) -> dict:
        event, result = waiter
        if not event.wait(timeout):
            with self._ack_lock:
                self._acks.pop((packet_type, packet_id), None)
            raise MQTTError("等待 Broker 确认超时")
        if "error" in result:
            raise MQTTError(result["error"])
        return result

    def _signal_ack(self, packet_type: int, packet_id: int, **values: object) -> None:
        with self._ack_lock:
            waiter = self._acks.pop((packet_type, packet_id), None)
        if waiter:
            waiter[1].update(values)
            waiter[0].set()

    def _release_all_acks(self, error: str) -> None:
        with self._ack_lock:
            waiters = list(self._acks.values())
            self._acks.clear()
        for event, result in waiters:
            result["error"] = error
            event.set()

    def _send_packet(self, first_byte: int, body: bytes) -> None:
        sock = self._socket
        if sock is None:
            raise MQTTError("MQTT Socket 未连接")
        packet = bytes([first_byte]) + _remaining_length(len(body)) + body
        with self._send_lock:
            sock.sendall(packet)
            self._last_io = time.monotonic()

    def _recv_exact(self, count: int) -> bytes:
        sock = self._socket
        if sock is None:
            raise MQTTError("MQTT Socket 已关闭")
        chunks = bytearray()
        while len(chunks) < count:
            chunk = sock.recv(count - len(chunks))
            if not chunk:
                raise MQTTError("Broker 已关闭连接")
            chunks.extend(chunk)
        self._last_io = time.monotonic()
        return bytes(chunks)

    def _read_packet(self) -> Tuple[int, int, bytes]:
        first = self._recv_exact(1)[0]
        multiplier = 1
        length = 0
        for _ in range(4):
            digit = self._recv_exact(1)[0]
            length += (digit & 0x7F) * multiplier
            if not digit & 0x80:
                return first >> 4, first & 0x0F, self._recv_exact(length)
            multiplier *= 128
        raise MQTTError("MQTT Remaining Length 编码无效")

    def _reader_loop(self) -> None:
        reason = ""
        try:
            while not self._stop.is_set():
                try:
                    packet_type, flags, body = self._read_packet()
                    self._handle_packet(packet_type, flags, body)
                except socket.timeout:
                    if time.monotonic() - self._last_io >= self._keepalive * 0.6:
                        self._send_packet(0xC0, b"")
        except Exception as exc:
            reason = str(exc) or exc.__class__.__name__
        finally:
            self._close_socket()
            with self._state_lock:
                was_connected = self._connected
                self._connected = False
            self._release_all_acks(reason or "连接已断开")
            if was_connected and not self._intentional_disconnect and self.on_disconnect:
                self.on_disconnect(reason or "Broker 连接已断开")

    def _handle_packet(self, packet_type: int, flags: int, body: bytes) -> None:
        if packet_type == 3:
            if len(body) < 2:
                raise MQTTError("收到无效的 PUBLISH 报文")
            topic_len = struct.unpack("!H", body[:2])[0]
            if len(body) < 2 + topic_len:
                raise MQTTError("收到截断的 PUBLISH 报文")
            topic = body[2 : 2 + topic_len].decode("utf-8", errors="replace")
            offset = 2 + topic_len
            qos = (flags >> 1) & 0x03
            packet_id = None
            if qos:
                if len(body) < offset + 2:
                    raise MQTTError("收到缺少 Packet ID 的 PUBLISH")
                packet_id = struct.unpack("!H", body[offset : offset + 2])[0]
                offset += 2
            message = MQTTMessage(topic, body[offset:], qos, bool(flags & 0x01))
            if self.on_message:
                self.on_message(message)
            if qos == 1 and packet_id:
                self._send_packet(0x40, struct.pack("!H", packet_id))
            elif qos == 2 and packet_id:
                self._send_packet(0x50, struct.pack("!H", packet_id))
            return

        if packet_type in (4, 5, 7, 11):
            if len(body) >= 2:
                self._signal_ack(packet_type, struct.unpack("!H", body[:2])[0])
            return
        if packet_type == 9:
            if len(body) >= 3:
                self._signal_ack(9, struct.unpack("!H", body[:2])[0], codes=list(body[2:]))
            return
        if packet_type == 6:
            if len(body) >= 2:
                packet_id = struct.unpack("!H", body[:2])[0]
                self._send_packet(0x70, struct.pack("!H", packet_id))
            return
        if packet_type == 13:  # PINGRESP
            return

    def _close_socket(self) -> None:
        sock, self._socket = self._socket, None
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass
