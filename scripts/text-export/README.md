# Выгрузка текстов сайта в .docx со снимками разделов

Не подключено к сборке сайта и не запускается тестами: это инструмент
для разговора с заказчиком, а не часть страницы.

## Порядок запуска

```bash
npm run serve                                  # превью-сайта на 5180
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 --no-first-run --disable-gpu \
  --hide-scrollbars --user-data-dir=/tmp/cdp-shots --window-size=1440,900 about:blank &

# страница 404 отдаётся отдельным сервером: в его корне символьная ссылка на репозиторий
mkdir -p /tmp/site404 && ln -sfn ~/dpo-pravo-hse /tmp/site404/dpo-pravo-hse
cp ~/dpo-pravo-hse/404.html /tmp/site404/404page.html
(cd /tmp/site404 && python3 -m http.server 5181 --bind 127.0.0.1 &)

python3 parse_doc.py doc.json      # прошлый .docx -> структура (тексты = канон)
node shots.js                      # снимки разделов -> shots/ + manifest.json
python3 build_doc.py               # готовый .docx на рабочий стол
```

Рабочие каталоги (`shots/`, `jpg/`, `doc.json`) создаются рядом со скриптами и
в git не идут. Зашиты два абсолютных пути – исходный .docx в `parse_doc.py`
и готовый файл в `OUT` у `build_doc.py`; при смене даты их правят руками.

## Что стоило времени

- **Страница 404 не отдаётся превью-сервером** (белый список `lib/static-http.js`).
  Её ссылки абсолютные, с префиксом `/dpo-pravo-hse/`, поэтому она снимается
  через отдельный `python3 -m http.server`, в корне которого лежит символьная
  ссылка `dpo-pravo-hse` на репозиторий.
- **Приклеенные к экрану элементы** (`#cookieBanner`, `.dpo-mobile-cta`) нельзя
  снимать в координатах документа с `captureBeyondViewport`. Для них берутся
  координаты ОКНА и `captureBeyondViewport: false`.
- **Баннер cookies прячется стилем-заглушкой** на время съёмки остальных
  разделов. Заглушку надо снимать до замера И держать снятой до самого снимка –
  иначе снимок делается с уже спрятанным баннером, а кадр выглядит правдоподобно.
- **Порядок детей `<w:tblPr>` задан схемой OOXML.** `tblW` до `tblBorders`,
  `tblBorders` до `tblLayout`. Приписывание через `append` даёт Word
  «нечитаемое содержимое», причём python-docx сохраняет файл молча.
- **`table.autofit = False` уже ставит `tblLayout`.** Второй такой элемент –
  тот же дефект.
- Разделы выше 1050 px режутся на полосы: на листе A4 целиком они нечитаемы.

## Проверка вёрстки без LibreOffice

`PREVIEW=1 PV_PAGE=1 PV_SEC=3:6 OUT_DOCX=pv.docx python3 build_doc.py` собирает
укороченный файл без памятки, а `qlmanage -t -s 1500 -o . pv.docx` рисует его
первый лист. QuickLook считает ширину таблиц по содержимому, поэтому
фиксированные ширины проверять по `word/document.xml`, а не по картинке.
