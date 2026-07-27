#!/usr/bin/env python3
"""
Смоук-тест сайта Центра ДПО (Playwright, headless Chromium).

Поднимает статический сервер над корнем проекта и проверяет ключевые
пользовательские сценарии и релизные требования на публичных страницах:
главная (React-бандл Claude Design), каталог программ, политика ПДн.

Запуск:  tests/run.sh        (см. соседний скрипт — активирует venv)
или:     python tests/smoke_test.py

Выход 0 — все проверки прошли; выход 1 — есть провалы (годится для CI).
"""

import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright, Error as PWError

ROOT = Path(__file__).resolve().parent.parent
PORT = 6199
BASE = f"http://127.0.0.1:{PORT}"

# Публичные страницы (имена с кириллицей/пробелами кодируются в URL).
INDEX = f"{BASE}/index.html"
CATALOG = f"{BASE}/{urllib.parse.quote('Каталог программ.html')}"
PRIVACY = f"{BASE}/privacy.html"

# ── мини-фреймворк отчёта ─────────────────────────────────────────────
results = []  # (page, name, ok, detail)


def check(page_label, name, ok, detail=""):
    results.append((page_label, name, bool(ok), detail))
    mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    line = f"  [{mark}] {name}"
    if detail and not ok:
        line += f"  → {detail}"
    print(line)


def start_server():
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(50):
        try:
            urllib.request.urlopen(f"{BASE}/index.html", timeout=1)
            return proc
        except Exception:
            time.sleep(0.1)
    proc.terminate()
    raise RuntimeError("Статический сервер не поднялся")


def collect_page(context, url, wait_selector=None):
    """Открывает страницу в свежем контексте (чистый localStorage), собирая
    ошибки консоли, внешние сетевые запросы и битые ресурсы (4xx/5xx)."""
    console_errors = []
    external_hosts = set()
    broken = []  # (url, status) для своих ресурсов со статусом ≥ 400
    page = context.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append(str(e)))

    def on_request(req):
        u = urllib.parse.urlparse(req.url)
        if u.scheme in ("http", "https") and u.hostname not in ("127.0.0.1", "localhost"):
            external_hosts.add(u.hostname)

    def on_response(resp):
        u = urllib.parse.urlparse(resp.url)
        # /favicon.ico — авто-проба браузера, а не ссылка со страницы; не считаем.
        if (u.hostname in ("127.0.0.1", "localhost") and resp.status >= 400
                and not u.path.endswith("/favicon.ico")):
            broken.append((u.path, resp.status))

    page.on("request", on_request)
    page.on("response", on_response)
    page.goto(url, wait_until="networkidle")
    if wait_selector:
        page.wait_for_selector(wait_selector, timeout=8000)
    return page, console_errors, external_hosts, broken


# ── тесты страниц ─────────────────────────────────────────────────────
def test_index(context):
    lbl = "index.html"
    print(f"\n{lbl} (главная, Claude Design)")
    try:
        page, errors, external, broken = collect_page(context, INDEX, wait_selector="#viToggle")
    except PWError as e:
        check(lbl, "страница отрисовалась", False, str(e))
        return
    page.wait_for_timeout(800)  # добить пост-рендер аддоны (cookie-banner)

    check(lbl, "заголовок вкладки",
          page.title() == "Образование для профессионалов права · Центр ДПО НИУ ВШЭ",
          f"got: {page.title()!r}")
    check(lbl, "favicon подключён",
          page.eval_on_selector('link[rel="icon"]', "el => el.getAttribute('href')") == "favicon.svg")
    check(lbl, "theme-color = #1658DA",
          page.eval_on_selector('meta[name="theme-color"]', "el => el.content") == "#1658DA")
    check(lbl, "шрифты HSE Sans/Slab загружены",
          page.evaluate('document.fonts.check(\'16px "HSE Sans"\') && document.fonts.check(\'700 22px "HSE Slab"\')'))
    check(lbl, "hero-фото отрисовано",
          page.evaluate("""() => [...document.querySelectorAll('div')].some(d => {
              const bg = getComputedStyle(d).backgroundImage;
              return bg && bg !== 'none' && (bg.includes('blob:') || bg.includes('data:') || bg.includes('.jpg') || bg.includes('.png'));
          })"""))

    # версия для слабовидящих
    page.click("#viToggle")
    vi_on = page.evaluate("document.documentElement.classList.contains('vi-mode')")
    page.click("#viToggle")
    vi_off = not page.evaluate("document.documentElement.classList.contains('vi-mode')")
    check(lbl, "версия для слабовидящих вкл/выкл", vi_on and vi_off)

    # сторож регрессии: клик должен работать и спустя время (делегированный
    # обработчик переживает пересборку React-шапки рантаймом).
    page.wait_for_timeout(2500)
    page.click("#viToggle")
    vi_late = page.evaluate("document.documentElement.classList.contains('vi-mode')")
    page.click("#viToggle")
    check(lbl, "переключатель работает и после ре-рендеров", vi_late,
          "делегированный обработчик потерян")

    # куки-баннер: отклонить запоминается
    banner = page.query_selector("#cookieBanner")
    check(lbl, "куки-баннер показан", banner is not None)
    if banner:
        page.click("#cookieBanner .cb-decline")
        consent = page.evaluate("localStorage.getItem('cookie-consent')")
        gone = page.query_selector("#cookieBanner") is None
        check(lbl, "отказ от cookie запомнен", gone and consent == "declined", f"consent={consent}")

    # email собраны в браузере (в исходном HTML их нет)
    emails = page.evaluate("""() => [...document.querySelectorAll('.email-protect')]
        .map(a => ({href: a.getAttribute('href'), text: a.textContent}))""")
    check(lbl, "email собраны из data-атрибутов (защита от ботов)",
          len(emails) >= 2 and all(e["href"].startswith("mailto:") and "@" in e["text"] for e in emails),
          str(emails))

    # юридические ссылки в футере
    footer = page.evaluate("() => [...document.querySelectorAll('footer a')].map(a => a.getAttribute('href'))")
    check(lbl, "футер: политика ПДн + сведения об организации",
          any("privacy.html" in h for h in footer) and any("sveden" in h for h in footer),
          str(footer))

    check(lbl, "нет ошибок в консоли", not errors, "; ".join(errors[:3]))
    check(lbl, "нет битых ресурсов (4xx/5xx)", not broken, str(broken))
    check(lbl, "ноль внешних запросов (152-ФЗ)", not external, f"внешние хосты: {sorted(external)}")
    page.close()


