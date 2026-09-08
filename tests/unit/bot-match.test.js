'use strict';

/**
 * Подбор программ. Проверяется поведение, а не текст файла: это
 * единственная часть бота, где ошибка не видна глазом – список просто
 * окажется не тем.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { stem, sameStem, parseQuery, search } = require('../../js/bot-match');

const PROGRAMS = [
  {
    id: '1', title: 'Актуальные вопросы налогового администрирования',
    sphere: 'Финансовое право', type: 'ПК', format: 'online',
    price: 22000, start: 'Старт: 5 октября', keywords: ['Налоговые споры', 'Юристы'],
  },
  {
    id: '2', title: 'Английское контрактное право',
    sphere: 'Международное право', type: 'ПК', format: 'offline',
    price: 60000, start: null, keywords: ['Договорная работа', 'Юристы'],
  },
  {
    id: '3', title: 'Банкротство юридических лиц',
    sphere: 'Корпоративное и договорное право', type: 'ПП', format: 'mixed',
    price: 45000, start: 'Старт: 1 ноября', keywords: ['Несостоятельность', 'Предприниматели'],
  },
];

test('основа слова сводит словоформы к одной', () => {
  const base = stem('налоги');
  assert.equal(stem('налоговый').startsWith(base) || base.startsWith(stem('налоговый')), true);
  assert.equal(stem('налогообложение').startsWith(base), true);
});

test('основа не склеивает разные слова', () => {
  assert.notEqual(stem('право'), stem('практика'));
});

test('слово из названия находит программу', () => {
  const out = search('банкротство', PROGRAMS);
  assert.equal(out.reason, 'title');
  assert.deepEqual(out.programs.map((p) => p.id), ['3']);
});

test('слово из ключевых слов находит программу', () => {
  const out = search('несостоятельность', PROGRAMS);
  assert.equal(out.reason, 'keywords');
  assert.deepEqual(out.programs.map((p) => p.id), ['3']);
});

test('цена и формат читаются как ограничение', () => {
  const q = parseQuery('онлайн дешевле 30 тысяч');
  assert.equal(q.priceMax, 30000);
  assert.equal(q.format, 'online');
  const out = search('онлайн дешевле 30 тысяч', PROGRAMS);
  assert.equal(out.reason, 'filter');
  assert.deepEqual(out.programs.map((p) => p.id), ['1']);
});

test('пустой запрос возвращает подсказки, а не пустоту', () => {
  const out = search('   ', PROGRAMS);
  assert.equal(out.reason, 'empty');
  assert.deepEqual(out.programs, []);
});

test('несуществующее слово даёт «не нашёл» и программы с ближайшим стартом', () => {
  const out = search('криптовалюта', PROGRAMS);
  assert.equal(out.reason, 'none');
  assert.equal(out.programs.length, 3);
  // Сперва те, у кого старт назначен: программа без старта уходит вниз.
  assert.equal(out.programs[0].id, '1');
  assert.equal(out.programs[2].id, '2');
});

test('порядок выдачи устойчив: совпадение в названии выше совпадения в словах', () => {
  const out = search('юристы налоговых', PROGRAMS);
  assert.equal(out.programs[0].id, '1');
});

// --- Регрессии по находкам ревью 2026-09-08 ---

test('CRITICAL 1: совпадение в названии всегда выше совпадения в keywords, даже при меньшей сумме очков', () => {
  const progs = [
    { id: 'a', title: 'Налоговые споры', keywords: [] },
    { id: 'b', title: 'Общий курс', keywords: ['Налоговое администрирование', 'Право'] },
  ];
  const out = search('налоговое право', progs);
  assert.equal(out.programs[0].id, 'a');
});

test('CRITICAL 2: «не дороже N» задаёт верхнюю границу цены, а не нижнюю', () => {
  const q = parseQuery('не дороже 40000');
  assert.equal(q.priceMax, 40000);
  assert.equal(q.priceMin, null);
  const out = search('не дороже 40000', PROGRAMS);
  assert.equal(out.reason, 'filter');
  assert.deepEqual(out.programs.map((p) => p.id), ['1']);
});

test('IMPORTANT 3: «право» и «правка» не считаются одним словом', () => {
  assert.notEqual(stem('право'), stem('правка'));
  const progs = [{ id: 'x', title: 'Международное право', keywords: [] }];
  const out = search('правка документа', progs);
  assert.equal(out.reason, 'none');
});

test('IMPORTANT 4: цена «за N» распознаётся, запрос не считается пустым', () => {
  const q = parseQuery('за 100000');
  assert.equal(q.priceMax, 100000);
  const out = search('за 100000', PROGRAMS);
  assert.notEqual(out.reason, 'empty');
});

test('IMPORTANT 5: ограничение без сужения выдачи – всё равно «filter», а не «none»', () => {
  // priceMax=100000 не отсекает ни одну из трёх программ (макс. цена – 60000),
  // а слово «космонавтика» не совпадает ни с одним названием/keywords/сферой.
  const out = search('дешевле 100 тысяч космонавтика', PROGRAMS);
  assert.equal(out.reason, 'filter');
});

// --- Регрессия по повторному ревью 2026-09-08 ---

test('IMPORTANT (повтор): падежные формы «право» продолжают находить программу после ужесточения sameStem', () => {
  const progs = [{ id: 'p', title: 'Международное право', keywords: [] }];
  for (const form of ['право', 'права', 'правом', 'праву', 'правами']) {
    const out = search(form, progs);
    assert.equal(out.reason, 'title', `форма «${form}» не нашла программу`);
    assert.deepEqual(out.programs.map((x) => x.id), ['p'], `форма «${form}»`);
  }
});

test('IMPORTANT (повтор): «право» и «правовой» – одна основа при поиске', () => {
  const progs = [{ id: 'p', title: 'Правовое регулирование цифровой экономики', keywords: [] }];
  const out = search('право', progs);
  assert.equal(out.reason, 'title');
});

test('IMPORTANT (повтор): «суд» и «судно» по-прежнему не путаются', () => {
  const progs = [{ id: 's', title: 'Морское право: страхование судна', keywords: [] }];
  const out = search('суд', progs);
  assert.equal(out.reason, 'none');
});

// --- Финальное ревью 2026-09-08: C1, I1, I2, I3, I5, M2, I4 ---

test('FINAL C1: слово формата убирается из stems – filter не подменяется частичным keywords-совпадением внутри своего же формата', () => {
  // Обе программы формата online (обе проходят фильтр по формату). У «b»
  // «онлайн» случайно затесалось в keywords (архив записей выкладывают
  // онлайн). Раньше оставшееся в stems слово «онлайн» давало «b» очки по
  // keywords, ветка scored срабатывала раньше filter, и в выдаче
  // оставалась только «b» – «a» (тоже online, но без слова в keywords)
  // терялась. После фикса stems пустые, очков нет ни у кого, и filter
  // возвращает ОБЕ online-программы.
  const progs = [
    { id: 'a', title: 'Курс права', format: 'online', keywords: [] },
    { id: 'b', title: 'Курс права', format: 'online', keywords: ['онлайн-архив записей курса'] },
  ];
  const out = search('онлайн', progs);
  assert.equal(out.reason, 'filter');
  assert.deepEqual(out.programs.map((p) => p.id).sort(), ['a', 'b']);
});

test('FINAL C1: «смешанный формат» тоже отдаёт весь filter, а не одну программу со случайным keywords-совпадением', () => {
  const progs = [
    { id: 'a', title: 'Курс права', format: 'mixed', keywords: [] },
    { id: 'b', title: 'Курс права', format: 'mixed', keywords: ['смешанного типа задачи'] },
  ];
  const out = search('смешанный формат', progs);
  assert.equal(out.reason, 'filter');
  assert.deepEqual(out.programs.map((p) => p.id).sort(), ['a', 'b']);
});

test('FINAL I1: «пп» и «пк» распознаются только отдельным словом, а не частью другого слова', () => {
  assert.equal(parseQuery('пп').type, 'ПП');
  assert.equal(parseQuery('хочу пп по праву').type, 'ПП');
  assert.equal(parseQuery('пк').type, 'ПК');
  assert.equal(parseQuery('нужна пк по финансам').type, 'ПК');
  // «группа» содержит «пп» на стыке слога, «скрипка» содержит «пк» – это не
  // сокращения типа программы, отдельным словом «пп»/«пк» здесь не стоит.
  assert.equal(parseQuery('группа поддержки').type, null);
  assert.equal(parseQuery('играю на скрипке').type, null);
});

test('FINAL I1: отбор по типу ПП/ПК реально фильтрует программы', () => {
  const progs = [
    { id: 'pp', title: 'Курс', type: 'ПП', keywords: [] },
    { id: 'pk', title: 'Курс', type: 'ПК', keywords: [] },
  ];
  const out = search('пп', progs);
  assert.equal(out.reason, 'filter');
  assert.deepEqual(out.programs.map((p) => p.id), ['pp']);
});

test('FINAL I2: срок не путается с ценой – «за 3 месяца», «до 3 месяцев», «до 30»', () => {
  assert.equal(parseQuery('программа за 3 месяца').priceMax, null);
  assert.equal(parseQuery('до 3 месяцев').priceMax, null);
  // Меньше тысячи и без «тыс/руб/₽» – не похоже на цену программы ДПО.
  assert.equal(parseQuery('до 30').priceMax, null);
  // Крупное число без единиц по-прежнему цена – иначе сломается IMPORTANT 4.
  assert.equal(parseQuery('до 30000').priceMax, 30000);
  // Маленькое число с явной денежной единицей – тоже цена.
  assert.equal(parseQuery('до 500 рублей').priceMax, 500);
  const out = search('программа за 3 месяца', [{ id: 'x', title: 'Курс', keywords: [] }]);
  assert.notEqual(out.reason, 'filter');
});

test('FINAL I2: «до 5 лет» тоже срок, а не цена, но «летний» словом о сроке не считается', () => {
  assert.equal(parseQuery('до 5 лет').priceMax, null);
  // Регрессия на \b-баг из I1: «лет\b» не матчился на кириллице вовсе, из-за
  // чего срок в годах не отличался бы от цены. Заодно проверяем, что явная
  // граница не переусердствовала и не режет «летний» как «лет».
  const q = parseQuery('до 5000 летний интенсив');
  assert.equal(q.priceMax, 5000);
  // Регрессия повторного ревью 2026-09-08 (CRITICAL): группа числа в
  // ценовом регэкспе была жадной к хвостовому пробелу, поэтому
  // consumeWord стирал не только число, но и следующее слово целиком –
  // здесь ценой распознаётся именно «5000» (число не отвергнуто как срок,
  // «летний» под DURATION_TAIL_RE не подходит), и слово «летний» должно
  // устоять как содержательный stem вместе с «интенсив».
  assert.deepEqual(q.stems, [stem('летний'), stem('интенсив')]);
});

// --- Регрессии повторного ревью 2026-09-08: CRITICAL + MINOR того же места ---

test('FINAL CRITICAL: жадная граница числа не стирает следующее слово – тема вопроса уцелевает вместе с ценой', () => {
  // Раньше (\d[\d\s]*) захватывал хвостовой пробел после числа, из-за
  // чего consumeWord(remaining, price.index, price[0].length) раздвигал
  // границу уже ВНУТРИ следующего слова и стирал его целиком – ровно тогда,
  // когда после числа нет денежной единицы («до 100000 банкротство»).
  let q = parseQuery('до 100000 банкротство');
  assert.equal(q.priceMax, 100000);
  assert.deepEqual(q.stems, [stem('банкротство')]);

  q = parseQuery('за 100000 налоги');
  assert.equal(q.priceMax, 100000);
  assert.deepEqual(q.stems, [stem('налоги')]);

  q = parseQuery('до 50000 онлайн');
  assert.equal(q.priceMax, 50000);
  assert.equal(q.format, 'online');

  q = parseQuery('до 50000 пп');
  assert.equal(q.priceMax, 50000);
  assert.equal(q.type, 'ПП');
});

test('FINAL CRITICAL: на настоящих данных цена больше не проглатывает тему/формат/тип', () => {
  const ROOT = path.resolve(__dirname, '..', '..');
  const programs = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'bot-catalog.json'), 'utf8')).programs;

  const bankrupt = search('до 100000 банкротство', programs);
  assert.equal(bankrupt.reason, 'title');
  assert.ok(bankrupt.programs.length > 0);
  // Первая (высший тир – совпадение в названии) обязана быть про банкротство;
  // дальше в списке могут идти и другие программы дешевле 100000 – reason
  // зависит от ТОП-совпадения, не от всех элементов списка.
  assert.ok(bankrupt.programs[0].title.toLowerCase().includes('банкротств'));

  const tax = search('за 100000 налоги', programs);
  assert.equal(tax.reason, 'title');
  assert.ok(tax.programs.length > 0);

  const online = search('до 50000 онлайн', programs);
  assert.equal(online.reason, 'filter');
  assert.ok(online.programs.length > 0);
  assert.ok(online.programs.every((p) => p.format === 'online' && typeof p.price === 'number' && p.price <= 50000));

  // Реальные цены ПП на этом каталоге – 130000/180000/390000: порога
  // «до 50000» на живых данных не пережил бы ни один (тип потерялся бы не
  // из-за бага, а из-за честно пустого фильтра) – берём порог, при котором
  // хотя бы одна ПП-программа есть, но не все три.
  const pp = search('до 200000 пп', programs);
  assert.equal(pp.reason, 'filter');
  assert.ok(pp.programs.length > 0);
  assert.ok(pp.programs.every((p) => p.type === 'ПП' && typeof p.price === 'number' && p.price <= 200000));
});

test('FINAL MINOR: предлог «за» ловится только отдельным словом – «виза 5000» не режется на цену', () => {
  // «за» – подстрока внутри «виза» (ви-за). Без границы слова regex цены
  // находил «за 5000» прямо внутри «виза 5000», и consumeWord стирал
  // «виза» целиком вместе с ложной ценой.
  const q = parseQuery('виза 5000');
  assert.equal(q.priceMax, null);
  assert.equal(q.priceMin, null);
  assert.deepEqual(q.stems, [stem('виза')]);
});

test('FINAL MINOR: стоп-список сверяется тем же sameStem, что и совпадение с программой', () => {
  // «документальный» – не стоп-слово буквально, но его основа
  // («документальн») – это то же слово, что и «документ» по правилу
  // sameStem (общий префикс, разница длин 4 – проходит порог), тем самым
  // правилом, каким hits() сверяет запрос с программами. Раньше
  // стоп-список проверял точное равенство основ (STOP_STEMS.indexOf) и
  // такую форму пропускал как содержательное слово.
  assert.equal(sameStem(stem('документальный'), stem('документ')), true);
  const q = parseQuery('документальный сериал');
  assert.equal(q.stems.indexOf(stem('документальный')), -1);
  assert.deepEqual(q.stems, [stem('сериал')]);
});

test('FINAL I3: общие слова («документ», «старт», «подобрать», «программу», «стоит») не дают очков сами по себе', () => {
  const progs = [{
    id: 'irrelevant',
    title: 'Курс без отношения к вопросу',
    keywords: ['документ об образовании', 'следующий набор стартует скоро', 'подобрать индивидуальную программу'],
  }];
  assert.notEqual(search('какой документ выдают', progs).reason, 'keywords');
  assert.notEqual(search('ближайшие старты', progs).reason, 'keywords');
  // Оба слова запроса – стоп-слова целиком: реплика ищущего смысла не несёт,
  // это честная «empty», а не случайные 3 программы.
  assert.equal(search('подобрать программу', progs).reason, 'empty');
});

test('FINAL I3: содержательные слова по-прежнему находят программы', () => {
  const progs = [
    { id: 'tax', title: 'Налоговое право', keywords: [] },
    { id: 'bankrupt', title: 'Банкротство физических лиц', keywords: [] },
  ];
  assert.equal(search('налоги', progs).reason, 'title');
  assert.equal(search('банкротство', progs).reason, 'title');
});

test('FINAL I5: без словесных совпадений выдача сортируется по реальной дате старта, а не только «есть/нет»', () => {
  const progs = [
    { id: 'late', title: 'Курс', keywords: [], start: 'Старт: 1 ноября', startIso: '2026-11-01' },
    { id: 'early', title: 'Курс', keywords: [], start: 'Старт: 5 октября', startIso: '2026-10-05' },
    { id: 'none', title: 'Курс', keywords: [] },
  ];
  const out = search('несуществующее слово чепуха', progs);
  assert.deepEqual(out.programs.map((p) => p.id), ['early', 'late', 'none']);
});

test('FINAL I5: старая форма данных без startIso (только start) не ломается – так же уходит в конец без даты', () => {
  const progs = [
    { id: 'has', title: 'Курс', keywords: [], start: 'Старт: 5 октября' },
    { id: 'none', title: 'Курс', keywords: [] },
  ];
  const out = search('несуществующее слово чепуха', progs);
  assert.deepEqual(out.programs.map((p) => p.id), ['has', 'none']);
});

test('FINAL M2: sameStem экспортирован наружу – будущему поиску по FAQ понадобится то же правило сходства', () => {
  const mod = require('../../js/bot-match');
  assert.equal(typeof mod.sameStem, 'function');
  assert.equal(mod.sameStem(stem('право'), stem('правовой')), true);
  assert.equal(mod.sameStem(stem('право'), stem('правка')), false);
});

test('FINAL I4: браузерная UMD-ветка кладёт DpoBotMatch в глобальный объект без module.exports', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'bot-match.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  // Без объявленных module/exports в контексте фабрика UMD обязана уйти в
  // ветку «root.DpoBotMatch = factory()» – ровно так подключится файл
  // тегом <script> в браузере, без сборщика.
  vm.runInContext(src, sandbox, { filename: 'bot-match.js' });
  assert.equal(typeof sandbox.DpoBotMatch, 'object');
  assert.equal(typeof sandbox.DpoBotMatch.search, 'function');
  assert.equal(typeof sandbox.DpoBotMatch.parseQuery, 'function');
  assert.equal(typeof sandbox.DpoBotMatch.stem, 'function');
});

test('FINAL I4: на настоящем content/bot-catalog.json пять кнопок-подсказок бота ведут себя осмысленно', () => {
  const ROOT = path.resolve(__dirname, '..', '..');
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'bot-catalog.json'), 'utf8'));
  const programs = catalog.programs;
  const onlineCount = programs.filter((p) => p.format === 'online').length;
  const mixedCount = programs.filter((p) => p.format === 'mixed').length;
  assert.ok(onlineCount > 0 && mixedCount > 0, 'в каталоге должны быть и online, и mixed программы для проверки');

  // «Онлайн» отбирает ВСЕ программы формата online и НИ ОДНОЙ другой.
  const online = search('Онлайн', programs);
  assert.equal(online.reason, 'filter');
  assert.equal(online.programs.length, onlineCount);
  assert.ok(online.programs.every((p) => p.format === 'online'));

  // «Сколько стоит» не должно выдавать случайное совпадение по названию
  // или keywords (стоп-слово «стоит» не даёт очков само по себе).
  const price = search('Сколько стоит', programs);
  assert.notEqual(price.reason, 'title');
  assert.notEqual(price.reason, 'keywords');

  // «Какой документ выдают» и «Ближайшие старты» – это вопросы про FAQ, а
  // не про подбор программы: reason обязан быть 'none' или 'empty', чтобы
  // виджет мог уйти в готовые ответы (иначе бот покажет случайные программы
  // вместо ответа про диплом/расписание).
  const doc = search('Какой документ выдают', programs);
  assert.ok(doc.reason === 'none' || doc.reason === 'empty', `reason=${doc.reason}`);
  const starts = search('Ближайшие старты', programs);
  assert.ok(starts.reason === 'none' || starts.reason === 'empty', `reason=${starts.reason}`);

  // «Подобрать программу» – оба слова стоп-словные, это приглашение к
  // разговору, а не запрос: пустая выдача, а не случайные 3 программы.
  const pick = search('Подобрать программу', programs);
  assert.equal(pick.reason, 'empty');

  // Живые запросы по смыслу по-прежнему находят программы.
  for (const word of ['налоги', 'банкротство', 'договор', 'права']) {
    const out = search(word, programs);
    assert.ok(out.programs.length > 0, `«${word}» не нашло ни одной программы`);
    assert.notEqual(out.reason, 'none', `«${word}» дало reason=none`);
    assert.notEqual(out.reason, 'empty', `«${word}» дало reason=empty`);
  }
});
