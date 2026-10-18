'use strict';

window.cityApiUrl = path => `${(window.CITY_CONFIG?.apiBase || '').replace(/\/$/, '')}${path}`;

window.cityFetch = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();
  const editing = !['GET', 'HEAD'].includes(method);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  let token = editing ? sessionStorage.getItem('city-write-token') : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response = await fetch(cityApiUrl(path), {...options, headers});
  if (response.status === 401 && editing) {
    sessionStorage.removeItem('city-write-token');
    token = window.prompt('Введите код редактирования владельца сайта. Просмотр доступен без кода.');
    if (token?.trim()) {
      headers.set('Authorization', `Bearer ${token.trim()}`);
      response = await fetch(cityApiUrl(path), {...options, headers});
      if (response.ok) sessionStorage.setItem('city-write-token', token.trim());
    }
  }
  return response;
};
