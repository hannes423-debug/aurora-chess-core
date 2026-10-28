#!/usr/bin/env python3
"""Minimal CDP driver for Aurora Chess headless verification.

Usage:  python3 tools/cdp.py <script.js> [--shot out.png] [--size WxH] [--wait ms]

The JS file is evaluated in the page after boot and must end in an expression
(awaited if it is a promise). Its JSON result is printed to stdout.

Headless WebGL needs the swiftshader flags or there is no GL context at all,
and headless rAF is throttled to ~3fps, so the page's own render loop is
supplemented by a setInterval pump before any screenshot is taken.
"""
import json, os, subprocess, sys, time, urllib.request, base64, shutil, tempfile
import websocket

CHROME = shutil.which('google-chrome') or shutil.which('chromium')
FLAGS = [
    '--headless=new', '--disable-gpu-sandbox', '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--mute-audio',
    '--disable-lcd-text', '--force-device-scale-factor=1',
    '--remote-allow-origins=*',
]

class Page:
    def __init__(self, url, size=(1280, 800), port=9333):
        self.profile = tempfile.mkdtemp(prefix='aurora-cdp-')
        self.proc = subprocess.Popen(
            [CHROME, *FLAGS, f'--remote-debugging-port={port}',
             f'--user-data-dir={self.profile}',
             f'--window-size={size[0]},{size[1]}', url],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.port = port
        self.msg_id = 0
        ws_url = None
        for _ in range(80):
            try:
                tabs = json.load(urllib.request.urlopen(
                    f'http://127.0.0.1:{port}/json/list', timeout=1))
                for t in tabs:
                    if t.get('type') == 'page' and t.get('webSocketDebuggerUrl'):
                        ws_url = t['webSocketDebuggerUrl']; break
                if ws_url: break
            except Exception:
                pass
            time.sleep(0.25)
        if not ws_url:
            raise RuntimeError('no CDP page target')
        self.ws = websocket.create_connection(ws_url, timeout=60,
                                              max_size=64 * 1024 * 1024)
        self.send('Runtime.enable')
        self.send('Page.enable')
        self.send('Log.enable')
        self._size = size

    def emulate(self, w, h, dpr=3, mobile=True):
        """Set the real CSS viewport. --window-size is the OS WINDOW, which
        includes browser chrome — asking for 390 gave a 500px viewport, so
        phone-width layout bugs were invisible to every earlier probe. This
        overrides what the page actually sees."""
        self.send('Emulation.setDeviceMetricsOverride', width=w, height=h,
                  deviceScaleFactor=dpr, mobile=mobile)
        if mobile:
            self.send('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
            self.send('Emulation.setUserAgentOverride', userAgent=(
                'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
                'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'))

    def send(self, method, **params):
        self.msg_id += 1
        mid = self.msg_id
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == mid:
                if 'error' in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get('result', {})

    def eval(self, expr, await_promise=True):
        r = self.send('Runtime.evaluate', expression=expr, returnByValue=True,
                      awaitPromise=await_promise, userGesture=True)
        if 'exceptionDetails' in r:
            d = r['exceptionDetails']
            raise RuntimeError('JS: ' + json.dumps(
                d.get('exception', {}).get('description', d.get('text'))))
        return r.get('result', {}).get('value')

    def pump(self):
        """Headless throttles rAF to ~3fps; drive the renderer directly."""
        self.eval("""(function(){
          if (window.__pump) return 'already';
          window.__pump = setInterval(function(){
            try { if (window.renderer && window.scene && window.camera)
                    renderer.render(scene, camera); } catch(e) {}
          }, 33);
          return 'pumping';
        })()""", await_promise=False)

    def click(self, x, y):
        """A REAL user gesture. A synthesised element.click() from JS does not
        count as user activation, so it never lifts the autoplay block —
        Input.dispatchMouseEvent does."""
        for t in ('mousePressed', 'mouseReleased'):
            self.send('Input.dispatchMouseEvent', type=t, x=x, y=y,
                      button='left', clickCount=1, buttons=1 if t == 'mousePressed' else 0)

    def shot(self, path):
        r = self.send('Page.captureScreenshot', format='png', fromSurface=True,
                      captureBeyondViewport=False)
        open(path, 'wb').write(base64.b64decode(r['data']))
        return path

    def close(self):
        try: self.ws.close()
        except Exception: pass
        self.proc.terminate()
        try: self.proc.wait(timeout=5)
        except Exception: self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


def main():
    args = sys.argv[1:]
    script = args[0]
    shot = size = None
    wait = 3500
    if '--shot' in args: shot = args[args.index('--shot') + 1]
    if '--size' in args:
        w, h = args[args.index('--size') + 1].split('x'); size = (int(w), int(h))
    if '--wait' in args: wait = int(args[args.index('--wait') + 1])
    url = 'http://localhost:8123/index.html'
    if '--url' in args: url = args[args.index('--url') + 1]

    mobile = '--mobile' in args
    p = Page('about:blank' if (size and mobile) else url, size=size or (1280, 800))
    try:
        if size and mobile:
            # Emulation must be in place BEFORE the app boots: 03_scene.js reads
            # the UA once at load for IS_MOBILE, and 11_camera.js picks its
            # default camera mode from the viewport aspect on first evaluation.
            p.emulate(size[0], size[1])
            p.send('Page.navigate', url=url)
        elif size:
            p.emulate(size[0], size[1], dpr=1, mobile=False)
        time.sleep(wait / 1000)
        p.pump()
        time.sleep(0.4)
        out = p.eval('(async()=>{' + open(script).read() + '})()')
        if '--click' in args:
            cx, cy = args[args.index('--click') + 1].split(',')
            p.click(int(cx), int(cy))
        if '--then' in args:
            time.sleep(float(args[args.index('--then-wait') + 1]) if '--then-wait' in args else 2.5)
            out = {'first': out,
                   'after_click': p.eval('(async()=>{' + open(args[args.index('--then') + 1]).read() + '})()')}
        print(json.dumps(out, indent=1, ensure_ascii=False))
        if shot:
            p.shot(shot)
            print('shot:', shot, file=sys.stderr)
    finally:
        p.close()

if __name__ == '__main__':
    main()
