'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const list = document.querySelector('#report-list');
  const mobile = matchMedia('(max-width: 720px)');
  let gesture = null;

  list.addEventListener('touchstart', event => {
    gesture = mobile.matches && event.touches.length === 1
      ? {x: event.touches[0].clientX, y: event.touches[0].clientY, lastY: event.touches[0].clientY}
      : null;
  }, {passive: true});

  // Safari can keep an edge swipe inside the list instead of moving the page.
  list.addEventListener('touchmove', event => {
    if (!gesture || event.touches.length !== 1 || !mobile.matches) return;
    const touch = event.touches[0];
    const delta = gesture.lastY - touch.clientY;
    gesture.lastY = touch.clientY;
    if (!event.cancelable || Math.abs(touch.clientY - gesture.y) <= Math.abs(touch.clientX - gesture.x)) return;
    const bottom = Math.max(0, list.scrollHeight - list.clientHeight);
    const atEdge = delta < 0 ? list.scrollTop <= 1 : list.scrollTop >= bottom - 1;
    const page = document.scrollingElement;
    if (!atEdge || !page || !delta) return;
    const target = Math.max(0, Math.min(page.scrollHeight - page.clientHeight, page.scrollTop + delta));
    if (target === page.scrollTop) return;
    event.preventDefault();
    page.scrollTop = target;
  }, {passive: false});

  list.addEventListener('touchend', () => { gesture = null; }, {passive: true});
  list.addEventListener('touchcancel', () => { gesture = null; }, {passive: true});
});
