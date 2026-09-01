'use strict';

/* ---------- Константы и утилиты ---------- */

const STORAGE_KEY = 'salary-calculator-v1';
const AVG_MONTH_DAYS = 29.3;

const ABSENCE_TYPES = {
  vacation: { label: 'Отпуск', short: 'Отпуск', cls: 'vacation' },
  sick: { label: 'Больничный', short: 'Больничный', cls: 'sick' },
  unpaid: { label: 'За свой счёт', short: 'За свой счёт', cls: 'unpaid' },
};

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value) {
  const n = round2(Number(value) || 0);
  const text = n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return text.replace(/\u00A0/g, ' ') + ' ₽';
}

function formatMoneyShort(value) {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString('ru-RU').replace(/\u00A0/g, ' ') + ' ₽';
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid() {
  return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function num(value) {
  const n = Number(String(value == null ? '' : value).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/* ---------- Работа с датами ---------- */

function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function monthKeyOf(date) {
  return date.toISOString().slice(0, 7);
}

function monthBounds(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
}

function monthTitle(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return MONTH_NAMES[m - 1] + ' ' + y;
}

function prevMonthKey(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return monthKeyOf(d);
}

function daysBetweenInclusive(from, to) {
  return Math.floor((to - from) / 86400000) + 1;
}

/** Рабочие дни по графику 5/2 (пн–пт), без учёта праздников. */
function workdaysBetween(from, to) {
  let count = 0;
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) count += 1;
  }
  return count;
}

function formatDayMonth(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return dd + '.' + mm;
}

/* ---------- Состояние ---------- */

const defaultMonthRecord = () => ({
  oklad: 0, plan: 0, norm: 21, manual: 0,
  revenueOut: 0, revenueIn: 0, comment: '',
});

let state = { version: 1, employees: [], months: {} };
let currentMonth = monthKeyOf(new Date());
const openRows = new Set();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.employees) && parsed.months) {
      state = { version: 1, employees: parsed.employees, months: parsed.months };
      if (parsed.currentMonth) currentMonth = parsed.currentMonth;
    }
  } catch (err) {
    console.warn('Не удалось прочитать сохранённые данные', err);
  }
}

function saveState() {
  const payload = JSON.stringify({ ...state, currentMonth });
  localStorage.setItem(STORAGE_KEY, payload);
  flashSaved();
}

let savedTimer = null;
function flashSaved() {
  const badge = document.getElementById('savedBadge');
  badge.textContent = 'Сохранено';
  badge.style.opacity = '0.4';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { badge.style.opacity = '1'; }, 200);
}

function monthRecord(empId, monthKey = currentMonth) {
  if (!state.months[monthKey]) state.months[monthKey] = {};
  if (!state.months[monthKey][empId]) state.months[monthKey][empId] = defaultMonthRecord();
  return state.months[monthKey][empId];
}

function findEmployee(empId) {
  return state.employees.find((e) => e.id === empId);
}

/* ---------- Отсутствия ---------- */

/** Часть отсутствия, попадающая в указанный месяц. */
function absenceInMonth(absence, monthKey) {
  const start = parseDate(absence.start);
  const end = parseDate(absence.end);
  if (!start || !end || end < start) return null;
  const { from, to } = monthBounds(monthKey);
  const a = start > from ? start : from;
  const b = end < to ? end : to;
  if (a > b) return null;
  const calendarDays = daysBetweenInclusive(a, b);
  const defaultWorkDays = workdaysBetween(a, b);
  const override = absence.overrides && absence.overrides[monthKey];
  const workDays = override === undefined || override === null || override === ''
    ? defaultWorkDays
    : Math.max(0, num(override));
  return {
    type: absence.type,
    calendarDays,
    defaultWorkDays,
    workDays,
    from: toIso(a),
    to: toIso(b),
  };
}

function absencesOfMonth(employee, monthKey) {
  return (employee.absences || [])
    .map((a) => ({ absence: a, part: absenceInMonth(a, monthKey) }))
    .filter((x) => x.part !== null);
}

