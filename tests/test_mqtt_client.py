import socket
import struct
import threading
import unittest

from mqtt_client import MQTTClient


def remaining_length(length):
    output = bytearray()
    while True:
        digit = length % 128
        length //= 128
        if length:
            digit |= 0x80
        output.append(digit)
        if not length:
            return bytes(output)


def packet(first, body=b""):
    return bytes([first]) + remaining_length(len(body)) + body


def read_exact(sock, count):
    data = bytearray()
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise ConnectionError("socket closed")
        data.extend(chunk)
    return bytes(data)


def read_packet(sock):
    first = read_exact(sock, 1)[0]
    length = 0
    multiplier = 1
    while True:
        digit = read_exact(sock, 1)[0]
        length += (digit & 0x7F) * multiplier
        if not digit & 0x80:
            break
        multiplier *= 128
    return first, read_exact(sock, length)


class FakeBroker:
    def __init__(self):
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(1)
        self.port = self.server.getsockname()[1]
        self.ready = threading.Event()
        self.received_publish = None
        self.error = None
        self.thread = threading.Thread(target=self.run, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def run(self):
        try:
            conn, _ = self.server.accept()
            conn.settimeout(4)
            with conn:
                first, _ = read_packet(conn)
                assert first >> 4 == 1
                conn.sendall(packet(0x20, b"\x00\x00"))

                first, body = read_packet(conn)
                assert first == 0x82
                packet_id = body[:2]
                conn.sendall(packet(0x90, packet_id + b"\x00"))
                self.ready.set()

                topic = b"agent/output"
                conn.sendall(packet(0x30, struct.pack("!H", len(topic)) + topic + b'{"ok":true}'))

                first, body = read_packet(conn)
                assert first >> 4 == 3
                topic_len = struct.unpack("!H", body[:2])[0]
                packet_id = body[2 + topic_len : 4 + topic_len]
                self.received_publish = body[4 + topic_len :]
                conn.sendall(packet(0x40, packet_id))

                try:
                    read_packet(conn)
                except (ConnectionError, socket.timeout):
                    pass
        except Exception as exc:
            self.error = exc
            self.ready.set()
        finally:
            self.server.close()


class MQTTClientTests(unittest.TestCase):
    def test_connect_subscribe_receive_and_qos1_publish(self):
        messages = []
        broker = FakeBroker().start()
        client = MQTTClient(on_message=messages.append)
        try:
            client.connect("127.0.0.1", broker.port, client_id="test-client")
            client.subscribe("agent/#", qos=0)
            self.assertTrue(broker.ready.wait(2))
            client.publish("agent/input", '{"hello":"world"}', qos=1)
            for _ in range(40):
                if messages:
                    break
                threading.Event().wait(0.025)
            self.assertEqual(messages[0].topic, "agent/output")
            self.assertEqual(messages[0].payload, b'{"ok":true}')
            self.assertEqual(broker.received_publish, b'{"hello":"world"}')
            self.assertIsNone(broker.error)
        finally:
            client.disconnect()
            broker.thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
