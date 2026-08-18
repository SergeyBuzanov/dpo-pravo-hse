#!/usr/bin/env python
"""
Ротация девизов первого экрана: поведение в настоящем браузере.

Алгоритм мешка проверяется юнит-тестами (tests/unit/slogan-bag.test.js) – там
и круги, и стыки, и веса, и мусор в хранилище. Здесь проверяется то, что в
Node не воспроизвести: что фраза доезжает до разметки, что экран загрузки и
готовая страница показывают одно и то же, что отказ localStorage не роняет
страницу и что подстановка не двигает макет.

Запускается из tests/run.sh. Сервер поднимается свой, на отдельном порту.
"""

import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 6201
BASE = f"http://127.0.0.1:{PORT}"
INDEX = f"{BASE}/index.html"

# Банк читаем из того же файла, что и страница: тест не должен знать фразы
# наизусть, иначе он разойдётся с содержимым при первой же правке.
import json

BANK = json.loads((ROOT / "content" / "slogans.json").read_text(encoding="utf8"))
SLOGANS = [s["text"] for s in BANK["slogans"]]

failures = []


def check(name, ok, detail=""):
    mark = "✓" if ok else "✗"
    line = f"  {mark} {name}"
    if detail and not ok:
        line += f"  → {detail}"
    print(line)
    if not ok:
        failures.append(name)


def start_server():
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(50):
        try:
            urllib.request.urlopen(INDEX, timeout=1)
            return proc
        except Exception:
            time.sleep(0.1)
    proc.terminate()
    raise RuntimeError("Статический сервер не поднялся")