function absencesOverlap(a, b) {
  const aStart = parseDate(a.start);
  const aEnd = parseDate(a.end);
  const bStart = parseDate(b.start);
  const bEnd = parseDate(b.end);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

/* ---------- Расчёт ---------- */

function calcEmployee(employee, monthKey = currentMonth) {
  const rec = monthRecord(employee.id, monthKey);
  const oklad = num(rec.oklad);
  const plan = num(rec.plan);
  const kpi = plan - oklad;
  const norm = num(rec.norm);

  let vacationCal = 0, vacationWork = 0;
  let sickCal = 0, sickWork = 0;
  let unpaidCal = 0, unpaidWork = 0;

  for (const { part } of absencesOfMonth(employee, monthKey)) {
    if (part.type === 'vacation') { vacationCal += part.calendarDays; vacationWork += part.workDays; }
    else if (part.type === 'sick') { sickCal += part.calendarDays; sickWork += part.workDays; }
    else { unpaidCal += part.calendarDays; unpaidWork += part.workDays; }
  }

  const missedWork = vacationWork + sickWork + unpaidWork;
  const worked = Math.max(0, norm - missedWork);
  const ratio = norm > 0 ? worked / norm : 0;

  const okladWork = round2(oklad * ratio);
  const kpiWork = round2(kpi * ratio);
  const salaryWork = round2(plan * ratio);
  const vacationPay = round2(oklad / AVG_MONTH_DAYS * vacationCal);
  const sickPay = round2(oklad / AVG_MONTH_DAYS * sickCal);
  const manual = num(rec.manual);
  const total = round2(salaryWork + vacationPay + sickPay + manual);

  const revenueOut = num(rec.revenueOut);
  const revenueIn = num(rec.revenueIn);
  const profit = round2(revenueOut - revenueIn);

  return {
    rec, oklad, plan, kpi, norm,
    vacationCal, vacationWork, sickCal, sickWork, unpaidCal, unpaidWork,
    missedWork, worked, okladWork, kpiWork, salaryWork,
    vacationPay, sickPay, manual, total,
    revenueOut, revenueIn, profit,
    hasAbsence: vacationCal + sickCal + unpaidCal > 0,
  };
}

function validate() {
  const problems = [];
  for (const emp of state.employees) {
    const c = calcEmployee(emp);
    const who = emp.name || 'Без имени';
    if (c.oklad < 0 || c.plan < 0 || c.norm < 0 || c.revenueOut < 0 || c.revenueIn < 0) {
      problems.push(`${who}: отрицательные значения не допускаются.`);
    }
    if (c.plan < c.oklad) {
      problems.push(`${who}: плановая зарплата с KPI меньше оклада — KPI получается отрицательным.`);
    }
    if (c.norm <= 0) {
      problems.push(`${who}: укажите норму рабочих дней или смен больше нуля.`);
    }
    if (c.missedWork > c.norm) {
      problems.push(`${who}: пропущено ${c.missedWork} рабочих дней при норме ${c.norm}.`);
    }
    const list = emp.absences || [];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (absencesOverlap(list[i], list[j])) {
          problems.push(`${who}: периоды отсутствий пересекаются (${list[i].start} — ${list[i].end} и ${list[j].start} — ${list[j].end}).`);
        }
      }
    }
  }
  return problems;
}

/* ---------- Отрисовка ---------- */

function moneyCell(value, colorize) {
  if (!value) return '<span class="dash">–</span>';
  const cls = colorize ? (value > 0 ? 'money-pos' : 'money-neg') : '';
  return `<span class="${cls}">${escapeHtml(formatMoney(value))}</span>`;
}

function absenceTags(employee) {
  const parts = absencesOfMonth(employee, currentMonth);
  if (!parts.length) return '<span class="dash">–</span>';
  return parts.map(({ part }) => {
    const meta = ABSENCE_TYPES[part.type];
    return `<span class="tag ${meta.cls}">${meta.short} ${formatDayMonth(part.from)}–${formatDayMonth(part.to)}</span>`;
  }).join('');
}

