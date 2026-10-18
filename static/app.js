'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const paths = {
  map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chart:'<path d="M4 3v17h17M9 15v-4M14 15V6M19 15V9"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  locate:'<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  scan:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M7 9h10M7 13h10M7 17h5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.list}</svg>`;
$$('[data-icon]').forEach(el => {el.innerHTML = icon(el.dataset.icon);});
const state = {dataset:'demo', view:'map', reports:[], meta:null, selected:null, markers:new Map(), loading:true, failed:false, sort:'priority', request:0, analyticsRequest:0};
let cityMap, pickMap, pickMarker, toastTimer, detailReturnTarget, mapLoading=false;
const center = [124.715, 56.662];
const titles = {map:'Карта обращений', registry:'Реестр обращений', analytics:'Аналитика обращений'};

async function api(path, options = {}) {
  let response;
  try { response = await cityFetch(path, options); }
  catch {
    const error = new Error('Не удалось связаться с приложением. Проверьте, что оно запущено, и повторите.');
    error.networkFailure = true;
    throw error;
  }
  if (!response.ok) {
    let message = 'Не удалось выполнить действие. Повторите ещё раз.';
    try {
      const body = await response.json();
      message = typeof body.detail === 'string' ? body.detail : 'Проверьте текст, дату и координаты. Обе координаты должны быть заполнены вместе.';
    } catch { /* A failed server can return a non-JSON error page. */ }
    throw new Error(message);
  }
  return response.json();
}

function showToast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => {$('#toast').hidden = true;}, 4500);
}
function setError(target, message) {const node = $(target); node.textContent = message; node.hidden = !message;}
function busy(button, active, text) {button.disabled = active; if(active) {button.dataset.original = button.innerHTML; button.textContent = text;} else if(button.dataset.original) button.innerHTML = button.dataset.original;}
function dateShort(value) {return new Date(value).toLocaleDateString('ru-RU', {day:'numeric', month:'short', timeZone:'Asia/Yakutsk'});}
function dateFull(value) {return new Date(value).toLocaleString('ru-RU', {day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Yakutsk'});}
function priorityHtml(report) {return `<span class="priority-label ${report.priority}">${escapeHtml(report.priority_label)}</span>`;}
function categoryOptions(selected = '', includeAuto = false) {return (includeAuto ? '<option value="">Определить автоматически</option>' : '') + Object.entries(state.meta.categories).map(([key,label])=>`<option value="${key}"${key===selected?' selected':''}>${escapeHtml(label)}</option>`).join('');}
function options(values, selected) {return Object.entries(values).map(([key,label])=>`<option value="${key}"${key===selected?' selected':''}>${escapeHtml(label)}</option>`).join('');}

function mapError(target, error, picker=false) {
  const missing=error.code==='missing-key';
  $(target).innerHTML=`<strong>${missing?'Яндекс Карты пока не подключены':'Не удалось загрузить Яндекс Карты'}</strong><p>${escapeHtml(error.message)}</p>${picker?'<p>Место можно указать координатами ниже или сохранить обращение без точки.</p>':'<p>Обращения доступны в списке и реестре.</p>'}<div class="map-notice-actions"><button type="button" class="button small secondary" data-action="map-help">Как подключить</button>${picker?'':'<button type="button" class="text-button" data-action="retry-map">Проверить подключение</button>'}</div>`;
  $(target).hidden=false;
}
async function initMap() {
  if(cityMap||mapLoading)return;
  mapLoading=true;
  try {
    await CityMaps.ready();
    if(state.view!=='map')return;
    cityMap=CityMaps.create($('#city-map'),center);
    $('#map-notice').hidden=true;$('#city-zoom').hidden=false;$('#map-legend').hidden=false;$('#fit-map').disabled=false;
    $('#zoom-lock').disabled=false;
    renderReports();
  } catch(error) {mapError('#map-notice',error);}
  finally {mapLoading=false;}
}
function clearMarkers() {
  for(const {entity} of state.markers.values())cityMap.removeChild(entity);
  state.markers.clear();
}
function visibleReports() {
  const query = $('#search').value.trim().toLocaleLowerCase('ru');
  const category = $('#category-filter').value, priority = $('#priority-filter').value, status = $('#status-filter').value;
  const weights = {high:0,medium:1,normal:2};
  return state.reports.filter(r => (!category || r.category === category) && (!priority || r.priority === priority) && (!status || r.status === status) && (!query || `${r.text} ${r.address} ${r.reference} ${r.category_label}`.toLocaleLowerCase('ru').includes(query)))
    .sort((a,b) => state.sort === 'date' ? new Date(b.created_at)-new Date(a.created_at) : (a.status==='resolved')-(b.status==='resolved') || weights[a.priority]-weights[b.priority] || new Date(b.created_at)-new Date(a.created_at));
}
function emptyHtml() {
  const hasRecords = state.reports.length > 0;
  return `<div class="empty-state">${icon(hasRecords?'search':'list')}<h3>${hasRecords?'Ничего не найдено':'Пока нет обращений'}</h3><p>${hasRecords?'Измените запрос или сбросьте фильтры.':'Добавьте первое обращение или загрузите CSV.'}</p><button class="button secondary" data-empty-action="${hasRecords?'reset':'new'}">${hasRecords?'Сбросить фильтры':'Добавить обращение'}</button></div>`;
}
function renderSummary() {
  const r = state.reports;
  $('#stat-total').textContent=r.length;
  $('#stat-high').textContent=r.filter(x=>x.priority==='high'&&x.status!=='resolved').length;
  $('#stat-progress').textContent=r.filter(x=>x.status==='in_progress').length;
  $('#stat-unlocated').textContent=r.filter(x=>x.lat===null).length;
  $('#as-of').textContent = `На ${dateShort(state.meta.today+'T12:00:00+09:00')}`;
  const problems=r.filter(x=>x.id===x.problem_id);
  $('#problem-summary').textContent=`Проблем: ${problems.length} · Дублей: ${r.length-problems.length} · Повторов после ремонта: ${problems.filter(x=>x.recurrence_of).length}`;
}
function renderReports() {
  const reports=visibleReports();
  const mapped=mapReports(reports);
  $('#map-point-count').textContent=`Точек: ${mapped.filter(r=>r.lat!==null).length}`;
  $('#visible-count').textContent=reports.length; $('#registry-count').textContent=reports.length;
  if(state.loading) {$('#report-list').innerHTML='<div class="loading-state">Загружаем обращения…</div>'; $('#registry-list').innerHTML='<div class="loading-state">Загружаем обращения…</div>'; return;}
  if(state.failed) {$('#report-list').innerHTML='<div class="empty-state"><h3>Не удалось загрузить данные</h3><p>Нажмите «Повторить» над сводкой.</p></div>'; $('#registry-list').innerHTML=$('#report-list').innerHTML; return;}
  $('#report-list').innerHTML = reports.length ? reports.map(r=>`<button class="report-row${state.selected===r.id?' selected':''}" data-report="${r.id}" aria-label="Открыть ${escapeHtml(r.reference)}: ${escapeHtml(r.category_label)}"><div class="report-meta"><span class="reference">${r.reference}</span>${priorityHtml(r)}</div><h3>${escapeHtml(r.category_label)}</h3><p class="report-excerpt">${escapeHtml(r.text)}</p><div class="report-location">${icon('pin')}<span>${escapeHtml(r.address || 'Место не указано')}${r.lat===null && r.address?' · без точки':''}</span></div><div class="report-bottom"><span class="status-label ${r.status}">${r.status_label}</span><span>${dateShort(r.created_at)}</span></div></button>`).join('') : emptyHtml();
  $('#registry-list').innerHTML = reports.length ? reports.map(r=>`<button class="registry-item" data-report="${r.id}" aria-label="Открыть ${r.reference}: ${escapeHtml(r.category_label)}"><span class="reference">${r.reference}</span><div><strong>${escapeHtml(r.category_label)}</strong><p>${escapeHtml(r.text)}</p></div><span class="registry-address">${escapeHtml(r.address || 'Место не указано')}<br>${dateShort(r.created_at)}</span>${priorityHtml(r)}<span class="status-label ${r.status}">${r.status_label}</span></button>`).join('') : emptyHtml();
  if(cityMap) {
    clearMarkers();
    for (const r of mapped.filter(x=>x.lat!==null)) {
      const markerElement=document.createElement('button');
      markerElement.type='button';markerElement.className='map-marker';
      markerElement.innerHTML=`<span class="marker-disc ${r.priority}${r.status==='resolved'?' resolved':''}${state.selected===r.id?' selected':''}">${r.id}</span>`;
      markerElement.setAttribute('aria-label',`${r.reference}: ${r.category_label}, ${r.priority_label.toLowerCase()} приоритет`);
      markerElement.title=markerElement.getAttribute('aria-label')+($('#map-mode').value==='problems'?` · Обращений: ${r.problem_report_count}`:'');
      markerElement.addEventListener('click',event=>{event.stopPropagation();openDetail(r.id,markerElement);});
      const entity=CityMaps.marker([r.lon,r.lat],markerElement);
      entity.events.add('click',()=>openDetail(r.id,markerElement));
      cityMap.addChild(entity);state.markers.set(r.id,{entity,element:markerElement});
    }
  }
}
async function loadReports() {
  const request=++state.request;
  state.loading=true; state.failed=false; $('#global-error').hidden=true; renderReports();
  try {
    const data=await api(`/api/reports?dataset=${state.dataset}`);
    if(request!==state.request)return;
    state.reports=data.reports; state.loading=false; renderSummary(); renderReports();
    if(state.view==='analytics')loadAnalytics();
  } catch(error) {
    if(request!==state.request)return;
    state.loading=false; state.failed=true; state.reports=[];
    $('#problem-summary').textContent='Не удалось загрузить сведения о связях.';
    $('#global-error-text').textContent=error.message; $('#global-error').hidden=false;
    ['#stat-total','#stat-high','#stat-progress','#stat-unlocated'].forEach(s=>$(s).textContent='…');
    clearMarkers();renderReports();
  }
}
function switchDataset(dataset) {
  state.dataset=dataset;state.selected=null;state.analyticsRequest++;
  $$('[data-dataset]').forEach(b=>{b.classList.toggle('selected',b.dataset.dataset===dataset);b.setAttribute('aria-pressed',String(b.dataset.dataset===dataset));});
  $('#dataset-description').textContent=dataset==='demo'?'Вымышленные обращения для проверки. Не данные администрации.':'Ваши записи хранятся на этом компьютере отдельно от учебного набора.';
  $('#export-link').href=cityApiUrl(`/api/export.csv?dataset=${dataset}`);
  resetFilters(false);loadReports();
}
function switchView(view) {
  state.view=view;$('#page-title').textContent=titles[view];document.title=`Neryungri AI City | ${titles[view]}`;
  $$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  ['map','registry','analytics'].forEach(v=>$(`#${v}-view`).hidden=v!==view);
  $('#filters').hidden=view==='analytics';
  if(view==='map'&&!cityMap)initMap();
  if(view==='analytics')loadAnalytics();
}
function resetFilters(render=true) {['#search','#category-filter','#priority-filter','#status-filter'].forEach(s=>$(s).value='');if(render)renderReports();}
function fitMap() {
  if(!cityMap)return;
  const points=mapReports().filter(r=>r.lat!==null);
  if(points.length===1)cityMap.setLocation({center:[points[0].lon,points[0].lat],zoom:15});
  else if(points.length) {
    const west=Math.min(...points.map(r=>r.lon)),east=Math.max(...points.map(r=>r.lon));
    const south=Math.min(...points.map(r=>r.lat)),north=Math.max(...points.map(r=>r.lat));
    const dx=Math.max(.003,(east-west)*.15),dy=Math.max(.002,(north-south)*.15);
    cityMap.setLocation({bounds:[[west-dx,north+dy],[east+dx,south-dy]],duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:250});
  } else {cityMap.setLocation({center,zoom:14});showToast('В выбранных обращениях нет координат');}
}

