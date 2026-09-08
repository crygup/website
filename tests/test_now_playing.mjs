import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

test('song metadata stays text and cover failures use an attached handler', () => {
  const source = readFileSync(new URL('../src/script.js', import.meta.url), 'utf8');
  const renderer = source.slice(source.indexOf('function renderNowPlaying('), source.indexOf('async function fetchSpotifyCover('));
  const placeholder = { style: {} };
  const section = { classList: { remove() {} }, querySelector: () => placeholder, prepend(image) { this.image = image; } };
  const calls = [];
  const context = {
    npSection: section,
    document: { createElement: () => ({ style: {}, addEventListener(name, callback) { this[name] = callback; } }) },
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    formatCount: String, timeAgo: () => '', fetchSpotifyCover: (...args) => calls.push(args),
  };
  runInNewContext(renderer, context);
  const payload = '><img src=data:, onerror=window.injected=1>';
  context.renderNowPlaying({ playing: true, name: payload, artist: payload, cover: 'broken" onerror="attack()' }, null, 0);
  assert.ok(!section.innerHTML.includes('<img'));
  assert.ok(!section.innerHTML.includes('broken"'));
  assert.equal(section.image.alt, payload);
  assert.equal(section.image.src, 'broken" onerror="attack()');
  section.image.error();
  assert.equal(section.image.style.display, 'none');
  assert.equal(placeholder.style.display, '');
  assert.deepEqual(calls, [[payload, payload]]);
});
