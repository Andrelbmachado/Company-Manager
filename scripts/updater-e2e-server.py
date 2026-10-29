"""Servidor local dos cenários de falha do teste do atualizador (scripts/updater-e2e.sh).

Uso: python3 -I updater-e2e-server.py <porta> <pasta>
A pasta tem os latest-*.json e os pacotes. Rotas especiais:
- /truncated.tar.gz: anuncia o tamanho do pacote inteiro, manda só uma parte e fecha a conexão (download interrompido).
Todo o resto é servido como arquivo estático da pasta.
"""
import http.server
import os
import sys

PORT = int(sys.argv[1])
ROOT = sys.argv[2]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path == "/truncated.tar.gz":
            data = open(os.path.join(ROOT, "valid.tar.gz"), "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/gzip")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data[: len(data) // 3])
            self.wfile.flush()
            self.connection.shutdown(2)
            self.close_connection = True
            return
        super().do_GET()

    def log_message(self, format, *args):
        sys.stderr.write("[server] " + format % args + "\n")


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