function renderSummary() {
  const totals = state.employees.reduce((acc, emp) => {
    const c = calcEmployee(emp);
    acc.pay += c.total;
    acc.profit += c.profit;
    if (c.hasAbsence) acc.absent += 1;
    return acc;
  }, { pay: 0, profit: 0, absent: 0 });

  document.getElementById('summary').innerHTML = `
    <div class="stat"><div class="bubble">👥</div><div><div class="label">Сотрудников</div><div class="value">${state.employees.length}</div></div></div>
    <div class="stat green"><div class="bubble">💰</div><div><div class="label">К выплате</div><div class="value">${escapeHtml(formatMoneyShort(totals.pay))}</div></div></div>
    <div class="stat green"><div class="bubble">📈</div><div><div class="label">Прибыль</div><div class="value">${escapeHtml(formatMoneyShort(totals.profit))}</div></div></div>
    <div class="stat amber"><div class="bubble">📆</div><div><div class="label">Отсутствуют</div><div class="value">${totals.absent}</div></div></div>`;
}

function renderErrors() {
  const box = document.getElementById('errors');
  const problems = validate();
  if (!problems.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<strong>Проверьте данные:</strong><ul>' +
    problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('') + '</ul>';
}

function field(empId, name, label, value, opts = {}) {
  const type = opts.type || 'number';
  const attrs = [
    `data-emp="${empId}"`,
    `data-field="${name}"`,
    `type="${type}"`,
    opts.readonly ? 'readonly' : '',
    opts.min !== undefined ? `min="${opts.min}"` : '',
    type === 'number' ? 'step="0.01"' : '',
  ].filter(Boolean).join(' ');
  return `<label class="field"><span>${escapeHtml(label)}</span><input ${attrs} value="${escapeHtml(value)}"></label>`;
}

function renderAbsenceList(employee) {
  const list = employee.absences || [];
  if (!list.length) return '<p class="abs-sub">Отсутствий нет.</p>';
  return '<ul class="abs-list">' + list.map((a) => {
    const meta = ABSENCE_TYPES[a.type];
    const part = absenceInMonth(a, currentMonth);
    const inMonth = part
      ? `В ${monthTitle(currentMonth)}: ${part.calendarDays} кал. дн.`
      : 'В выбранном месяце нет';
    const overrideInput = part
      ? `<label class="field"><span>Пропущено раб. дней</span><input class="days" type="number" min="0" step="1"
          data-abs-days="${a.id}" data-emp="${employee.id}" value="${part.workDays}"></label>`
      : '';
    return `<li>
        <div class="abs-main">
          <div><strong>${meta.label}</strong> ${escapeHtml(a.start)} — ${escapeHtml(a.end)}</div>
          <div class="abs-sub">${escapeHtml(inMonth)} · всего ${daysBetweenInclusive(parseDate(a.start), parseDate(a.end))} кал. дн.</div>
        </div>
        ${overrideInput}
        <button class="btn" data-abs-edit="${a.id}" data-emp="${employee.id}">Изменить</button>
        <button class="btn btn-danger" data-abs-del="${a.id}" data-emp="${employee.id}">Удалить</button>
      </li>`;
  }).join('') + '</ul>';
}

function renderDetail(employee, c) {
  const id = employee.id;
  return `<div class="detail">
    <div class="detail-head">
      <h3>Расчёт ${escapeHtml(employee.name || 'сотрудника')}</h3>
      <div>
        <button class="btn btn-ghost" data-abs-add="${id}">＋ Отсутствие</button>
        <button class="btn btn-danger" data-emp-del="${id}">Удалить сотрудника</button>
      </div>
    </div>
    <div class="fields">
      ${field(id, 'name', 'Имя', employee.name, { type: 'text' })}
      ${field(id, 'position', 'Должность', employee.position, { type: 'text' })}
      ${field(id, 'oklad', 'Оклад', c.rec.oklad, { min: 0 })}
      ${field(id, 'plan', 'Плановая зарплата с KPI', c.rec.plan, { min: 0 })}
      ${field(id, 'kpi', 'KPI (авто)', c.kpi, { readonly: true })}
      ${field(id, 'norm', 'Норма дней или смен', c.rec.norm, { min: 0 })}
      ${field(id, 'worked', 'Отработано (авто)', c.worked, { readonly: true })}
      ${field(id, 'vacationDays', 'Отпуск, кал./раб. дн.', `${c.vacationCal} / ${c.vacationWork}`, { type: 'text', readonly: true })}
      ${field(id, 'sickDays', 'Больничный, кал./раб. дн.', `${c.sickCal} / ${c.sickWork}`, { type: 'text', readonly: true })}
      ${field(id, 'unpaidDays', 'За свой счёт, кал./раб. дн.', `${c.unpaidCal} / ${c.unpaidWork}`, { type: 'text', readonly: true })}
      ${field(id, 'manual', 'Доплата или корректировка', c.rec.manual)}
      ${field(id, 'revenueOut', 'Оборот выход', c.rec.revenueOut, { min: 0 })}
      ${field(id, 'revenueIn', 'Оборот вход', c.rec.revenueIn, { min: 0 })}
      ${field(id, 'comment', 'Комментарий', c.rec.comment, { type: 'text' })}
    </div>
    <div class="breakdown">
      <div class="line"><span>Оклад за работу</span><span>${escapeHtml(formatMoney(c.okladWork))}</span></div>
      <div class="line"><span>KPI за работу</span><span>${escapeHtml(formatMoney(c.kpiWork))}</span></div>
      <div class="line"><span>Зарплата за работу</span><span>${escapeHtml(formatMoney(c.salaryWork))}</span></div>
      <div class="line"><span>Отпускные</span><span>${escapeHtml(formatMoney(c.vacationPay))}</span></div>
      <div class="line"><span>Больничные</span><span>${escapeHtml(formatMoney(c.sickPay))}</span></div>
      <div class="line"><span>За свой счёт</span><span>${escapeHtml(formatMoney(0))}</span></div>
      <div class="line"><span>Корректировка</span><span>${escapeHtml(formatMoney(c.manual))}</span></div>
      <div class="line total"><span>Итого</span><span>${escapeHtml(formatMoney(c.total))}</span></div>
      <div class="line"><span>Прибыль</span><span>${escapeHtml(formatMoney(c.profit))}</span></div>
    </div>
    <h4>Отсутствия</h4>
    ${renderAbsenceList(employee)}
  </div>`;
}

function renderTable() {
  const body = document.getElementById('gridBody');
  body.innerHTML = state.employees.map((emp) => {
    const c = calcEmployee(emp);
    const open = openRows.has(emp.id);
    const main = `<tr class="${open ? 'row-open' : ''}" data-row="${emp.id}">
      <td class="left"><button class="toggle" data-toggle="${emp.id}">${open ? '⌄' : '›'}</button></td>
      <td class="left"><span class="name-link" data-toggle="${emp.id}">${escapeHtml(emp.name || 'Без имени')}</span></td>
      <td class="left pos">${escapeHtml(emp.position || '–')}</td>
      <td>${escapeHtml(formatMoneyShort(c.oklad))}</td>
      <td>${escapeHtml(formatMoneyShort(c.plan))}</td>
      <td>${c.worked} из ${c.norm}</td>
      <td class="left">${absenceTags(emp)}</td>
      <td>${moneyCell(c.vacationPay, false)}</td>
      <td>${c.revenueOut ? escapeHtml(formatMoneyShort(c.revenueOut)) : '<span class="dash">–</span>'}</td>
      <td>${c.revenueIn ? escapeHtml(formatMoneyShort(c.revenueIn)) : '<span class="dash">–</span>'}</td>
      <td>${c.profit ? `<span class="${c.profit > 0 ? 'money-pos' : 'money-neg'}">${escapeHtml(formatMoneyShort(c.profit))}</span>` : '<span class="dash">–</span>'}</td>
      <td><strong>${escapeHtml(formatMoney(c.total))}</strong></td>
    </tr>`;
    const detail = open
      ? `<tr class="detail-row"><td colspan="12">${renderDetail(emp, c)}</td></tr>`
      : '';
    return main + detail;
  }).join('');
}

function renderMobile() {
  const list = document.getElementById('mobileList');
  list.innerHTML = state.employees.map((emp) => {
    const c = calcEmployee(emp);
    const open = openRows.has(emp.id);
    return `<article class="emp-card">
      <div class="head">
        <div>
          <div class="name" data-toggle="${emp.id}">${escapeHtml(emp.name || 'Без имени')}</div>
          <div class="pos">${escapeHtml(emp.position || '')}</div>
        </div>
        <button class="btn" data-toggle="${emp.id}">${open ? 'Свернуть' : 'Подробнее'}</button>
      </div>
      <div>${absenceTags(emp)}</div>
      <div class="rows">
        <div class="line"><span>Отработано</span><span>${c.worked} из ${c.norm}</span></div>
        <div class="line"><span>Зарплата за работу</span><span>${escapeHtml(formatMoney(c.salaryWork))}</span></div>
        <div class="line"><span>Отпускные</span><span>${escapeHtml(formatMoney(c.vacationPay))}</span></div>
        <div class="line"><span>Прибыль</span><span>${escapeHtml(formatMoney(c.profit))}</span></div>
      </div>
      <div class="line"><span class="pos">Итого</span></div>
      <div class="total">${escapeHtml(formatMoney(c.total))}</div>
      ${open ? renderDetail(emp, c) : ''}
    </article>`;
  }).join('');
}

function render() {
  document.getElementById('monthInput').value = currentMonth;
  renderSummary();
  renderErrors();
  renderTable();
  renderMobile();
  document.getElementById('emptyHint').hidden = state.employees.length > 0;
}

/* ---------- Действия ---------- */

function addEmployee() {
  const emp = { id: uid(), name: 'Новый сотрудник', position: '', absences: [] };
  state.employees.push(emp);
  monthRecord(emp.id);
  openRows.add(emp.id);
  saveState();
  render();
}

function deleteEmployee(empId) {
  if (!confirm('Удалить сотрудника вместе со всеми его данными?')) return;
  state.employees = state.employees.filter((e) => e.id !== empId);
  for (const key of Object.keys(state.months)) delete state.months[key][empId];
  openRows.delete(empId);
  saveState();
  render();
}

function copyPreviousMonth() {
  const prev = prevMonthKey(currentMonth);
  const source = state.months[prev];
  if (!source || !Object.keys(source).length) {
    alert('В месяце ' + monthTitle(prev) + ' нет данных для копирования.');
    return;
  }
  if (!confirm('Скопировать данные из месяца ' + monthTitle(prev) + '? Текущие значения будут заменены.')) return;
  state.months[currentMonth] = state.months[currentMonth] || {};
  for (const emp of state.employees) {
    if (source[emp.id]) state.months[currentMonth][emp.id] = { ...source[emp.id] };
  }
  saveState();
  render();
}

function setEmployeeField(empId, fieldName, value) {
  const emp = findEmployee(empId);
  if (!emp) return;
  if (fieldName === 'name' || fieldName === 'position') {
    emp[fieldName] = value;
  } else if (fieldName === 'comment') {
    monthRecord(empId).comment = value;
  } else {
    monthRecord(empId)[fieldName] = value === '' ? 0 : num(value);
  }
  saveState();
}

/* ---------- Модальное окно отсутствия ---------- */

let modalContext = null;

function openAbsenceModal(empId, absenceId) {
  const emp = findEmployee(empId);
  if (!emp) return;
  const existing = (emp.absences || []).find((a) => a.id === absenceId);
  const { from } = monthBounds(currentMonth);
  const defaults = existing || { type: 'vacation', start: toIso(from), end: toIso(from) };
  modalContext = { empId, absenceId: absenceId || null };

  document.getElementById('modalTitle').textContent = existing ? 'Изменить отсутствие' : 'Добавить отсутствие';
  document.getElementById('modalBody').innerHTML = `
    <label class="field"><span>Тип</span>
      <select id="absType">
        ${Object.entries(ABSENCE_TYPES).map(([key, meta]) =>
          `<option value="${key}" ${defaults.type === key ? 'selected' : ''}>${meta.label}</option>`).join('')}
      </select>
    </label>
    <label class="field"><span>Дата начала</span><input type="date" id="absStart" value="${escapeHtml(defaults.start)}"></label>
    <label class="field"><span>Дата окончания</span><input type="date" id="absEnd" value="${escapeHtml(defaults.end)}"></label>
    <label class="field"><span>Календарных дней (авто)</span><input type="text" id="absCal" readonly></label>
    <label class="field"><span>Пропущено рабочих дней 5/2 (авто)</span><input type="text" id="absWork" readonly></label>
    <div class="modal-error" id="absError"></div>`;

  const refresh = () => {
    const s = parseDate(document.getElementById('absStart').value);
    const e = parseDate(document.getElementById('absEnd').value);
    const ok = s && e && e >= s;
    document.getElementById('absCal').value = ok ? daysBetweenInclusive(s, e) : '—';
    document.getElementById('absWork').value = ok ? workdaysBetween(s, e) : '—';
  };
  document.getElementById('absStart').addEventListener('input', refresh);
  document.getElementById('absEnd').addEventListener('input', refresh);
  refresh();
  document.getElementById('modal').hidden = false;
}

function closeModal() {
  document.getElementById('modal').hidden = true;
  modalContext = null;
}

function saveAbsence() {
  if (!modalContext) return;
  const emp = findEmployee(modalContext.empId);
  if (!emp) return;
  const type = document.getElementById('absType').value;
  const start = document.getElementById('absStart').value;
  const end = document.getElementById('absEnd').value;
  const errorBox = document.getElementById('absError');
  const s = parseDate(start);
  const e = parseDate(end);

  if (!s || !e) { errorBox.textContent = 'Укажите обе даты.'; return; }
  if (e < s) { errorBox.textContent = 'Дата окончания раньше даты начала.'; return; }

  const candidate = { id: modalContext.absenceId || uid(), type, start, end, overrides: {} };
  const others = (emp.absences || []).filter((a) => a.id !== candidate.id);
  if (others.some((a) => absencesOverlap(a, candidate))) {
    errorBox.textContent = 'Период пересекается с другим отсутствием этого сотрудника.';
    return;
  }

  emp.absences = emp.absences || [];
  const index = emp.absences.findIndex((a) => a.id === candidate.id);
  if (index >= 0) emp.absences[index] = { ...emp.absences[index], ...candidate, overrides: {} };
  else emp.absences.push(candidate);
  emp.absences.sort((a, b) => a.start.localeCompare(b.start));

  saveState();
  closeModal();
  render();
}

/* ---------- Экспорт и импорт ---------- */

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CSV_HEADERS = ['Имя', 'Должность', 'Оклад', 'Плановая ЗП с KPI', 'KPI', 'Норма дней',
  'Отработано', 'Отпуск кал.', 'Отпуск раб.', 'Больничный кал.', 'Больничный раб.',
  'За свой счёт кал.', 'За свой счёт раб.', 'Оклад за работу', 'KPI за работу', 'Отпускные',
  'Больничные', 'Корректировка', 'Итого', 'Оборот выход', 'Оборот вход', 'Прибыль', 'Комментарий'];

function csvValue(value) {
  const text = typeof value === 'number' ? String(round2(value)).replace('.', ',') : String(value ?? '');
  return '"' + text.replace(/"/g, '""') + '"';
}

function exportCsv() {
  const rows = [CSV_HEADERS.map(csvValue).join(';')];
  for (const emp of state.employees) {
    const c = calcEmployee(emp);
    rows.push([
      emp.name, emp.position, c.oklad, c.plan, c.kpi, c.norm, c.worked,
      c.vacationCal, c.vacationWork, c.sickCal, c.sickWork, c.unpaidCal, c.unpaidWork,
      c.okladWork, c.kpiWork, c.vacationPay, c.sickPay, c.manual, c.total,
      c.revenueOut, c.revenueIn, c.profit, c.rec.comment,
    ].map(csvValue).join(';'));
  }
  download(`zarplata-${currentMonth}.csv`, '\uFEFF' + rows.join('\r\n'), 'text/csv;charset=utf-8');
}

function exportBackup() {
  download(`zarplata-backup-${currentMonth}.json`,
    JSON.stringify({ ...state, currentMonth }, null, 2), 'application/json');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed || !Array.isArray(parsed.employees) || typeof parsed.months !== 'object') {
        throw new Error('Неверный формат файла');
      }
      if (!confirm('Заменить текущие данные данными из файла?')) return;
      state = { version: 1, employees: parsed.employees, months: parsed.months };
      if (parsed.currentMonth) currentMonth = parsed.currentMonth;
      openRows.clear();
      saveState();
      render();
      alert('Резервная копия загружена.');
    } catch (err) {
      alert('Не удалось прочитать файл: ' + err.message);
    }
  };
  reader.readAsText(file);
}

