'use strict';

window.cityApiUrl = path => `${(window.CITY_CONFIG?.apiBase || '').replace(/\/$/, '')}${path}`;

window.cityFetch = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  let token = sessionStorage.getItem('city-write-token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response = await fetch(cityApiUrl(path), {...options, headers});
  if (response.status === 401 && !['GET', 'HEAD'].includes(options.method || 'GET')) {
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
