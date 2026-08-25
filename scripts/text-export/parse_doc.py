# -*- coding: utf-8 -*-
"""Разбор выгрузки текстов в структуру страницы → разделы → пары [Тип]+текст."""
import json, sys
import docx
from docx.shared import Pt

SRC = '/Users/buzanovsergey/Desktop/Тексты сайта ДПО – правятся руками – 25.08.2026.docx'

def size_pt(p):
    for r in p.runs:
        if r.font.size:
            return r.font.size.pt
    return None

def is_bold(p):
    return any(r.bold for r in p.runs)

def is_italic(p):
    return any(r.italic for r in p.runs)

d = docx.Document(SRC)
paras = d.paragraphs

doc = {'title': None, 'subtitle': None, 'pages': []}
page = None
section = None
pending_type = None

for i, p in enumerate(paras):
    t = p.text.strip()
    sz = size_pt(p)
    if not t:
        continue
    if sz == 24 and is_bold(p):
        doc['title'] = t; continue
    if sz == 16 and doc['subtitle'] is None:
        doc['subtitle'] = t; continue
    if sz == 20 and is_bold(p):
        page = {'name': t, 'note': None, 'sections': []}
        doc['pages'].append(page); section = None; continue
    if sz == 12 and is_italic(p) and section is None:
        # подпись под названием страницы (заголовок вкладки и т.п.)
        if page: page['note'] = ((page['note'] + '\n') if page['note'] else '') + t
        continue
    if sz == 15 and is_bold(p):
        section = {'name': t, 'note': None, 'items': []}
        page['sections'].append(section); pending_type = None; continue
    if sz == 11 and is_italic(p):
        if section is None and page is not None:
            page['note'] = ((page['note'] + '\n') if page['note'] else '') + t
            continue
        if t.startswith('[') and t.endswith(']'):
            pending_type = t[1:-1]
        else:
            section['note'] = ((section['note'] + '\n') if section['note'] else '') + t
        continue
    if sz == 12 and is_italic(p):
        if section is not None:
            section['note'] = ((section['note'] + '\n') if section['note'] else '') + t
        elif page is not None:
            page['note'] = ((page['note'] + '\n') if page['note'] else '') + t
        continue
    # обычный текст
    if section is None:
        # текст до первого раздела — заводим служебный
        if page is None: continue
        section = {'name': '', 'note': None, 'items': []}
        page['sections'].append(section)
    section['items'].append({'type': pending_type or 'Текст', 'text': p.text})
    pending_type = None

json.dump(doc, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)
n_items = sum(len(s['items']) for pg in doc['pages'] for s in pg['sections'])
print('title:', doc['title'])
print('subtitle:', doc['subtitle'])
print('страниц:', len(doc['pages']), 'блоков:', n_items)
for pg in doc['pages']:
    print('==', pg['name'], '| note:', (pg['note'] or '')[:70].replace('\n',' / '))
    for s in pg['sections']:
        print('   -', repr(s['name']), len(s['items']), 'шт', ('| ' + s['note'][:50].replace('\n',' ')) if s['note'] else '')