def main():
    print("Девизы первого экрана")
    server = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            # Круг и стык. Контекст один на все загрузки: хранилище общее,
            # ровно как у живого посетителя, который обновляет страницу.
            ctx = browser.new_context()
            page = ctx.new_page()
            seen = []
            for _ in range(len(SLOGANS) * 2 + 2):
                page.goto(INDEX, wait_until="domcontentloaded")
                page.wait_for_selector("[data-dpo-motto]", timeout=15000)
                seen.append(page.inner_text("[data-dpo-motto]").strip())

            check(
                "за круг показаны все фразы банка",
                set(seen[: len(SLOGANS)]) == set(SLOGANS),
                f"недостало: {set(SLOGANS) - set(seen[: len(SLOGANS)])}",
            )
            repeats = [i for i in range(1, len(seen)) if seen[i] == seen[i - 1]]
            check(
                "нет двух одинаковых фраз подряд, включая стык кругов",
                not repeats,
                f"повторы на загрузках {repeats}",
            )
            check(
                "все показанные фразы из банка",
                all(s in SLOGANS for s in seen),
                f"чужое: {[s for s in seen if s not in SLOGANS]}",
            )
            ctx.close()

            # Экран загрузки и готовая страница – одна и та же фраза, иначе
            # посетитель увидит, как текст меняется у него на глазах.
            ctx = browser.new_context()
            page = ctx.new_page()
            page.goto(INDEX, wait_until="commit")
            early = page.wait_for_selector(".spl-motto", timeout=10000).inner_text().strip()
            page.wait_for_selector("[data-dpo-motto]", timeout=15000)
            late = page.inner_text("[data-dpo-motto]").strip()
            check("экран загрузки и страница показывают одну фразу", early == late, f"{early!r} против {late!r}")
            ctx.close()

            # Мелькание. Рантайм строит девиз из шаблона, где захардкожена
            # дефолтная фраза; если её переписывать после сборки, посетитель
            # увидит смену текста. Проверяем, что настоящий девиз за всю
            # загрузку принимает ровно одно значение.
            ctx = browser.new_context()
            page = ctx.new_page()
            page.add_init_script(
                "window.__log=[];"
                "new MutationObserver(function(){"
                "  var el=document.querySelector('[data-dpo-motto]');"
                "  if(!el) return; var t=el.textContent.trim();"
                "  if(!window.__log.length||window.__log[window.__log.length-1]!==t) window.__log.push(t);"
                "}).observe(document,{childList:true,subtree:true,characterData:true});"
            )
            flashes = []
            for _ in range(8):
                page.goto(INDEX, wait_until="domcontentloaded")
                page.wait_for_selector("[data-dpo-motto]", timeout=15000)
                page.wait_for_timeout(600)
                log = page.evaluate("() => window.__log")
                page.evaluate("() => { window.__log = []; }")
                if len(log) > 1:
                    flashes.append(log)
            check(
                "дефолтная фраза не мелькает перед выбранной",
                not flashes,
                f"смена текста на {len(flashes)} загрузках из 8: {flashes[:1]}",
            )
            ctx.close()

            # Недоступное хранилище: приватный режим, блокировщики.
            ctx = browser.new_context()
            page = ctx.new_page()
            page.add_init_script(
                "Storage.prototype.setItem=function(){throw new Error('quota')};"
                "Storage.prototype.getItem=function(){throw new Error('blocked')};"
            )
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(INDEX, wait_until="domcontentloaded")
            page.wait_for_selector("[data-dpo-motto]", timeout=15000)
            text = page.inner_text("[data-dpo-motto]").strip()
            check("при недоступном localStorage показана валидная фраза", text in SLOGANS, repr(text))
            check("при недоступном localStorage нет ошибок на странице", not errors, str(errors[:2]))
            ctx.close()

            # Без JavaScript виден дефолтный девиз.
            ctx = browser.new_context(java_script_enabled=False)
            page = ctx.new_page()
            page.goto(INDEX, wait_until="domcontentloaded")
            html = page.content()
            check("без JavaScript в разметке дефолтная фраза", SLOGANS[0] in html)
            ctx.close()

            # Сдвиг макета. Меряем настоящий CLS через PerformanceObserver, а
            # не подстановкой фраз руками: фраза выбирается до первой отрисовки
            # (скрипт правит шаблон, пока рантайм до него не добрался), поэтому
            # «до и после подстановки» сравнивать нечего – подстановки нет.
            # Проверяем то, что важно посетителю: страница не дёргается.
            ctx = browser.new_context(viewport={"width": 375, "height": 812})
            page = ctx.new_page()
            page.add_init_script(
                "window.__cls=0;"
                "new PerformanceObserver(function(l){"
                "  l.getEntries().forEach(function(e){ if(!e.hadRecentInput) window.__cls+=e.value; });"
                "}).observe({type:'layout-shift', buffered:true});"
            )
            page.goto(INDEX, wait_until="domcontentloaded")
            page.wait_for_selector("[data-dpo-motto]", timeout=15000)
            page.wait_for_timeout(2500)
            cls = page.evaluate("() => window.__cls")
            motto_box = page.evaluate(
                """() => {
                    const m = document.querySelector('[data-dpo-motto]');
                    const r = m.getBoundingClientRect();
                    const cs = getComputedStyle(m);
                    return { h: Math.round(r.height), line: Math.round(parseFloat(cs.lineHeight)) };
                }"""
            )
            # Порог 0.1 – граница «хорошо» по Core Web Vitals. Ноль недостижим:
            # часть сдвига даёт подмена документа рантаймом, к девизам отношения
            # не имеющая. Здесь важно, что девиз её не увеличивает.
            check("сдвиг макета в пределах нормы Core Web Vitals", cls < 0.1, f"CLS {cls:.4f}")
            check(
                "блок девиза не резервирует пустую строку",
                motto_box["h"] <= motto_box["line"] * 2 + 2,
                f"высота {motto_box['h']}px при строке {motto_box['line']}px",
            )
            ctx.close()

            browser.close()
    finally:
        server.terminate()

    print()
    if failures:
        print(f"ПРОВАЛЕНО: {len(failures)}")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("Девизы: все проверки пройдены")


if __name__ == "__main__":
    main()
