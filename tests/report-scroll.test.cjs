const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/report-scroll.js'), 'utf8');

function setup(top, mobile = true) {
  const listeners = {};
  const list = {scrollTop: top, scrollHeight: 1200, clientHeight: 400,
    addEventListener: (type, callback) => {listeners[type] = callback;}};
  const page = {scrollTop: 500, scrollHeight: 2000, clientHeight: 700};
  vm.runInNewContext(source, {matchMedia: () => ({matches: mobile}), document: {
    querySelector: () => list, scrollingElement: page,
    addEventListener: (type, callback) => callback(),
  }});
  return {page, swipe(delta, x = 100, count = 1) {
    let prevented = false;
    listeners.touchstart({touches: [{clientX: 100, clientY: 200}]});
    listeners.touchmove({touches: Array.from({length: count}, () => ({clientX: x, clientY: 200 - delta})),
      cancelable: true, preventDefault: () => {prevented = true;}});
    return prevented;
  }};
}

test('swiping beyond either edge moves the document', () => {
  const bottom = setup(800);
  assert.equal(bottom.swipe(60), true);
  assert.equal(bottom.page.scrollTop, 560);
  const top = setup(0);
  assert.equal(top.swipe(-60), true);
  assert.equal(top.page.scrollTop, 440);
});
test('middle and inward swipes retain native list scrolling', () => {
  for (const [top, delta] of [[400, 60], [0, 60], [800, -60]]) {
    const state = setup(top);
    assert.equal(state.swipe(delta), false);
    assert.equal(state.page.scrollTop, 500);
  }
});
test('horizontal gestures, pinch and desktop are left to the browser', () => {
  assert.equal(setup(800).swipe(20, 160), false);
  assert.equal(setup(800).swipe(20, 100, 2), false);
  assert.equal(setup(800, false).swipe(20), false);
});
test('document boundary does not trap the gesture', () => {
  const state = setup(800);
  state.page.scrollTop = 1300;
  assert.equal(state.swipe(60), false);
  assert.equal(state.page.scrollTop, 1300);
});
