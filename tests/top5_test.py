#!/usr/bin/env python
"""
Блок программ на лендинге: свёртка на телефоне и кнопка «Показать ещё».

Пятнадцать карточек в одну колонку растягивают блок до 7,2 экрана телефона.
Первые шесть остаются видны, остальные – за кнопкой. От двух колонок и выше
свёртки нет вовсе.

Главное, что здесь проверяется: без JavaScript ничего не прячется. Свёртку
включает скрипт, а не правило CSS, иначе девять программ стали бы недостижимы
у того, у кого JavaScript выключен.

Запускается из tests/run.sh, сервер поднимается свой.
"""

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 6202
INDEX = f"http://127.0.0.1:{PORT}/index.html"

VISIBLE_ON_PHONE = 6
failures = []


def check(name, ok, detail=""):
    print(f"  {'✓' if ok else '✗'} {name}" + (f"  → {detail}" if detail and not ok else ""))
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


STATE = """() => {
  const g = document.querySelector('.dpo-top5-grid');
  const btn = document.querySelector('.dpo-top5-more');
  const tiles = [...g.querySelectorAll('.dpo-tile')];
  return {
    total: tiles.length,
    visible: tiles.filter(t => t.getBoundingClientRect().height > 0).length,
    collapsed: g.classList.contains('is-collapsed'),
    button: btn ? getComputedStyle(btn).display !== 'none' : false,
    expanded: btn ? btn.getAttribute('aria-expanded') : null,
    controls: btn ? btn.getAttribute('aria-controls') : null,
    label: btn ? btn.textContent.trim() : null,
    screens: +(g.getBoundingClientRect().height / window.innerHeight).toFixed(1),
  };
}"""


def open_at(browser, width, js=True):
    ctx = browser.new_context(viewport={"width": width, "height": 900}, java_script_enabled=js)
    page = ctx.new_page()
    page.goto(INDEX, wait_until="domcontentloaded")
    if js:
        page.wait_for_selector(".dpo-tile", timeout=15000)
        page.wait_for_timeout(900)
    return ctx, page


def main():
    print("Блок программ на лендинге")
    server = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            # Телефон: свёрнуто, кнопка на месте.
            ctx, page = open_at(browser, 375)
            s = page.evaluate(STATE)
            check("на телефоне видны первые шесть карточек",
                  s["visible"] == VISIBLE_ON_PHONE, f"видно {s['visible']} из {s['total']}")
            check("на телефоне показана кнопка «Показать ещё»", s["button"])
            check("кнопка объявляет своё состояние", s["expanded"] == "false", str(s["expanded"]))
            # aria-controls намеренно нет: js/nav-menu.js ловит любой элемент с
            # парой [aria-controls][aria-expanded] как триггер выпадающего меню
            # и сбрасывает состояние. Подробности – в комментарии js/show-more.js.
            check("aria-controls не выставлен, иначе меню перехватит кнопку", not s["controls"], str(s["controls"]))
            check("блок укладывается в три экрана телефона", s["screens"] <= 3.2, f"{s['screens']} экрана")

            # Нажатие раскрывает и уводит фокус на первую открывшуюся карточку.
            page.click(".dpo-top5-more")
            page.wait_for_timeout(200)
            after = page.evaluate(STATE)
            focus_ok = page.evaluate(
                "() => document.activeElement === document.querySelector('.dpo-top5-grid').children[6]"
            )
            check("нажатие раскрывает все карточки", after["visible"] == after["total"],
                  f"{after['visible']} из {after['total']}")
            check("после раскрытия кнопка остаётся, чтобы можно было свернуть", after["button"])
            check("после раскрытия состояние объявлено", after["expanded"] == "true")
            check("подпись кнопки меняется на «Свернуть»", after["label"] == "Свернуть", after["label"])
            check("фокус уходит на первую раскрытую карточку", focus_ok)

            page.click(".dpo-top5-more")
            page.wait_for_timeout(200)
            back = page.evaluate(STATE)
            check("повторное нажатие сворачивает обратно",
                  back["visible"] == VISIBLE_ON_PHONE and back["expanded"] == "false"
                  and back["label"] == "Показать ещё",
                  json.dumps(back, ensure_ascii=False))
            ctx.close()

            # От двух колонок и выше свёртки нет.
            for width in (600, 900, 1280, 1440):
                ctx, page = open_at(browser, width)
                s = page.evaluate(STATE)
                check(f"на {width}px показаны все карточки без кнопки",
                      s["visible"] == s["total"] and not s["button"] and not s["collapsed"],
                      json.dumps(s, ensure_ascii=False))
                ctx.close()

            # Без JavaScript прятать нечего: лендинг отдаёт фолбэк <noscript>
            # со всеми программами, и никакая свёртка к нему не применяется.
            ctx, page = open_at(browser, 375, js=False)
            html = page.content()
            check("без JavaScript в фолбэке есть ссылки на программы",
                  html.count('href="programs/') >= 20,
                  f"ссылок {html.count('href=\"programs/')}")
            # Ищем ЭЛЕМЕНТ, а не строку: текст шаблона бандла лежит в body
            # как содержимое <script> и содержит разметку кнопки.
            check("без JavaScript кнопки свёртки в документе нет",
                  not page.evaluate("() => !!document.querySelector('.dpo-top5-more')"))
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
    print("Блок программ: все проверки пройдены")


if __name__ == "__main__":
    main()
