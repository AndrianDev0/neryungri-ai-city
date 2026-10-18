const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Run application functions without browser wiring; these are state tests, not visual checks.
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8')
  .split("document.addEventListener('click',event=>{")[0];

function harness() {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', textContent: '', innerHTML: '', hidden: false, open: true,
      dataset: {}, reportValidity: () => true,
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: {querySelector: node, querySelectorAll: () => []},
    window: {}, setTimeout, clearTimeout,
    mapReports: reports => reports, splitSuggestions: () => {},
  });
  vm.runInContext(source, context);
  vm.runInContext(`state.meta={today:'2026-10-18',priorities:{normal:'Обычный'}};`, context);
  return {node, context, run: code => vm.runInContext(code, context)};
}

function deferredApi(h) {
  let resolve, reject;
  h.context.pendingApi = () => new Promise((yes, no) => { resolve = yes; reject = no; });
  h.run('api=pendingApi');
  return {resolve: value => resolve(value), reject: error => reject(error)};
}

const analysis = {category:'lighting',category_label:'Освещение',priority:'normal',reasons:[],review_required:false};

test('a late analysis does not replace a changed report or manual category', async () => {
  for (const field of ['#new-text', '#new-category']) {
    const h = harness(), api = deferredApi(h);
    h.node('#new-text').value = 'Не работает фонарь';
    const pending = h.run('analyzeText()');
    h.node(field).value = field === '#new-text' ? 'На дороге большая яма' : 'roads';
    api.resolve(analysis);
    await pending;
    assert.notEqual(h.node('#new-category').value, 'lighting');
    assert.equal(h.node('#analysis-result').innerHTML, '');
    assert.equal(h.node('#analyze-button').disabled, false);
  }
});

test('closing the form ignores late analysis, while a current result is shown', async () => {
  for (const open of [false, true]) {
    const h = harness(), api = deferredApi(h);
    h.node('#new-text').value = 'Не работает фонарь';
    const pending = h.run('analyzeText()');
    h.node('#new-dialog').open = open;
    api.resolve(analysis);
    await pending;
    assert.equal(h.node('#new-category').value, open ? 'lighting' : '');
  }
});

test('loading a dataset removes old counts and markers and exposes a failed load', async () => {
  const h = harness(), api = deferredApi(h);
  let removed = 0;
  h.context.mapStub = {removeChild: () => removed++};
  h.run(`state.view='analytics';state.reports=[{id:1}];cityMap=mapStub;state.markers.set(1,{entity:{}});`);
  const pending = h.run('loadReports()');
  assert.equal(removed, 1);
  assert.equal(h.run('state.reports.length'), 0);
  assert.equal(h.node('#stat-total').textContent, '…');
  assert.match(h.node('#analytics-content').innerHTML, /Загружаем/);
  api.reject(new Error('Offline'));
  await pending;
  assert.equal(h.run('state.failed'), true);
  assert.match(h.node('#analytics-content').innerHTML, /Не удалось загрузить данные/);
});

test('analytics waits for reports instead of combining datasets', async () => {
  const h = harness();
  h.context.unexpectedApi = () => assert.fail('analytics fetched while reports were unavailable');
  h.run('api=unexpectedApi');
  await h.run('loadAnalytics()');
  assert.match(h.node('#analytics-content').innerHTML, /Загружаем/);
  h.run('state.loading=false;state.failed=true');
  await h.run('loadAnalytics()');
  assert.match(h.node('#analytics-content').innerHTML, /Не удалось загрузить данные/);
});

test('saving one card does not close another card opened while waiting', async () => {
  const h = harness(), api = deferredApi(h);
  const field = {disabled:false,isConnected:true};
  const submittedForm = {querySelectorAll: () => [field]};
  const drafts = new Map([[1,{status:'in_progress'}]]);
  let closed = false;
  h.node('#report-dialog').close = () => { closed = true; };
  h.context.detailDrafts = drafts;
  h.context.rememberDetail = () => {};
  h.context.eventStub = {preventDefault() {}, currentTarget:submittedForm};
  h.run('loadReports=async()=>{};showToast=()=>{}');
  const pending = h.run('saveDetail(eventStub,1)');
  assert.equal(field.disabled, true);
  // A new form for another card is now in the document.
  assert.notEqual(h.node('#detail-form'), submittedForm);
  api.resolve({id:1,status:'in_progress'});
  await pending;
  assert.equal(closed, false);
  assert.equal(field.disabled, false);
  assert.equal(drafts.has(1), false);
});

test('location picker opens at city center when only one coordinate is filled', async () => {
  const h = harness();
  h.context.window.addEventListener = () => {};
  h.node('#location-dialog').showModal = () => {};
  const locations = [];
  h.context.CityMaps = {
    ready: async () => {},
    create: () => ({onClick() {},setLocation: value => locations.push(value)}),
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/workflow.js'), 'utf8'),h.context);
  for (const values of [{lat:56.66,lon:null},{lat:null,lon:124.71}]) {
    h.context.coordinates = values;
    h.run('detailValues=()=>coordinates');
    await h.run('openEditLocation()');
    assert.deepEqual(Array.from(locations.at(-1).center),[124.715,56.662]);
    assert.equal(h.node('#edit-map-error').hidden, true);
  }
});