/* ---------- События ---------- */

function onInput(event) {
  const target = event.target;
  if (target.dataset.field && !target.readOnly) {
    setEmployeeField(target.dataset.emp, target.dataset.field, target.value);
    renderSummary();
    renderErrors();
    updateComputedFields(target.dataset.emp);
    return;
  }
  if (target.dataset.absDays) {
    const emp = findEmployee(target.dataset.emp);
    const absence = emp && (emp.absences || []).find((a) => a.id === target.dataset.absDays);
    if (!absence) return;
    absence.overrides = absence.overrides || {};
    absence.overrides[currentMonth] = Math.max(0, num(target.value));
    saveState();
    renderSummary();
    renderErrors();
    updateComputedFields(emp.id);
  }
}

function updateComputedFields(empId) {
  const emp = findEmployee(empId);
  if (!emp) return;
  const c = calcEmployee(emp);
  const scope = document.querySelectorAll(`[data-emp="${empId}"][data-field]`);
  scope.forEach((input) => {
    if (!input.readOnly) return;
    if (input.dataset.field === 'kpi') input.value = c.kpi;
    if (input.dataset.field === 'worked') input.value = c.worked;
  });
  const detailBlocks = document.querySelectorAll(`[data-abs-add="${empId}"]`);
  detailBlocks.forEach((btn) => {
    const detail = btn.closest('.detail');
    if (!detail) return;
    const lines = detail.querySelectorAll('.breakdown .line span:last-child');
    const values = [c.okladWork, c.kpiWork, c.salaryWork, c.vacationPay, c.sickPay, 0, c.manual, c.total, c.profit];
    lines.forEach((span, i) => { span.textContent = formatMoney(values[i]); });
  });
}

