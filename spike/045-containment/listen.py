#!/usr/bin/env python3
"""Accept-and-close listeners bound to one address, so a "blocked" check means
the firewall dropped the packet, not that nothing was listening.

Usage: listen.py <bind-ip> <port> [<port> ...]
"""
import socket
import sys
import threading

host = sys.argv[1]


def serve(port: int) -> None:
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((host, port))
    s.listen(64)
    while True:
        conn, _ = s.accept()
        conn.close()


threads = [threading.Thread(target=serve, args=(int(p),), daemon=True) for p in sys.argv[2:]]
for t in threads:
    t.start()
for t in threads:
    t.join()
