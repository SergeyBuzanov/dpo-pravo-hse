#!/usr/bin/env bash
# Прогон смоук-теста сайта Центра ДПО (Playwright, headless Chromium).
# Самодостаточный: при первом запуске создаёт локальное окружение через uv
# и ставит Playwright + Chromium. Повторные запуски — сразу к тесту.
#
#   tests/run.sh
#
# Требуется: uv (https://docs.astral.sh/uv/). Node/npm НЕ нужны — сервер
# поднимается штатным python -m http.server.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VENV=".venv-tests"

if [ ! -d "$VENV" ]; then
  echo "→ создаю окружение $VENV"
  uv venv "$VENV" -q
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

if ! python -c "import playwright" 2>/dev/null; then
  echo "→ ставлю playwright"
  uv pip install -q playwright
fi
if ! python -c "from playwright.sync_api import sync_playwright as s; b=s().start().chromium.launch(headless=True); b.close()" 2>/dev/null; then
  echo "→ ставлю Chromium для Playwright"
  python -m playwright install chromium
fi

# Юнит-тесты (Node, без зависимостей). Маска *.test.js обязательна:
# голый путь к каталогу раннер Node не принимает.
echo "→ юнит-тесты"
node --test "tests/unit/"*.test.js

echo "→ смоук-тест (Playwright)"
python tests/smoke_test.py
echo ""
echo "→ ротация девизов первого экрана (Playwright)"
python tests/slogan_test.py

echo ""
echo "→ security_test.py (admin + static-server allowlist)"
python tests/security_test.py
