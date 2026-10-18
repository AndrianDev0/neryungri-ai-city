'use strict';

window.cityApiUrl = path => `${(window.CITY_CONFIG?.apiBase || '').replace(/\/$/, '')}${path}`;

window.cityOpenHostedApp = () => {
  const base = window.CITY_CONFIG?.apiBase;
  if (!base) return false;
  const destination = new URL(base);
  if (destination.protocol !== 'https:' || destination.origin === window.location.origin) return false;
  window.location.replace(destination.origin + '/');
  return true;
};

window.cityFetch = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();
  const editing = !['GET', 'HEAD'].includes(method);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  let token = null;
  try { if (editing) token = sessionStorage.getItem('city-write-token'); } catch { /* The owner can still enter the code for this request. */ }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response = await fetch(cityApiUrl(path), {...options, headers});
  if (response.status === 401 && editing) {
    try { sessionStorage.removeItem('city-write-token'); } catch { /* Storage is optional. */ }
    token = window.prompt('Для изменения данных введите код владельца. Просматривать обращения можно без кода.');
    if (token?.trim()) {
      headers.set('Authorization', `Bearer ${token.trim()}`);
      response = await fetch(cityApiUrl(path), {...options, headers});
      if (response.ok) {
        try { sessionStorage.setItem('city-write-token', token.trim()); } catch { /* The write succeeded without saving the code. */ }
      }
    }
  }
  return response;
};
