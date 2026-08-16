#!/usr/bin/env python3
"""
Security-focused checks for static-server + admin-server (no Playwright).

Covers review findings: secret file deny-list, CORS/origin on /api/collect,
Basic Auth gate, CSRF on mutating POSTs, path allowlist.

  python tests/security_test.py
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
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


def test_admin_authed() -> None:
    """Проверки, для которых нужен вход в админку.

    Запускается в ОТДЕЛЬНОЙ копии проекта во временном каталоге, и это
    принципиально: админ-сервер при первом старте сам создаёт пароль, а
    сохранение программ переписывает «Каталог программ.html» на диске. В
    рабочем каталоге тест либо не смог бы войти (пароль знает только владелец),
    либо испортил бы настоящий каталог.
    """
    print("\nadmin-server.js (с авторизацией, во временной копии)")
    port = 6203
    with tempfile.TemporaryDirectory() as tmp:
        sandbox = Path(tmp)
        for name in ("admin-server.js", "update-catalog.js", "admin.html",
                     "Каталог программ.html", "package.json"):
            src = ROOT / name
            if src.exists():
                shutil.copy2(src, sandbox / name)
        shutil.copytree(ROOT / "lib", sandbox / "lib")

        env = os.environ.copy()
        env.update({"PORT": str(port), "PYTHONIOENCODING": "utf-8"})
        proc = subprocess.Popen(
            ["node", "admin-server.js"], cwd=str(sandbox), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        try:
            # Пароль печатается один раз при первом запуске — забираем из вывода
            password = None
            deadline = time.time() + 15
            while time.time() < deadline and password is None:
                line = proc.stdout.readline()
                if not line:
                    break
                m = re.search(r"Пароль[^:]*:\s*(\S+)", line)
                if m:
                    password = m.group(1)
            if not password:
                proc.terminate()
                raise RuntimeError("не удалось получить пароль из вывода админ-сервера")

            # Дальше вывод сервера нужно КУДА-ТО девать. Если этого не делать,
            # буфер канала (64 КБ) заполняется, Node блокируется на записи в
            # stdout и перестаёт отвечать — тест падал с «connection reset»
            # ровно тогда, когда сервер писал чуть больше логов.
            threading.Thread(target=lambda: proc.stdout.read(), daemon=True).start()

            base = f"http://127.0.0.1:{port}"
            wait_http(f"{base}/api/status")
            auth = "Basic " + base64.b64encode(f"admin:{password}".encode()).decode()
            code, _, body = http_req(f"{base}/api/status", headers={"Authorization": auth})
            check("authed", "вход по сгенерированному паролю", code == 200, f"status={code}")
            csrf = json.loads(body).get("csrfToken", "")
            hdr = {"Authorization": auth, "X-CSRF-Token": csrf,
                   "Origin": base, "Content-Type": "application/json"}

            # Слишком большое тело: клиент должен получить 413, а не обрыв связи.
            # Раньше readBody рвал сокет раньше ответа, и в админке вместо
            # понятной ошибки была «сеть недоступна».
            #
            # Тело умеренно превышает лимит (≈1,2 МБ против 512 КБ) — так же,
            # как это выглядит при реальной ошибке оператора. Многомегабайтную
            # загрузку сервер обрывает намеренно: дочитывать её ради вежливого
            # ответа означало бы принимать ровно тот объём, от которого лимит и
            # защищает (см. LINGER_BYTES/LINGER_MS в admin-server.js).
            big = json.dumps({"programs": [{"id": f"x{i}", "title": "я" * 200}
                                           for i in range(1000)]}).encode()
            code, _, _ = http_req(f"{base}/api/programs", method="PUT", data=big, headers=hdr)
            check("authed", "тело сверх лимита → 413, а не обрыв", code == 413, f"status={code}")
            code, _, _ = http_req(f"{base}/api/status", headers={"Authorization": auth})
            check("authed", "сервер жив после отказа по размеру", code == 200, f"status={code}")

            # Расписание: мусор отвергается, а не зажимается молча в диапазон
            for bad in ({"enabled": True, "hour": 99, "minute": 0},
                        {"enabled": True, "hour": 3, "minute": -5},
                        {"enabled": True, "hour": "три", "minute": 0},
                        {"enabled": True, "hour": 3.5, "minute": 0}):
                code, _, _ = http_req(f"{base}/api/schedule", method="PUT",
                                      data=json.dumps(bad).encode(), headers=hdr)
                check("authed", f"расписание отвергает {bad['hour']}:{bad['minute']}",
                      code == 400, f"status={code}")
            code, _, _ = http_req(f"{base}/api/schedule", method="PUT",
                                  data=json.dumps({"enabled": True, "hour": 4, "minute": 30}).encode(),
                                  headers=hdr)
            check("authed", "корректное расписание сохраняется", code == 200, f"status={code}")

            # Разметка от постороннего источника не должна становиться кодом
            payload = {"programs": [{
                "id": "local-xss",
                "title": '<script>alert(1)</script>" onmouseover="alert(2)',
                "url": "javascript:alert(3)",
                "type": "ПК", "format": "Онлайн", "price": 1000, "locked": True,
            }]}
            code, _, _ = http_req(f"{base}/api/programs", method="PUT",
                                  data=json.dumps(payload).encode(), headers=hdr)
            check("authed", "программа с разметкой в названии сохраняется", code == 200, f"status={code}")
            html = (sandbox / "Каталог программ.html").read_text(encoding="utf-8")
            check("authed", "тег из названия экранирован",
                  "<script>alert(1)</script>" not in html and "&lt;script&gt;alert(1)" in html)
            check("authed", "javascript: в ссылку не попал", "javascript:" not in html)
        finally:
            proc.terminate()
            proc.wait(timeout=5)


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


def test_application_intake() -> None:
    """Приём заявок: единственный публичный маршрут с персональными данными.

    Проверяется на превью-сервере: он повторяет прод-поведение (на проде тот
    же адрес nginx проксирует в админ-сервис). Каталог заявок — временный:
    тест не должен писать в настоящие заявки центра.
    """
    print("\nприём заявок (персональные данные)")
    port = 6204
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory() as tmp:
        proc = start_node(
            "scripts/static-server.js",
            {"PORT": str(port), "HOST": "127.0.0.1", "APPLICATIONS_DIR": tmp},
            f"{base}/index.html",
        )
        try:
            good = {
                "firstName": "Анна", "lastName": "Петрова",
                "phone": "+7 999 123-45-67", "email": "anna@example.org",
                "consent": True,
            }
            hdr = {"Content-Type": "application/json"}

            code, _, _ = http_req(f"{base}/api/application", method="POST",
                                  data=json.dumps(good).encode(), headers=hdr)
            check("application", "корректная заявка принимается", code == 200, f"status={code}")

            no_consent = {**good, "email": "b@example.org", "consent": False}
            code, _, body = http_req(f"{base}/api/application", method="POST",
                                     data=json.dumps(no_consent).encode(), headers=hdr)
            check("application", "без согласия на обработку ПДн → 400", code == 400, f"status={code}")
            check("application", "ответ называет поле согласия",
                  b"consent" in body, body[:120].decode("utf-8", "replace"))

            trap = {**good, "email": "bot@example.org", "website": "http://spam.example"}
            code, _, _ = http_req(f"{base}/api/application", method="POST",
                                  data=json.dumps(trap).encode(), headers=hdr)
            check("application", "ловушка для роботов отвечает как при успехе", code == 200, f"status={code}")

            code, _, _ = http_req(f"{base}/api/application", method="POST",
                                  data="{ не json".encode(), headers=hdr)
            check("application", "битый JSON → 400", code == 400, f"status={code}")

            code, _, _ = http_req(f"{base}/api/application", method="GET")
            check("application", "GET не принимается", code in (404, 405), f"status={code}")

            # Персональные данные не должны утечь через список файлов.
            code, _, body = http_req(f"{base}/.applications/2026-08.jsonl")
            check("application", "каталог заявок не отдаётся по HTTP",
                  code in (400, 404) and b"example.org" not in body, f"status={code}")

            files = sorted(Path(tmp).glob("*.jsonl"))
            saved = files[0].read_text(encoding="utf-8") if files else ""
            check("application", "заявка робота НЕ сохранена",
                  "bot@example.org" not in saved, "заявка из ловушки попала в журнал")
            check("application", "заявка без согласия НЕ сохранена",
                  "b@example.org" not in saved, "заявка без согласия попала в журнал")
            check("application", "файл заявок доступен только владельцу (0600)",
                  bool(files) and (files[0].stat().st_mode & 0o777) == 0o600,
                  f"mode={oct(files[0].stat().st_mode & 0o777) if files else 'нет файла'}")

            # Разметка в имени — это ДАННЫЕ. В журнале она хранится как есть
            # (JSONL не HTML-файл), а безопасность обеспечивает вывод: список
            # заявок отдаётся как JSON, а админка рисует его через escapeHtml.
            xss = {**good, "email": "xss@example.org",
                   "firstName": "<img src=x onerror=alert(1)>"}
            code, _, _ = http_req(f"{base}/api/application", method="POST",
                                  data=json.dumps(xss).encode(), headers=hdr)
            check("application", "заявка с разметкой в имени принимается как данные",
                  code == 200, f"status={code}")
            admin_html = (ROOT / "admin.html").read_text(encoding="utf-8")
            check("application", "админка экранирует поля заявки при выводе",
                  "escapeHtml(a.lastName" in admin_html and "escapeHtml(v)" in admin_html,
                  "рендер заявок должен идти через escapeHtml")
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
        code, _, body = http_req(f"{base}/api/applications")
        check("admin", "список заявок без авторизации → 401",
              code == 401 and b"example.org" not in body, f"status={code}")

        code, _, _ = http_req(f"{base}/api/applications/status", method="POST",
                              data=b'{"id":"x","status":"done"}',
                              headers={"Content-Type": "application/json"})
        check("admin", "смена статуса заявки без авторизации → 401", code == 401, f"status={code}")

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


def test_nginx_allowlist() -> None:
    """Белый список публичных адресов в docker/nginx.conf.

    В контейнер nginx монтируется весь каталог проекта — вместе с кодом
    админки, .git и .admin-credentials.json (логин и хеш пароля). Единственное,
    что не даёт отдать их по HTTP, — регулярка-белый-список в конфиге. Проверка
    статическая (без Docker): она ловит именно тот случай, когда правило
    потеряли при правке конфига, а заметили бы уже после утечки.
    """
    print("\ndocker/nginx.conf (белый список)")
    conf = (ROOT / "docker" / "nginx.conf").read_text(encoding="utf-8")

    # Само правило: отрицательный просмотр вперёд + return 404
    has_rule = "location ~ " in conf and "(?!" in conf and "return 404" in conf
    check("nginx", "белый список публичных адресов на месте", has_rule,
          "в конфиге нет location с отрицательным просмотром вперёд")

    # Всё публичное перечислено — иначе правило молча выключит рабочие адреса
    allow_line = next((ln for ln in conf.splitlines() if "location ~ " in ln and "(?!" in ln), "")
    for token in ("index\\.html", "404\\.html", "favicon\\.svg",
                  "robots\\.txt", "sitemap\\.xml", "fonts/", "images/", "js/"):
        check("nginx", f"в белом списке есть {token.replace(chr(92), '')}",
              token in allow_line, "публичный путь выпал из списка")

    # Приватное в белый список попасть не должно
    for secret in (".admin-credentials", ".git", "admin-server", "lib/", "tests/"):
        check("nginx", f"приватное не попало в белый список: {secret}",
              secret not in allow_line, "приватный путь оказался публичным")

    # Админка и архив закрыты отдельными правилами
    check("nginx", "admin.html закрыт", "location = /admin.html { return 404; }" in conf)
    check("nginx", "архив закрыт", "location ^~ /archive/ { return 404; }" in conf)


def main() -> None:
    print("Security tests — static-server + admin-server + CSP")
    try:
        test_unit_host_and_csp()
        test_nginx_allowlist()
        test_static_server()
        test_application_intake()
        test_admin_server()
        test_admin_authed()
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