function restoreDetailFocus() {
  if(!detailReturnTarget)return;
  const {id,view,marker}=detailReturnTarget;
  const target = marker ? state.markers.get(id)?.element : $(`#${view==='registry'?'registry-list':'report-list'} [data-report="${id}"]`);
  (target || $(`[data-view="${state.view}"]`))?.focus({preventScroll:true});
}

async function openDetail(id, opener = document.activeElement, discard = false) {
  if($('#report-dialog').open&&!discard)rememberDetail();
  const r=state.reports.find(x=>x.id===id);if(!r)return;
  if(!$('#report-dialog').open)detailReturnTarget={id,view:state.view,marker:opener?.classList.contains('map-marker')};
  state.selected=id;
  $$('.report-row').forEach(row=>row.classList.toggle('selected',Number(row.dataset.report)===id));
  for(const [reportId,marker] of state.markers)marker.element.querySelector('.marker-disc')?.classList.toggle('selected',reportId===id);
  if(r.lat!==null && cityMap)cityMap.setLocation({center:[r.lon,r.lat]});
  $('#detail-reference').textContent=`${r.reference} · ${r.demo?'Учебный пример':'Мои данные'}`;
  $('#detail-content').innerHTML=detailMarkup(r);
  $('#detail-content').scrollTop=0;
  renderProblemDetails(r);
  setupWorkflow(r);
  if(!$('#report-dialog').open)$('#report-dialog').showModal();
  $('#detail-form').addEventListener('submit',async event=>{
    event.preventDefault(); const button=$('#detail-save');busy(button,true,'Сохраняем…');setError('#detail-error','');
    try {rememberDetail();const changes=detailDrafts.get(id);if(!changes){showToast('Нет изменений для сохранения');return;}await api(`/api/reports/${id}`,{method:'PATCH',body:JSON.stringify(changes)});detailDrafts.delete(id);await loadReports();$('#report-dialog').close();showToast('Изменения сохранены');}
    catch(error){setError('#detail-error',error.message);$('#detail-error').focus();}finally{busy(button,false);}
  });
  try {
    const data=await api(`/api/similar/${id}`);
    if(state.selected!==id)return;
    $('#similar-section').innerHTML=`<summary>Похожие обращения рядом (${data.matches.length})</summary>${data.matches.length?`<p>В пределах 120 м, за 7 дней. Связь проверяет специалист.</p><div>${data.matches.map(m=>{const match=state.reports.find(x=>x.id===m.id);return `<p><button class="text-button" data-report="${m.id}">${m.reference} · ${m.distance_m} м</button><br>${escapeHtml(match?.address)}<br>${escapeHtml(match?.text)}</p>`;}).join('')}</div>`:`<p>${r.lat===null?'Для поиска нужны координаты.':'Совпадений по категории, месту и времени не найдено.'}</p>`}`;
  }catch{if(state.selected===id)$('#similar-section').innerHTML='<summary>Похожие обращения рядом</summary><p>Не удалось проверить совпадения.</p>';}
}

