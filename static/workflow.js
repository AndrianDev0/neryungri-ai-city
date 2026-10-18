'use strict';

const detailDrafts = new Map();
let editMap, editMarker, detailRevision = 0;
const detailFields = {category:'detail-category', priority:'detail-priority', status:'detail-status',
  repair_confirmed:'repair-confirmed', resolution_note:'resolution-note', priority_note:'priority-note',
  assignee:'detail-assignee', due_date:'detail-due', address:'detail-address', lat:'detail-lat', lon:'detail-lon'};

function detailValues() {
  return Object.fromEntries(Object.entries(detailFields).map(([key,id])=>{
    const el=$('#'+id);
    return [key,el.type==='checkbox'?el.checked:['lat','lon'].includes(key)?(el.value===''?null:Number(el.value)):key==='due_date'?(el.value||null):el.value];
  }));
}
function rememberDetail() {
  const report=state.reports.find(r=>r.id===state.selected);
  if(!report||!$('#detail-form'))return;
  const changed=Object.fromEntries(Object.entries(detailValues()).filter(([key,value])=>value!==report[key]));
  if('lat' in changed || 'lon' in changed){const values=detailValues();changed.lat=values.lat;changed.lon=values.lon;}
  if(Object.keys(changed).length)detailDrafts.set(report.id,changed);else detailDrafts.delete(report.id);
  $('#draft-state').textContent=Object.keys(changed).length?'Есть несохранённые правки. Черновик хранится до обновления страницы.':'';
  $('#discard-draft').hidden=!Object.keys(changed).length;
}
function detailMarkup(r) {
  return `<h2 id="detail-title" class="detail-title">${escapeHtml(r.category_label)}</h2>${priorityHtml(r)}
    <p class="detail-text">${escapeHtml(r.text)}</p><p class="field-help">${escapeHtml(r.reference)} · ${dateFull(r.created_at)} · ${escapeHtml(r.zone)}</p>
    <form id="detail-form" class="detail-form">
      <label for="detail-category">Категория</label><select id="detail-category">${categoryOptions(r.category)}</select>
      <div class="form-columns"><div><label for="detail-priority">Приоритет</label><select id="detail-priority">${options(state.meta.priorities,r.priority)}</select></div><div><label for="detail-status">Статус</label><select id="detail-status">${options(state.meta.statuses,r.status)}</select></div></div>
      <div class="form-columns"><div><label for="detail-assignee">Ответственный или бригада</label><input id="detail-assignee" maxlength="150" value="${escapeHtml(r.assignee)}" placeholder="Пока не назначен"></div><div><label for="detail-due">Плановый срок</label><input id="detail-due" type="date" value="${escapeHtml(r.due_date)}"></div></div>
      <label for="detail-address">Адрес этого обращения</label><input id="detail-address" maxlength="300" value="${escapeHtml(r.address)}">
      <div class="form-columns"><div><label for="detail-lat">Широта</label><input id="detail-lat" type="number" step="any" min="56.5" max="56.8" value="${r.lat??''}"></div><div><label for="detail-lon">Долгота</label><input id="detail-lon" type="number" step="any" min="124.45" max="124.95" value="${r.lon??''}"></div></div>
      <div class="inline-actions"><button type="button" class="text-button" id="edit-location">Выбрать точку на карте</button><button type="button" class="text-button" id="remove-detail-location">Убрать точку</button></div>
      <div class="form-error" id="detail-error" role="alert" tabindex="-1" hidden></div>
    </form>
    <details class="detail-section"><summary>Исходная оценка по тексту</summary><p>${escapeHtml(r.analysis.reasons.join(' '))}</p><p class="field-help">Приоритет проверяет специалист.</p></details>
    <details class="detail-section" id="similar-section"><summary>Похожие обращения рядом</summary><p>Проверяем…</p></details>
    ${r.bundle_id?`<details class="detail-section"><summary>Исходное сообщение и другие темы</summary><p>${escapeHtml(r.source_text)}</p>${state.reports.filter(x=>x.bundle_id===r.bundle_id&&x.id!==r.id).map(x=>`<button type="button" class="text-button" data-report="${x.id}">${x.reference} · ${escapeHtml(x.category_label)}</button>`).join('')}</details>`:''}
    <details class="detail-section" id="photo-section"><summary>Фото до и после</summary><p class="field-help">JPEG, PNG или WebP до 5 МБ. Без лиц, номеров и других персональных данных. Фото сохраняются отдельно от правок карточки.</p><div id="photo-list">Загрузка…</div><form id="photo-form"><label for="photo-phase">Этап</label><select id="photo-phase"><option value="before">До ремонта</option><option value="after">После ремонта</option></select><label for="photo-file">Фотография</label><input type="file" id="photo-file" accept="image/jpeg,image/png,image/webp" required><button class="button secondary" id="photo-upload">Добавить фото</button><div class="form-error" id="photo-error" role="alert" hidden></div></form></details>
    <details class="detail-section" id="history-section"><summary>История изменений</summary><div id="history-list">Загрузка…</div></details>`;
}