def test_catalog(context):
    lbl = "Каталог программ.html"
    print(f"\n{lbl}")
    page, errors, external, broken = collect_page(context, CATALOG)

    total = page.eval_on_selector_all("#grid .card", "els => els.length")
    check(lbl, "карточки программ (≥17)", total >= 17, f"got {total}")

    chips = page.eval_on_selector_all(".filters .chip", "els => els.length")
    check(lbl, "чипы-фильтры присутствуют", chips >= 6, f"got {chips}")

    # фильтр реально сужает выдачу
    page.click('#filters .chip:nth-child(2)')  # первый тип после «Все»
    visible = page.eval_on_selector_all(
        "#grid .card", "els => els.filter(c => c.style.display !== 'none').length")
    check(lbl, "фильтр по типу сужает выдачу", 0 < visible < total, f"visible={visible}/{total}")
    page.click('#filters .chip:first-child')  # назад на «Все»

    check(lbl, "favicon подключён",
          page.eval_on_selector('link[rel="icon"]', "el => el.getAttribute('href')") == "favicon.svg")
    check(lbl, "ссылка «← На лендинг» → index.html",
          page.eval_on_selector('header a.back', "el => el.getAttribute('href')") == "index.html")
    check(lbl, "нет ошибок в консоли", not errors, "; ".join(errors[:3]))
    check(lbl, "нет битых ресурсов (4xx/5xx)", not broken, str(broken))
    check(lbl, "ноль внешних запросов (152-ФЗ)", not external, f"внешние хосты: {sorted(external)}")
    page.close()


def test_privacy(context):
    lbl = "privacy.html"
    print(f"\n{lbl}")
    page, errors, external, broken = collect_page(context, PRIVACY)

    check(lbl, "заголовок политики",
          "Политика обработки персональных данных" in page.inner_text("h1"))
    check(lbl, "версия для слабовидящих присутствует",
          page.query_selector("#viToggle") is not None)
    check(lbl, "функция сброса cookie-согласия доступна",
          page.evaluate("typeof window.resetCookieConsent === 'function'"))
    check(lbl, "email собран",
          page.evaluate("""() => { const a = document.querySelector('.email-protect');
              return a && a.getAttribute('href').startsWith('mailto:') && a.textContent.includes('@'); }"""))
    check(lbl, "нет ошибок в консоли", not errors, "; ".join(errors[:3]))
    check(lbl, "нет битых ресурсов (4xx/5xx)", not broken, str(broken))
    page.close()


def main():
    print("Смоук-тест сайта Центра ДПО — Playwright / headless Chromium")
    server = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            # свежий контекст на страницу — чистый localStorage (баннер показывается)
            for test in (test_index, test_catalog, test_privacy):
                ctx = browser.new_context()
                try:
                    test(ctx)
                finally:
                    ctx.close()
            browser.close()
    finally:
        server.terminate()

    passed = sum(1 for *_, ok, _ in ((r[0], r[1], r[2], r[3]) for r in results) if ok)
    total = len(results)
    failed = total - passed
    print("\n" + "─" * 60)
    print(f"ИТОГ: {passed}/{total} проверок пройдено, провалов: {failed}")
    if failed:
        print("\nПровалы:")
        for pg, name, ok, detail in results:
            if not ok:
                print(f"  • [{pg}] {name} — {detail}")
        sys.exit(1)
    print("Все проверки пройдены ✓")
    sys.exit(0)


if __name__ == "__main__":
    main()
