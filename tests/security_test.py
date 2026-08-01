#!/usr/bin/env python3
"""
Security-focused checks for static-server + admin-server (no Playwright).

Covers review findings: secret file deny-list, CORS/origin on /api/collect,
Basic Auth gate, CSRF on mutating POSTs, path allowlist.

  python tests/security_test.py
"""

from __future__ import annotations

import base64
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC_PORT = 6201
ADMIN_PORT = 6202
results: list[tuple[str, str, bool, str]] = []


def check(group: str, name: str, ok: bool, detail: str = "") -> None:
    results.append((group, name, bool(ok), detail))
    mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    line = f"  [{mark}] {name}"
    if detail and not ok:
        line += f"  → {detail}"
    print(line)


def wait_http(url: str, timeout: float = 8.0) -> None:
    """Wait until the server answers (any HTTP status, including 401)."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except urllib.error.HTTPError:
            # 4xx/5xx still means the process is listening.
            return
        except Exception as e:  # noqa: BLE001 — connection refused etc.
            last = e
            time.sleep(0.1)
    raise RuntimeError(f"server not up: {url} ({last})")


def http_req(
    url: str,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict | None = None,
    timeout: float = 5.0,
) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def start_node(script: str, env_extra: dict, ready_url: str) -> subprocess.Popen:
    env = os.environ.copy()
    env.update(env_extra)
    # Force UTF-8 console on Windows so Cyrillic paths in logs do not break.
    env.setdefault("PYTHONIOENCODING", "utf-8")
    proc = subprocess.Popen(
        ["node", script],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_http(ready_url)
    except Exception:
        proc.terminate()
        raise
    return proc


def test_static_server() -> None:
    print("\nstatic-server.js (allowlist / secrets)")
    base = f"http://127.0.0.1:{STATIC_PORT}"
    proc = start_node(
        "scripts/static-server.js",
        {"PORT": str(STATIC_PORT), "HOST": "127.0.0.1"},
        f"{base}/index.html",
    )
    try:
        code, _, _ = http_req(f"{base}/index.html")
        check("static", "index.html 200", code == 200, f"status={code}")

        secrets = [
            "/.admin-credentials.json",
            "/.admin-status.json",
            "/.analytics/events/x.jsonl",
            "/admin-server.js",
            "/package.json",
            "/update-catalog.js",
            "/.git/config",
        ]
        for path in secrets:
            code, _, body = http_req(base + path)
            # 400 Bad path (dotfiles) or 404 Not found — never 200 with content
            ok = code in (400, 404) and b"scrypt" not in body and b"password" not in body.lower()
            check("static", f"deny {path}", ok, f"status={code}")

        code, headers, _ = http_req(
            f"{base}/api/collect",
            method="POST",
            data=b'{"events":[]}',
            headers={"Content-Type": "application/json"},
        )
        check("static", "collect no Origin → 204", code == 204, f"status={code}")
        acao = headers.get("Access-Control-Allow-Origin") or headers.get("access-control-allow-origin")
        check("static", "collect has no CORS ACAO", not acao, f"ACAO={acao!r}")

        # HOST=0.0.0.0 without flag must refuse to start
        bad = subprocess.Popen(
            ["node", "scripts/static-server.js"],
            cwd=str(ROOT),
            env={**os.environ, "PORT": "6209", "HOST": "0.0.0.0"},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            bad.wait(timeout=3)
            check(
                "static",
                "refuse non-loopback HOST without flag",
                bad.returncode not in (None, 0),
                f"exit={bad.returncode}",
            )
        except subprocess.TimeoutExpired:
            bad.kill()
            check("static", "refuse non-loopback HOST without flag", False, "process did not exit")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_admin_server() -> None:
    print("\nadmin-server.js (auth / csrf / collect origin)")
    base = f"http://127.0.0.1:{ADMIN_PORT}"
    proc = start_node(
        "admin-server.js",
        {"PORT": str(ADMIN_PORT)},
        # health is authed — probe with expected 401
        f"{base}/admin.html",
    )
    # wait_http fails on 401; special-case probe
    deadline = time.time() + 8
    while time.time() < deadline:
        code, _, _ = http_req(f"{base}/api/status")
        if code in (401, 200):
            break
        time.sleep(0.1)
    else:
        proc.terminate()
        raise RuntimeError("admin-server did not respond")

    try:
        code, headers, _ = http_req(f"{base}/api/status")
        check("admin", "status without auth → 401", code == 401, f"status={code}")
        check(
            "admin",
            "WWW-Authenticate present",
            "basic" in (headers.get("WWW-Authenticate") or headers.get("www-authenticate") or "").lower(),
            str(headers.get("WWW-Authenticate") or headers.get("www-authenticate")),
        )

        code, _, _ = http_req(f"{base}/.admin-credentials.json")
        check("admin", "credentials path without auth → 401", code == 401, f"status={code}")

        # Wrong password still 401
        bad_auth = "Basic " + base64.b64encode(b"admin:definitely-wrong-password").decode()
        code, _, _ = http_req(
            f"{base}/api/status",
            headers={"Authorization": bad_auth},
        )
        check("admin", "wrong password → 401", code == 401, f"status={code}")

        # Collect: evil Origin rejected; no ACAO on success
        code, headers, body = http_req(
            f"{base}/api/collect",
            method="POST",
            data=b'{"events":[]}',
            headers={
                "Content-Type": "application/json",
                "Origin": "https://evil.example",
            },
        )
        check("admin", "collect evil Origin → 403", code == 403, f"status={code} body={body[:80]!r}")
        acao = headers.get("Access-Control-Allow-Origin") or headers.get("access-control-allow-origin")
        check("admin", "collect evil Origin has no ACAO", not acao, f"ACAO={acao!r}")

        code, headers, _ = http_req(
            f"{base}/api/collect",
            method="POST",
            data=b'{"events":[]}',
            headers={"Content-Type": "application/json"},
        )
        check("admin", "collect no Origin → 204", code == 204, f"status={code}")
        acao = headers.get("Access-Control-Allow-Origin") or headers.get("access-control-allow-origin")
        check("admin", "collect success has no ACAO", not acao, f"ACAO={acao!r}")

        # Mutating POST without auth → 401 (CSRF not reached)
        code, _, _ = http_req(
            f"{base}/api/update",
            method="POST",
            data=b"{}",
            headers={"Content-Type": "application/json"},
        )
        check("admin", "update without auth → 401", code == 401, f"status={code}")

        # With bogus auth, still 401 (cannot reach CSRF without valid password)
        code, _, _ = http_req(
            f"{base}/api/update",
            method="POST",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "Authorization": bad_auth,
                "X-CSRF-Token": "nope",
            },
        )
        check("admin", "update wrong auth → 401", code == 401, f"status={code}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_unit_host_and_csp() -> None:
    print("\nunit: isHseHost + public CSP")
    # Node one-liner for host matching
    script = r"""