function setupWorkflow(report) {
  const draft=detailDrafts.get(report.id);
  if(draft)for(const [key,value] of Object.entries(draft)) {
    const el=$('#'+detailFields[key]);if(!el)continue;
    if(el.type==='checkbox')el.checked=value;else el.value=value??'';
  }
  $('#detail-status').dispatchEvent(new Event('change'));
  $('#detail-form').addEventListener('input',rememberDetail);
  $('#detail-form').addEventListener('change',rememberDetail);
  rememberDetail();
  $('#discard-draft').onclick=()=>{detailDrafts.delete(report.id);openDetail(report.id,undefined,true);};
  $('#edit-location').onclick=openEditLocation;
  $('#remove-detail-location').onclick=()=>{$('#detail-lat').value='';$('#detail-lon').value='';rememberDetail();};
  $('#photo-form').onsubmit=async event=>{
    event.preventDefault();const file=$('#photo-file').files[0];if(!file)return;
    setError('#photo-error','');if(file.size>5_000_000){setError('#photo-error','Фото должно быть не больше 5 МБ');return;}
    const button=$('#photo-upload');busy(button,true,'Загружаем…');
    try{await api(`/api/reports/${report.id}/photos?phase=${$('#photo-phase').value}`,{method:'POST',headers:{'Content-Type':file.type},body:file});$('#photo-file').value='';await loadAttachments(report.id);showToast('Фото добавлено');}
    catch(error){setError('#photo-error',error.message);}finally{busy(button,false);}
  };
  loadAttachments(report.id);
}

window.addEventListener('beforeunload',event=>{if(detailDrafts.size){event.preventDefault();event.returnValue='';}});

const historyLabels={category:'Категория',status:'Статус',priority:'Приоритет',assignee:'Ответственный',due_date:'Срок',address:'Адрес',lat:'Широта',lon:'Долгота',repair_confirmed:'Ремонт подтверждён',resolution_note:'Результат проверки',priority_note:'Обоснование приоритета',problem_id:'Проблема',recurrence_of:'Предыдущий ремонт',resolved_at:'Дата решения',source_text:'Исходный текст',photo:'Фото'};
function historyValue(key,value){if(value===null||value==='')return 'не указано';if(key==='repair_confirmed')return value?'да':'нет';return ({category:state.meta.categories,status:state.meta.statuses,priority:state.meta.priorities}[key]||{})[value]??String(value);}
async function loadAttachments(id) {
  const revision=++detailRevision;
  const results=await Promise.allSettled([api(`/api/reports/${id}/history`),api(`/api/reports/${id}/photos`)]);
  if(state.selected!==id||revision!==detailRevision)return;
  const [history,photos]=results;
  $('#history-list').innerHTML=history.status==='fulfilled'?(history.value.events.length?`<ol class="history-list">${history.value.events.map(e=>`<li><strong>${escapeHtml(e.action)}</strong><time>${dateFull(e.created_at)}</time><ul>${Object.entries(e.changes).map(([key,v])=>`<li>${escapeHtml(historyLabels[key]||key)}: ${escapeHtml(historyValue(key,v.before))} → ${escapeHtml(historyValue(key,v.after))}</li>`).join('')}</ul></li>`).join('')}</ol>`:'<p>Изменений пока нет. Старые действия до включения истории не восстановлены.</p>'):'<p>Историю загрузить не удалось.</p>';
  $('#photo-list').innerHTML=photos.status==='fulfilled'?(photos.value.photos.length?`<div class="photo-grid">${photos.value.photos.map(p=>`<figure><a href="${escapeHtml(cityApiUrl(`/api/photos/${p.id}`))}" target="_blank" rel="noopener"><img src="${escapeHtml(cityApiUrl(`/api/photos/${p.id}`))}" alt="${p.phase==='before'?'До':'После'} ремонта, фото ${p.id}"></a><figcaption>${p.phase==='before'?'До':'После'} ремонта · ${dateShort(p.created_at)}</figcaption><button type="button" class="text-button" data-delete-photo="${p.id}">Удалить фото ${p.id}</button></figure>`).join('')}</div>`:'<p>Фотографий пока нет.</p>'):'<p>Фото загрузить не удалось.</p>';
  $$('[data-delete-photo]').forEach(button=>button.onclick=async()=>{
    busy(button,true,'Удаляем…');try{await api(`/api/reports/${id}/photos/${button.dataset.deletePhoto}`,{method:'DELETE'});await loadAttachments(id);}catch(error){setError('#photo-error',error.message);busy(button,false);}
  });
}

