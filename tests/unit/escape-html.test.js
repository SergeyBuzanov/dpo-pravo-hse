const test = require('node:test');
const assert = require('node:assert');
const { escapeHtml } = require('../../update-catalog');

test('спецсимволы HTML экранируются', () => {
  assert.strictEqual(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
});

test('апостроф экранируется', () => {
  // Атрибуты в шаблонах сейчас все в двойных кавычках, поэтому апостроф
  // «безопасен» только по договорённости: одна правка с одинарными кавычками —
  // и незаэкранированный апостроф из названия программы закрывает атрибут.
  assert.strictEqual(escapeHtml("Практика ФАС: дело 'Роснефть'"), 'Практика ФАС: дело &#39;Роснефть&#39;');
});

test('амперсанд экранируется первым и не портит уже вставленные сущности', () => {
  assert.strictEqual(escapeHtml('A & <B>'), 'A &amp; &lt;B&gt;');
});
