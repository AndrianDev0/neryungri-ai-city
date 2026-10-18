const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../static/connection.js'), 'utf8');

function client(statuses = [200]) {
  const calls = [];
  const context = {
    Headers,
    CITY_CONFIG: {apiBase: 'https://city.example'},
    sessionStorage: {getItem: () => 'owner-code', removeItem() {}, setItem() {}},
    prompt: () => 'replacement-code',
    fetch: async (url, options) => {
      calls.push({url, headers: new Headers(options.headers)});
      const status = statuses.shift() || 200;
      return {status, ok: status === 200};
    },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {request: context.cityFetch, calls};
}

test('public reads remain simple CORS requests even after owner login', async () => {
  const {request, calls} = client();
  await request('/api/meta');
  assert.equal(calls[0].url, 'https://city.example/api/meta');
  assert.equal(calls[0].headers.has('Content-Type'), false);
  assert.equal(calls[0].headers.has('Authorization'), false);
});

test('writes keep JSON and owner authentication, including retry', async () => {
  const {request, calls} = client([401, 200]);
  await request('/api/reports', {method: 'POST', body: '{"text":"test"}'});
  assert.equal(calls[0].headers.get('Content-Type'), 'application/json');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer owner-code');
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer replacement-code');
});