function onClick(event) {
  const target = event.target.closest('[data-toggle], [data-abs-add], [data-abs-edit], [data-abs-del], [data-emp-del]');
  if (!target) return;
  if (target.dataset.toggle) {
    const id = target.dataset.toggle;
    if (openRows.has(id)) openRows.delete(id); else openRows.add(id);
    render();
  } else if (target.dataset.absAdd) {
    openAbsenceModal(target.dataset.absAdd, null);
  } else if (target.dataset.absEdit) {
    openAbsenceModal(target.dataset.emp, target.dataset.absEdit);
  } else if (target.dataset.absDel) {
    const emp = findEmployee(target.dataset.emp);
    if (emp && confirm('Удалить это отсутствие?')) {
      emp.absences = emp.absences.filter((a) => a.id !== target.dataset.absDel);
      saveState();
      render();
    }
  } else if (target.dataset.empDel) {
    deleteEmployee(target.dataset.empDel);
  }
}

function init() {
  loadState();
  document.getElementById('monthInput').value = currentMonth;

  document.getElementById('monthInput').addEventListener('change', (e) => {
    if (!e.target.value) return;
    currentMonth = e.target.value;
    saveState();
    render();
  });
  document.getElementById('btnAdd').addEventListener('click', addEmployee);
  document.getElementById('btnCopy').addEventListener('click', copyPreviousMonth);
  document.getElementById('btnCalc').addEventListener('click', () => { saveState(); render(); });
  document.getElementById('btnCsv').addEventListener('click', exportCsv);
  document.getElementById('btnBackup').addEventListener('click', exportBackup);
  document.getElementById('btnRestore').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalSave').addEventListener('click', saveAbsence);
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });

  document.addEventListener('input', onInput);
  document.addEventListener('click', onClick);

  render();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    round2,
    formatMoney,
    workdaysBetween,
    daysBetweenInclusive,
    parseDate,
    calcEmployee,
    validate,
    setTestState: (nextState, monthKey) => { state = nextState; currentMonth = monthKey; },
  };
}
