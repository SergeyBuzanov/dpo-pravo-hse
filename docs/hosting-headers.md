# Заголовки, которые нужно включить на хостинге

Часть защит страница о себе выставить не может: директива `frame-ancestors`
игнорируется в `<meta http-equiv>` по спецификации CSP, а `X-Frame-Options`
существует только как HTTP-заголовок. Поэтому без настройки на стороне
хостинга защиты от кликджекинга у сайта нет вообще — сколько бы CSP ни стояло
в `<head>`.

## Если сайт разворачивается нашим docker-compose

Всё уже настроено: `docker/nginx.conf` выставляет заголовки на уровне `server`,
они наследуются всеми `location`. Ничего делать не нужно, кроме HSTS — он
намеренно закомментирован до появления TLS (см. ниже).

## Если хостинг чужой

Ниже — минимум, который нужно воспроизвести.

| Заголовок | Значение | Зачем |
|---|---|---|
| `X-Frame-Options` | `DENY` | запрет встраивания в чужой iframe (кликджекинг) |
| `Content-Security-Policy` | `frame-ancestors 'none'` | то же самое, современный вариант; понимают браузеры, игнорирующие X-Frame-Options |
| `X-Content-Type-Options` | `nosniff` | запрет угадывания MIME-типа |
| `Referrer-Policy` | `no-referrer` | адрес страницы не утекает на внешние сайты |
| `Strict-Transport-Security` | `max-age=31536000` | только HTTPS |

Оба заголовка про фреймы задаются вместе намеренно: `X-Frame-Options` — не
стандарт, но его понимают старые браузеры, а `frame-ancestors` — стандарт, но
его нет в самых старых. Сайт не использует iframe ни на одной странице, поэтому
запрет полный (`DENY`/`'none'`), а не `SAMEORIGIN`.

### nginx

```nginx
add_header X-Frame-Options "DENY" always;
add_header Content-Security-Policy "frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
# Включать только после того, как TLS работает: браузер запомнит https для
# домена, и при неготовом сертификате сайт станет недоступен.
# add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# Шрифты и картинки кешируются надолго, HTML — нет: каталог обновляется.
location ~* \.(woff2|jpg|png|webp|svg|ico)$ { add_header Cache-Control "public, max-age=31536000, immutable"; }
location ~* \.html$                         { add_header Cache-Control "no-cache"; }
```

Важно про nginx: `add_header` внутри `location` **отменяет** все заголовки,
унаследованные с уровня `server`, а не дополняет их. Если добавляете
`Cache-Control` в отдельный `location`, продублируйте там и заголовки
безопасности — иначе именно на этих файлах они молча исчезнут.

### Apache (.htaccess)

```apache
Header always set X-Frame-Options "DENY"
Header always set Content-Security-Policy "frame-ancestors 'none'"
Header always set X-Content-Type-Options "nosniff"
Header always set Referrer-Policy "no-referrer"
# Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
```

## Проверка после публикации

```bash
curl -sI https://ВАШ-ДОМЕН/ | grep -i "x-frame\|content-security\|referrer\|nosniff"
```

Должны присутствовать все четыре (HSTS — после включения TLS). Проверять нужно
не только главную: заголовки часто теряются на страницах, которые отдаются
отдельным правилом — у нас это `/catalog`, `/privacy`, `/alumni`.

## Чего заголовки не заменяют

Защита от DDoS и ботов уровня сети (WAF, Cloudflare, DDoS-Guard, средства
хостера) включается отдельно. Заголовки — это про поведение браузера у
посетителя, а не про доступность сайта под нагрузкой.