async function openEditLocation() {
  $('#location-dialog').showModal();$('#edit-map-error').hidden=true;
  try{
    await CityMaps.ready();if(!$('#location-dialog').open)return;
    if(!editMap){editMap=CityMaps.create($('#edit-map'),center,true);editMap.onClick((lat,lon)=>{
      if(lat<56.5||lat>56.8||lon<124.45||lon>124.95){showToast('Выберите точку в пределах Нерюнгри');return;}
      $('#detail-lat').value=lat.toFixed(6);$('#detail-lon').value=lon.toFixed(6);rememberDetail();showEditPoint(lat,lon);
      $('#edit-point-state').textContent=`Выбрано: ${lat.toFixed(5)}, ${lon.toFixed(5)}. Закройте карту и сохраните карточку.`;
    });}
    if(editMarker){editMap.removeChild(editMarker);editMarker=null;}
    const values=detailValues();editMap.setLocation({center:values.lat===null?center:[values.lon,values.lat],zoom:15});
    if(values.lat!==null&&values.lon!==null)showEditPoint(values.lat,values.lon);
    $('#edit-point-state').textContent='Нажмите на нужное место. Координаты можно также ввести в карточке.';
  }catch(error){$('#edit-map-error').textContent=error.message;$('#edit-map-error').hidden=false;}
}
function showEditPoint(lat,lon){if(editMarker)CityMaps.moveMarker(editMarker,[lon,lat]);else{const dot=document.createElement('span');dot.className='pick-marker';editMarker=CityMaps.marker([lon,lat],dot);editMap.addChild(editMarker);}}

function mapReports(reports=visibleReports()) {
  if($('#map-mode').value!=='problems')return reports;
  const seen=new Set();return reports.flatMap(r=>{
    if(seen.has(r.problem_id))return [];seen.add(r.problem_id);
    const root=state.reports.find(x=>x.id===r.problem_id)||r;
    return [root];
  });
}

function splitSuggestions(result) {
  if(!result.suggestions?.length)return;
  $('#analysis-result').insertAdjacentHTML('beforeend',`<div id="split-suggestions"><label class="check-label"><input type="checkbox" id="split-enabled">Создать отдельные задачи по темам</label><p class="field-help">Проверьте тексты. Задачи сохранят связь с исходным сообщением, общий адрес и точку.</p>${result.suggestions.map((s,i)=>`<label for="split-text-${i}">Тема ${i+1}</label><select aria-label="Категория темы ${i+1}" class="split-category">${categoryOptions(s.category)}</select><textarea id="split-text-${i}" class="split-text" required minlength="5" maxlength="4000" rows="2">${escapeHtml(s.text)}</textarea>`).join('')}</div>`);
  const toggle=()=>{$$('.split-text').forEach(el=>el.required=$('#split-enabled').checked);$('#save-report').textContent=$('#split-enabled').checked?'Создать задачи по темам':'Сохранить обращение';};
  $('#split-enabled').addEventListener('change',toggle);toggle();
}
