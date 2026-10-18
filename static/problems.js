'use strict';

function renderProblemDetails(report) {
  const group=state.reports.filter(r=>r.problem_id===report.problem_id);
  const previous=state.reports.find(r=>r.id===report.recurrence_of);
  const section=document.createElement('details');
  section.className='detail-section'; section.id='problem-links'; section.tabIndex=-1;
  section.innerHTML=`<summary>Связи · ${escapeHtml(report.problem_reference)} · обращений: ${group.length}</summary>
    <p>Статус, категория, приоритет, ответственный и срок общие для группы. Адрес и фото относятся к отдельному обращению.</p>
    <div>${group.map(r=>`<button type="button" class="text-button" data-report="${r.id}" ${r.id===report.id?'disabled':''}>${r.reference}${r.id===report.id?' (открыто)':''}</button>`).join('')}</div>
    ${previous?`<p>Повтор после подтверждённого ремонта <button type="button" class="text-button" data-report="${previous.id}">${previous.reference}</button></p>`:''}
    ${report.resolved_at?`<p>Отмечено как решённое: ${dateFull(report.resolved_at)}. ${report.repair_confirmed?'В карточке отмечено подтверждение ремонта.':'Результат ремонта не подтверждён.'}</p>`:''}
    ${report.priority_note?`<p><strong>Текущий приоритет:</strong> ${escapeHtml(report.priority_note)}</p>`:''}
    <div id="relation-controls"></div><div id="relation-error" class="form-error" role="alert" tabindex="-1" hidden></div>`;
  $('#similar-section').before(section);
  const fields=document.createElement('div'); fields.className='problem-fields';
  fields.innerHTML=`<label for="priority-note">Почему выбран этот приоритет</label><textarea id="priority-note" rows="2" maxlength="500" placeholder="Объясните, почему изменили приоритет">${escapeHtml(report.priority_note)}</textarea>
    <div id="repair-fields"><label class="check-label" for="repair-confirmed"><input type="checkbox" id="repair-confirmed" ${report.repair_confirmed?'checked':''}>Ремонт подтверждён проверкой</label>
    <label for="resolution-note">Результат проверки</label><textarea id="resolution-note" rows="2" maxlength="1000" placeholder="Что исправлено и как проверен результат, без личных данных">${escapeHtml(report.resolution_note)}</textarea><p class="field-help">Повтор можно связать с ремонтом, только если новое обращение поступило позже. Сначала отметьте проверку ремонта и сохраните статус «Решено». Приложение запишет дату сохранения.</p></div>`;
  $('#detail-error').before(fields);
  function toggleRepair(){const resolved=$('#detail-status').value==='resolved';$('#repair-fields').hidden=!resolved;if(!resolved)$('#repair-confirmed').checked=false;$('#resolution-note').required=resolved&&$('#repair-confirmed').checked;}
  $('#detail-status').addEventListener('change',toggleRepair);
  $('#repair-confirmed').addEventListener('change',toggleRepair);toggleRepair();
  const controls=$('#relation-controls');
  if(report.problem_id!==report.id || report.recurrence_of) {
    controls.innerHTML='<button type="button" class="button secondary" id="unlink-report">Снять связь</button><p class="field-help">Обращение сохранится. При отделении дубля его статус и приоритет не изменятся.</p>';
    $('#unlink-report').addEventListener('click',event=>saveRelation(report,event.currentTarget,'DELETE'));
    return;
  }
  if(group.length>1 || state.reports.some(r=>r.recurrence_of===report.problem_id)) {
    controls.innerHTML='<p class="field-help">Чтобы присоединить новое обращение, откройте его карточку. Чтобы отделить дубль, откройте карточку дубля.</p>';
    return;
  }
  controls.innerHTML=`<form id="relation-form"><label for="relation-kind">Как связать обращение</label><select id="relation-kind"><option value="duplicate">Сообщение о той же нерешённой проблеме</option><option value="recurrence">Новая поломка после ремонта</option></select><label for="relation-target">Существующая проблема</label><select id="relation-target" required></select><p class="field-help" id="relation-help"></p><button class="button secondary" id="link-report" type="submit">Подтвердить связь</button></form>`;
  function targets(){
    const kind=$('#relation-kind').value;
    const choices=state.reports.filter(r=>r.id===r.problem_id&&r.id!==report.problem_id&&r.category===report.category&&
      (kind==='duplicate'?r.status!=='resolved'&&report.status!=='resolved':r.status==='resolved'&&r.repair_confirmed&&r.resolved_at&&new Date(report.created_at)>new Date(r.resolved_at)));
    $('#relation-target').innerHTML='<option value="">Выберите обращение</option>'+choices.map(r=>`<option value="${r.id}">${escapeHtml(r.reference+' · '+(r.address||r.text).slice(0,90))}</option>`).join('');
    $('#link-report').disabled=!choices.length;
    $('#relation-help').textContent=choices.length?'Проверьте место и описание. '+(kind==='duplicate'?'Сохранится более высокий приоритет. Ответственный и срок перейдут от выбранной проблемы.':'Новое обращение останется отдельной проблемой со ссылкой на ремонт.'):'Подходящих обращений нет. Для дубля обе проблемы должны быть открыты. Для повтора нужен подтверждённый ремонт.';
  }
  $('#relation-target').insertAdjacentHTML('afterend','<div id="relation-preview" class="candidate-preview" aria-live="polite"></div>');
  function preview(){const target=state.reports.find(r=>r.id===Number($('#relation-target').value));let distance='Расстояние неизвестно';if(target&&target.lat!==null&&report.lat!==null){const dx=(target.lon-report.lon)*Math.cos(report.lat*Math.PI/180),dy=target.lat-report.lat;distance=`Примерно ${Math.round(Math.hypot(dx,dy)*111195)} м`;}$('#relation-preview').innerHTML=target?`<strong>${escapeHtml(target.address||'Адрес не указан')}</strong><p>${escapeHtml(target.text)}</p><p>${distance} · ${escapeHtml(target.status_label)}</p>`:'';}
  $('#relation-target').addEventListener('change',preview);
  $('#relation-kind').addEventListener('change',()=>{$('#relation-preview').innerHTML='';});
  $('#relation-kind').addEventListener('change',targets); targets();
  $('#relation-form').addEventListener('submit',event=>{event.preventDefault();saveRelation(report,$('#link-report'),'PUT',{target_id:Number($('#relation-target').value),kind:$('#relation-kind').value});});
}