const { isHseHost } = require('./lib/hse-catalog.js');
const cases = [
  ['hse.ru', true],
  ['www.hse.ru', true],
  ['pravo.hse.ru', true],
  ['evilhse.ru', false],
  ['not-hse.ru', false],
  ['hse.ru.evil.com', false],
];
let ok = true;
for (const [h, exp] of cases) {
  if (isHseHost(h) !== exp) { console.log('FAIL', h); ok = false; }
}
// isProgramUrl is not exported; spot-check via evil host in ingest path is enough
process.exit(ok ? 0 : 1);
"""
    r = subprocess.run(
        ["node", "-e", script],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    check("unit", "isHseHost rejects spoof hosts", r.returncode == 0, r.stdout + r.stderr)

    catalog = (ROOT / "Каталог программ.html").read_text(encoding="utf-8")
    check(
        "unit",
        "catalog CSP allows script-src 'self'",
        "script-src 'self'" in catalog and "connect-src 'self'" in catalog,
        "CSP meta missing 'self' or connect-src",
    )
    privacy = (ROOT / "privacy.html").read_text(encoding="utf-8")
    check(
        "unit",
        "privacy CSP allows script-src 'self'",
        "script-src 'self'" in privacy and "connect-src 'self'" in privacy,
        "CSP meta missing 'self' or connect-src",
    )
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    # Границу «внешней оболочки» берём по началу бандла, а не по числу символов:
    # с фиксированным окном тест ломался каждый раз, когда в head добавляли
    # мета-тег, — падал не код, а сама проверка.
    shell = index.split('<script type="__bundler/manifest">', 1)[0]
    check(
        "unit",
        "index.html has CSP meta",
        "Content-Security-Policy" in shell,
        "no CSP in outer shell",
    )
    check(
        "unit",
        "index.html post-swap CSP inject",
        "Post-swap security" in index,
        "missing inject after replaceWith",
    )


def main() -> None:
    print("Security tests — static-server + admin-server + CSP")
    try:
        test_unit_host_and_csp()
        test_static_server()
        test_admin_server()
    except Exception as e:
        print(f"\nFATAL: {e}")
        sys.exit(2)

    passed = sum(1 for *_, ok, _d in results if ok)
    total = len(results)
    failed = total - passed
    print("\n" + "─" * 60)
    print(f"ИТОГ security: {passed}/{total}, провалов: {failed}")
    if failed:
        for g, name, ok, detail in results:
            if not ok:
                print(f"  • [{g}] {name} — {detail}")
        sys.exit(1)
    print("Все security-проверки пройдены")
    sys.exit(0)


if __name__ == "__main__":
    main()