async function openNew() {
  $('#new-form').reset();$('#save-report').textContent='Сохранить обращение';$('#analysis-result').innerHTML='';$('#analysis-result').hidden=true;setError('#new-error','');$('#new-dialog').showModal();
  clearPickMarker();
  try {
    await CityMaps.ready();
    if(!$('#new-dialog').open)return;
    if(!pickMap) {
      pickMap=CityMaps.create($('#pick-map'),center,true);
      pickMap.onClick(setLocation);
    }
    $('#pick-notice').hidden=true;$('#pick-zoom').hidden=false;
    const lat=$('#new-lat').value,lon=$('#new-lon').value;
    if(lat&&lon){setLocation(Number(lat),Number(lon));pickMap.setLocation({center:[Number(lon),Number(lat)],zoom:14});}
    else pickMap.setLocation({center,zoom:14});
  } catch(error) {mapError('#pick-notice',error,true);}
}
function clearPickMarker() {
  if(pickMarker){pickMap.removeChild(pickMarker);pickMarker=null;}
}
function setLocation(lat,lon) {
  if(lat<56.5||lat>56.8||lon<124.45||lon>124.95){showToast('Выберите точку в пределах Нерюнгри и ближайших окрестностей');return;}
  $('#new-lat').value=Number(lat).toFixed(6);$('#new-lon').value=Number(lon).toFixed(6);
  if(!pickMap)return;
  if(pickMarker)CityMaps.moveMarker(pickMarker,[lon,lat]);
  else {
    const dot=document.createElement('span');dot.className='pick-marker';dot.setAttribute('aria-hidden','true');
    pickMarker=CityMaps.marker([lon,lat],dot);pickMap.addChild(pickMarker);
  }
}
async function analyzeText() {
  const text=$('#new-text');if(!text.reportValidity())return;
  const button=$('#analyze-button');busy(button,true,'Определяем категорию…');setError('#new-error','');
  try {
    const result=await api('/api/analyze',{method:'POST',body:JSON.stringify({text:text.value})});
    $('#new-category').value=result.category;
    $('#analysis-result').innerHTML=`<strong>${escapeHtml(result.suggestions?.length?result.suggestions.map(s=>s.label).join(' + '):result.category_label)} · ${escapeHtml(state.meta.priorities[result.priority])} приоритет</strong><p>${escapeHtml(result.reasons.join(' '))}</p><p>${result.suggestions?.length?'Найдено несколько тем. Можно создать отдельные задачи или выбрать одну категорию.':result.review_required?'Категория неоднозначна. Выберите подходящую вручную.':'Предварительный результат учебной модели. Проверьте категорию.'}</p>`;
    $('#analysis-result').hidden=false;
    splitSuggestions(result);
  }catch(error){setError('#new-error',error.message);}finally{busy(button,false);}
}
async function saveNew(event) {
  event.preventDefault();setError('#new-error','');
  const lat=$('#new-lat').value,lon=$('#new-lon').value;
  if(Boolean(lat)!==Boolean(lon)){setError('#new-error','Укажите обе координаты или уберите точку.');return;}
  const button=$('#save-report');busy(button,true,'Сохраняем…');
  try {
    const payload={text:$('#new-text').value,address:$('#new-address').value,category:$('#new-category').value||null,lat:lat?Number(lat):null,lon:lon?Number(lon):null};
    const split=$('#split-enabled')?.checked;
    if(split){payload.parts=$$('.split-text').map(el=>({text:el.value}));payload.categories=$$('.split-category').map(el=>el.value);}
    const report=await api(split?'/api/reports/split':'/api/reports',{method:'POST',body:JSON.stringify(payload)});
    $('#new-dialog').close();switchDataset('user');showToast(split?`Созданы связанные задачи: ${report.reports.length}`:`Обращение ${report.reference} сохранено в «Мои данные»`);
  }catch(error){setError('#new-error',error.message);}finally{busy(button,false);}
}
async function importCsv(event) {
  event.preventDefault();setError('#import-error','');const file=$('#csv-file').files[0];if(!file)return;
  if(file.size>2_000_000){setError('#import-error','Файл слишком большой. Максимум 2 МБ.');return;}
  const button=$('#import-submit');busy(button,true,'Проверяем и загружаем…');
  try {
    const buffer=await file.arrayBuffer();let csv;
    try{csv=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new Error('Сохраните CSV в кодировке UTF-8 и повторите загрузку.');}
    const result=await api('/api/import',{method:'POST',body:JSON.stringify({csv})});
    $('#import-dialog').close();switchDataset('user');showToast(`Загружено обращений: ${result.imported}`);
  }catch(error){setError('#import-error',error.message);}finally{busy(button,false);}
}
async function loadAnalytics() {
  const request=++state.analyticsRequest;$('#analytics-content').innerHTML='<div class="loading-state">Рассчитываем показатели выбранного набора…</div>';
  try {
    const data=await api(`/api/analytics?dataset=${state.dataset}`);if(request!==state.analyticsRequest)return;
    const maxCategory=Math.max(1,...data.categories.map(c=>c.count)),maxDay=Math.max(1,...data.days.map(d=>d.count));
    $('#analytics-content').innerHTML=`<section class="chart-panel"><h2>Обращения по категориям</h2><p class="panel-subtitle">${state.dataset==='demo'?'Учебные записи':'Все записи в «Мои данные»'}. Количество сообщений, включая решённые.</p>${data.categories.map(c=>`<div class="bar-row"><span>${c.label}</span><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${c.count/maxCategory*100}%"></div></div><strong>${c.count}</strong></div>`).join('')}</section><section class="chart-panel"><h2>Поступление обращений</h2><p class="panel-subtitle">Последние 14 дней, по дате сообщения.</p><div class="daily-chart" role="img" aria-label="${escapeHtml(data.days.map(d=>`${dateShort(d.date+'T12:00:00+09:00')}: ${d.count}`).join('; '))}">${data.days.map(d=>`<div class="day-column" title="${dateShort(d.date+'T12:00:00+09:00')}: ${d.count}"><span class="day-value">${d.count}</span><div class="day-bar" style="height:${Math.max(2,d.count/maxDay*135)}px"></div></div>`).join('')}</div><div class="chart-dates"><span>${dateShort(data.days[0].date+'T12:00:00+09:00')}</span><span>${dateShort(data.days.at(-1).date+'T12:00:00+09:00')}</span></div></section><section class="chart-panel forecast-panel"><div><h2>Оценка на следующую неделю</h2><p class="panel-subtitle">${data.forecasts.length?'Базовая оценка: среднее за четыре недели.':'Для расчёта нужна история минимум за 28 дней и 30 обращений.'}</p><p class="field-help">${escapeHtml(data.forecast_note)}</p></div><div>${data.forecasts.length?data.forecasts.map(f=>`<div class="forecast-row"><span>${f.label}</span><strong>${f.expected.toLocaleString('ru-RU')}</strong></div>`).join(''):`<div class="forecast-state"><strong>Недостаточно истории</strong><p>${state.reports.length?`В выбранном наборе ${state.reports.length} обращений. `:''}Загрузите полную выгрузку за несколько недель, чтобы рассчитать базовую оценку.</p><button class="text-button" data-action="import">Загрузить историю</button></div>`}</div></section>`;
    renderProblemAnalytics(data);
  }catch(error){if(request!==state.analyticsRequest)return;$('#analytics-content').innerHTML=`<div class="empty-state"><h3>Не удалось рассчитать показатели</h3><p>${escapeHtml(error.message)}</p><button class="button secondary" data-action="retry-analytics">Повторить</button></div>`;}
}