async function saveRelation(report,button,method,body) {
  rememberDetail();
  const draft=detailDrafts.get(report.id);
  busy(button,true,'Сохраняем связь…');setError('#relation-error','');
  try {
    await api(`/api/reports/${report.id}/relation`,{method,...(body?{body:JSON.stringify(body)}:{})});
    await loadReports();
    if($('#report-dialog').open&&state.selected===report.id){if(draft)detailDrafts.set(report.id,draft);else detailDrafts.delete(report.id);await openDetail(report.id,undefined,true);$('#problem-links').open=true;$('#problem-links').focus();}
    showToast(method==='DELETE'?'Связь снята':'Связь подтверждена');
  }catch(error){setError('#relation-error',error.message);$('#relation-error')?.focus();}
  finally{if(button.isConnected)busy(button,false);}
}

function renderProblemAnalytics(data) {
  const panel=document.createElement('section');panel.className='chart-panel problem-panel';
  panel.innerHTML=`<h2>Проблемы и повторные поломки</h2><p class="panel-subtitle">Проблем: ${data.problems}. Обращений-дублей: ${data.duplicate_reports}. Повторов после ремонта: ${data.recurrences}.</p><p class="field-help">Несвязанные обращения считаются отдельными проблемами. Дубли объединяет пользователь. Сектор определяется по главному обращению группы.</p>
    ${data.sectors.length?`<div class="data-table-wrap"><table class="data-table"><caption>Обращения по условным секторам</caption><thead><tr><th scope="col">Сектор</th><th scope="col">Обращения</th><th scope="col">Проблемы</th><th scope="col">Открыты</th><th scope="col">Повторы</th></tr></thead><tbody>${data.sectors.map(s=>`<tr><th scope="row">${escapeHtml(s.zone)}</th><td>${s.reports}</td><td>${s.problems}</td><td>${s.open}</td><td>${s.recurrences}</td></tr>`).join('')}</tbody></table></div>`:'<p>Добавьте обращения, чтобы начать учёт.</p>'}`;
  $('#analytics-content').prepend(panel);
  const evaluation=document.createElement('section');evaluation.className='chart-panel problem-panel';
  const e=data.evaluation;
  evaluation.innerHTML=`<h2>Проверка прогноза на прошлых данных</h2><p class="panel-subtitle">${escapeHtml(e.note)}</p>${e.available?`<p>Средняя абсолютная ошибка в числе обращений за неделю: <strong>${e.mae.toLocaleString('ru-RU')}</strong>. У правила «как на прошлой неделе»: <strong>${e.previous_week_mae.toLocaleString('ru-RU')}</strong>. Чем меньше ошибка, тем точнее расчёт на этих четырёх неделях.</p><div class="data-table-wrap"><table class="data-table"><caption>Завершённые недели, без сегодняшнего дня</caption><thead><tr><th scope="col">Начало недели</th><th scope="col">Среднее за 4 недели</th><th scope="col">Прошлая неделя</th><th scope="col">Факт</th></tr></thead><tbody>${e.windows.map(w=>`<tr><th scope="row">${dateShort(w.start+'T00:00:00+09:00')}</th><td>${w.expected.toLocaleString('ru-RU')}</td><td>${w.previous_week}</td><td>${w.actual}</td></tr>`).join('')}</tbody></table></div>`:'<p>Для проверки точности пока недостаточно истории.</p>'}
    ${data.sector_forecasts.length?`<h3>Прогноз числа обращений по секторам на 7 дней</h3><p class="field-help">Среднее за 28 завершённых дней, включая дубли. Сегодняшний день не учитывается. Ошибка выше рассчитана для всего набора, а не для каждого сектора. Расчёт не оценивает вероятность поломки.</p>${data.sector_forecasts.map(s=>`<div class="forecast-row"><span>${escapeHtml(s.zone)}</span><strong>${s.expected.toLocaleString('ru-RU')}</strong></div>`).join('')}`:''}`;
  $('#analytics-content').append(evaluation);
  const overview=document.createElement('section');overview.className='chart-panel problem-panel operational-panel';
  overview.innerHTML=`<h2>Что требует внимания</h2><dl class="operational-summary"><div><dt>Открытые проблемы</dt><dd>${data.open_problems}</dd></div><div><dt>Просроченные проблемы</dt><dd>${data.overdue_problems}</dd></div><div><dt>Повторы после ремонта</dt><dd>${data.recurrences}</dd></div></dl><p class="field-help">Срок истекает в конце выбранного дня по времени Нерюнгри. В повторах учитываются и уже решённые проблемы.</p>`;
  const urgent=state.reports.filter(r=>r.id===r.problem_id&&r.status!=='resolved').sort((a,b)=>{
    const overdue=r=>Boolean(r.due_date&&r.due_date<state.meta.today);
    return overdue(b)-overdue(a)||({high:0,medium:1,normal:2}[a.priority]-{high:0,medium:1,normal:2}[b.priority])||(a.due_date||'9999').localeCompare(b.due_date||'9999');
  });
  overview.insertAdjacentHTML('beforeend',urgent.length?`<div class="attention-list">${urgent.slice(0,8).map(r=>`<button type="button" class="attention-row" data-report="${r.id}"><strong>${r.reference} · ${escapeHtml(r.category_label)}</strong><span>${escapeHtml(r.address||r.text)}</span><span>${escapeHtml(r.assignee||'Не назначен')} · ${r.due_date?`Срок: ${r.due_date}${r.due_date<state.meta.today?' · просрочен':''}`:'Срок не указан'}</span></button>`).join('')}</div>${urgent.length>8?'<p class="field-help">Показаны первые 8 проблем по просрочке, приоритету и сроку. Все обращения доступны в реестре.</p>':''}`:'<p>Открытых проблем нет.</p>');
  $('#analytics-content').prepend(overview);
  if(!data.forecasts.length&&!e.available){
    $('.forecast-panel').remove();evaluation.innerHTML='<h2>Прогноз пока недоступен</h2><p>Для оценки нужны 28 дней полной истории и 30 обращений. Для проверки точности: 56 дней и 60 обращений.</p><button type="button" class="text-button" data-action="import">Загрузить историю</button>';
  }
  // Retain the desktop table and expose the same values as expandable rows on phones.
  $$('.data-table').forEach(table=>{
    const headings=[...table.querySelectorAll('thead th')].map(el=>el.textContent);
    const mobile=document.createElement('div');mobile.className='mobile-data-rows';
    mobile.innerHTML=`<h3>${escapeHtml(table.caption.textContent)}</h3>`+[...table.querySelectorAll('tbody tr')].map(row=>{
      const cells=[...row.children].map(el=>el.textContent);
      return `<details><summary>${escapeHtml(cells[0])}</summary><dl>${cells.slice(1).map((value,i)=>`<dt>${escapeHtml(headings[i+1])}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl></details>`;
    }).join('');table.parentElement.after(mobile);
  });
}
