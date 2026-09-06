import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

function helper() {
  const requests = [];
  const window = { fetch: async request => { requests.push(request); return request; } };
  runInNewContext(readFileSync(new URL('../src/session.js', import.meta.url), 'utf8'), {
    window, Request, Headers, URL, localStorage: { removeItem() {} },
  });
  return { api: window.FishieWeb, requests };
}

test('API requests preserve Request bodies and headers, strip bearer data, and include cookies', async () => {
  const { api, requests } = helper();
  await api.fetch(new Request('https://api.crygup.com/fishie/user/1/accounts', {
    method: 'POST', body: '{"steam":"1"}',
    headers: { Authorization: 'Bearer obsolete', 'Content-Type': 'application/json' },
  }));
  assert.equal(requests[0].method, 'POST');
  assert.equal(await requests[0].text(), '{"steam":"1"}');
  assert.equal(requests[0].headers.get('Content-Type'), 'application/json');
  assert.equal(requests[0].headers.has('Authorization'), false);
  assert.equal(requests[0].credentials, 'include');
});

test('avatar lookup uses the same authenticated session', async () => {
  const { api, requests } = helper();
  await api.fetch('https://api.crygup.com/avatars?q=1');
  assert.equal(requests[0].credentials, 'include');
});

test('unrelated origins retain their own credentials and headers', async () => {
  const { api, requests } = helper();
  await api.fetch('https://api.crygup.com.example.org/data', {
    credentials: 'omit', headers: { Authorization: 'Bearer other-service' },
  });
  assert.equal(requests[0].credentials, 'omit');
  assert.equal(requests[0].headers.get('Authorization'), 'Bearer other-service');
});
