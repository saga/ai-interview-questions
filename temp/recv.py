import http.server, json, sys

class H(http.server.BaseHTTPRequestHandler):
    def _send(self, code=200):
        self.send_response(code); self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type'); self.end_headers()
    def do_OPTIONS(self):
        self._send()
    def do_POST(self):
        n=int(self.headers.get('Content-Length',0)); body=self.rfile.read(n)
        with open('/Users/saga/code-repos/ai-interview-questions/temp/examcademy-raw.json','wb') as f: f.write(body)
        self._send(); self.wfile.write(b'ok')

http.server.HTTPServer(('127.0.0.1',8731), H).serve_forever()
