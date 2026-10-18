'use strict';

// Apply before painting so a saved dark preference does not flash a light page.
(() => {
  let saved;
  try { saved=localStorage.getItem('city-appearance'); } catch { /* Storage can be unavailable. */ }
  document.documentElement.dataset.theme=saved==='dark'||saved==='light'?saved:
    (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  document.addEventListener('DOMContentLoaded',()=>{
    const button=document.querySelector('#theme-toggle');
    const sync=()=>{
      const dark=document.documentElement.dataset.theme==='dark';
      document.querySelector('meta[name="theme-color"]').content=dark?'#19191b':'#f5f5f7';
      button.setAttribute('aria-pressed',String(dark));
      button.setAttribute('aria-label',dark?'Включить светлую тему':'Включить тёмную тему');
      button.title=button.getAttribute('aria-label');
      button.querySelector('.theme-caption').textContent=dark?'Тёмная тема':'Светлая тема';
    };
    button.addEventListener('click',()=>{
      const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';
      document.documentElement.dataset.theme=theme;
      try { localStorage.setItem('city-appearance',theme); } catch { /* Preference still works for this page. */ }
      sync();
    });
    sync();
  });
})();