function openImport(){ $('#import-form').reset();$('#file-name').textContent='Нажмите, чтобы открыть файл';setError('#import-error','');$('#import-dialog').showModal(); }
document.addEventListener('click',event=>{
  const zoom=event.target.closest('[data-zoom]');
  if(zoom){const map=zoom.dataset.map==='pick'?pickMap:cityMap;if(map)map.setLocation({zoom:Math.min(19,Math.max(9,map.zoom+Number(zoom.dataset.zoom)))});}
  const close=event.target.closest('[data-close]');if(close)$(`#${close.dataset.close}`).close();
  const report=event.target.closest('[data-report]');if(report)openDetail(Number(report.dataset.report),report);
  const empty=event.target.closest('[data-empty-action]');if(empty){if(empty.dataset.emptyAction==='new')openNew();else resetFilters();}
  const action=event.target.closest('[data-action]');if(action?.dataset.action==='import')openImport();if(action?.dataset.action==='retry-analytics')loadAnalytics();if(action?.dataset.action==='method')$('#method-dialog').showModal();
  if(action?.dataset.action==='map-help')$('#map-help-dialog').showModal();
  if(action?.dataset.action==='retry-map')location.reload();
});
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
$$('[data-dataset]').forEach(b=>b.addEventListener('click',()=>switchDataset(b.dataset.dataset)));
['#search','#category-filter','#priority-filter','#status-filter'].forEach(s=>$(s).addEventListener('input',renderReports));
$('#sort').addEventListener('change',()=>{state.sort=$('#sort').value;renderReports();});
$('#map-mode').addEventListener('change',()=>{renderReports();showToast($('#map-mode').value==='problems'?'Одна точка на проблему. Место определяется по основной записи группы.':'На карте показаны отдельные обращения');});
$('#reset-filters').addEventListener('click',()=>resetFilters());$('#fit-map').addEventListener('click',fitMap);
$('#zoom-lock').addEventListener('click',()=>{
  if(!cityMap)return;
  const button=$('#zoom-lock'),locked=button.getAttribute('aria-pressed')!=='true';
  cityMap.setZoomLocked(locked);
  button.setAttribute('aria-pressed',String(locked));
  button.textContent=locked?'Масштаб защищён':'Свободный масштаб';
  button.title=locked?'Колёсико, двойной щелчок и жесты не меняют масштаб. Кнопки + и − работают.':'Колёсико, двойной щелчок и жесты меняют масштаб. Нажмите, чтобы заблокировать.';
  showToast(locked?'Масштаб защищён от случайного изменения. Кнопки + и − работают.':'Изменение масштаба колёсиком и жестами включено');
});
$('#new-open').addEventListener('click',openNew);$('#import-open').addEventListener('click',openImport);
$('#method-open').addEventListener('click',()=>$('#method-dialog').showModal());
$('#analyze-button').addEventListener('click',analyzeText);$('#new-form').addEventListener('submit',saveNew);
$('#new-text').addEventListener('input',()=>{$('#save-report').textContent='Сохранить обращение';$('#analysis-result').innerHTML='';$('#analysis-result').hidden=true;$('#new-category').value='';});
$('#clear-location').addEventListener('click',()=>{$('#new-lat').value='';$('#new-lon').value='';clearPickMarker();});
['#new-lat','#new-lon'].forEach(s=>$(s).addEventListener('change',()=>{const lat=Number($('#new-lat').value),lon=Number($('#new-lon').value);if(lat>=56.5&&lat<=56.8&&lon>=124.45&&lon<=124.95){setLocation(lat,lon);pickMap?.setLocation({center:[lon,lat]});}else clearPickMarker();}));
$('#csv-file').addEventListener('change',()=>{$('#file-name').textContent=$('#csv-file').files[0]?.name||'Нажмите, чтобы открыть файл';});
$('#import-form').addEventListener('submit',importCsv);$('#retry').addEventListener('click',()=>initialize());
$('#report-dialog').addEventListener('close',restoreDetailFocus);

async function initialize() {
  if(window.CITY_CONFIG?.apiBase && !state.meta) $('#as-of').textContent='Подключаем сервер. После простоя это может занять около минуты.';
  try {
    if(!state.meta){state.meta=await api('/api/meta');$('#category-filter').innerHTML='<option value="">Все категории</option>'+categoryOptions();$('#new-category').innerHTML=categoryOptions('',true);}
    if(state.meta.temporary_storage){$('#hosting-notice').hidden=false;$('#storage-note').textContent='Временное хранение на сервере';}
    if(!cityMap)initMap();await loadReports();
  }catch(error){
    if(!state.meta && error.networkFailure && cityOpenHostedApp())return;
    $('#global-error-text').textContent=error.message;$('#global-error').hidden=false;state.loading=false;state.failed=true;renderReports();
  }
}
$$('a[href^="/api/"]').forEach(link => {link.href=cityApiUrl(link.getAttribute('href'));});
initialize();
