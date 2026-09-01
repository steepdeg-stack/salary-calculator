'use strict';

/* ---------- Константы и утилиты ---------- */

const CAL = typeof ProductionCalendar !== 'undefined'
  ? ProductionCalendar
  : require('./calendar.js');

const STORAGE_KEY = 'salary-calculator-v1';
const AVG_MONTH_DAYS = 29.3;
const DIRECTOR_VACATION_PAY = 60000;
const MANAGER_FIRST_PAYMENT = 60000;

const PAY_TYPES = { manager: 'Менеджер', director: 'Руководитель' };

const ABSENCE_TYPES = {
  vacation: { label: 'Отпуск', short: 'Отпуск', cls: 'vacation' },
  sick: { label: 'Больничный', short: 'Больничный', cls: 'sick' },
  unpaid: { label: 'За свой счёт', short: 'За свой счёт', cls: 'unpaid' },
};

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const WEEKDAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

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

/** Пустое поле трактуется как ноль. */
function num(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(String(value).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Значение денежного поля для показа в input: 0 из старых данных не мешает вводу. */
function fieldValue(value) {
  if (value === '' || value === null || value === undefined) return '';
  return String(value);
}

/* ---------- Работа с датами ---------- */

function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
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
  return shiftMonthKey(monthKey, -1);
}

function shiftMonthKey(monthKey, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey));
  if (!match || !Number.isInteger(delta)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const index = year * 12 + month - 1 + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = ((index % 12) + 12) % 12 + 1;
  if (nextYear < 1900 || nextYear > 9999) return null;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

function monthKeyFromParts(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 1900 || y > 9999 || !Number.isInteger(m) || m < 1 || m > 12) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

function normalizeMonthKey(value, fallback = monthKeyOf(new Date())) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  return match ? (monthKeyFromParts(match[1], match[2]) || fallback) : fallback;
}

function daysBetweenInclusive(from, to) {
  return Math.floor((to - from) / 86400000) + 1;
}

function formatDayMonth(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isValidIsoDate(value) {
  const text = String(value || '');
  const parsed = parseDate(text);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && parsed !== null && toIso(parsed) === text;
}

/* ---------- Состояние ---------- */

const emptyPayment = () => ({ amount: '', paidAmount: null, paidDate: '' });

const defaultMonthRecord = () => ({
  oklad: '', plan: '', norm: '', normManual: false,
  bonus: '', seniority: '', penalty: '', manual: '',
  revenueOut: '', revenueIn: '', comment: '',
  payments: { first: emptyPayment(), second: emptyPayment() },
});

let state = { version: 2, employees: [], months: {} };
let currentMonth = monthKeyOf(new Date());
const openRows = new Set();

function normalizeAbsences(absences) {
  const usedIds = new Set();
  return (Array.isArray(absences) ? absences : []).map((absence) => {
    let id = absence && absence.id !== undefined && absence.id !== null
      ? String(absence.id)
      : '';
    if (!id || usedIds.has(id)) id = uid();
    usedIds.add(id);
    return {
      ...(absence || {}),
      id,
      type: absence && ABSENCE_TYPES[absence.type] ? absence.type : 'vacation',
      start: absence && absence.start ? String(absence.start) : '',
      end: absence && absence.end ? String(absence.end) : '',
      overrides: absence && absence.overrides && typeof absence.overrides === 'object'
        ? { ...absence.overrides }
        : {},
    };
  });
}

/** Приводит данные любой версии (в том числе резервные копии v1) к текущей схеме. */
function migrate(raw) {
  const employees = (raw.employees || []).map((emp) => ({
    id: String(emp.id || uid()),
    name: emp.name || '',
    position: emp.position || '',
    payType: PAY_TYPES[emp.payType] ? emp.payType : 'manager',
    hireDate: emp.hireDate || '',
    absences: normalizeAbsences(emp.absences),
  }));
  const months = {};
  for (const [monthKey, byEmployee] of Object.entries(raw.months || {})) {
    months[monthKey] = {};
    for (const [empId, rec] of Object.entries(byEmployee || {})) {
      const payments = rec.payments || {};
      months[monthKey][empId] = {
        ...defaultMonthRecord(),
        ...rec,
        // В первой версии норма всегда вводилась вручную.
        normManual: rec.normManual === undefined ? rec.norm !== undefined && rec.norm !== '' : !!rec.normManual,
        payments: {
          first: { ...emptyPayment(), ...(payments.first || {}) },
          second: { ...emptyPayment(), ...(payments.second || {}) },
        },
      };
    }
  }
  return { version: 2, employees, months };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.employees) && parsed.months) {
      state = migrate(parsed);
      if (parsed.currentMonth) currentMonth = normalizeMonthKey(parsed.currentMonth, currentMonth);
    }
  } catch (err) {
    console.warn('Не удалось прочитать сохранённые данные', err);
  }
}

const hasDom = typeof document !== 'undefined';

function saveState() {
  if (!hasDom) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, currentMonth }));
  flashSaved();
}

let savedTimer = null;
function flashSaved() {
  const badge = document.getElementById('savedBadge');
  if (!badge) return;
  badge.style.opacity = '0.4';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { badge.style.opacity = '1'; }, 200);
}

function monthRecord(empId, monthKey = currentMonth) {
  if (!state.months[monthKey]) state.months[monthKey] = {};
  if (!state.months[monthKey][empId]) state.months[monthKey][empId] = defaultMonthRecord();
  const rec = state.months[monthKey][empId];
  if (!rec.payments) rec.payments = { first: emptyPayment(), second: emptyPayment() };
  return rec;
}

function findEmployee(empId) {
  return state.employees.find((e) => String(e.id) === String(empId));
}

/* ---------- Отсутствия ---------- */

function absenceInMonth(absence, monthKey) {
  const start = parseDate(absence.start);
  const end = parseDate(absence.end);
  if (!start || !end || end < start) return null;
  const { from, to } = monthBounds(monthKey);
  const a = start > from ? start : from;
  const b = end < to ? end : to;
  if (a > b) return null;
  const override = absence.overrides && absence.overrides[monthKey];
  const defaultWorkDays = CAL.workdaysBetween(a, b);
  return {
    type: absence.type,
    calendarDays: daysBetweenInclusive(a, b),
    defaultWorkDays,
    workDays: override === undefined || override === null || override === ''
      ? defaultWorkDays
      : Math.max(0, num(override)),
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

function validateAbsenceDraft(employee, draft, editingId = null) {
  const type = draft && draft.type;
  const start = draft && String(draft.start || '');
  const end = draft && String(draft.end || '');
  if (!ABSENCE_TYPES[type]) return { ok: false, error: 'Выберите тип отсутствия.' };
  if (!start || !end) return { ok: false, error: 'Укажите обе даты.' };
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    return { ok: false, error: 'Укажите обе даты в формате ГГГГ-ММ-ДД.' };
  }
  const s = parseDate(start);
  const e = parseDate(end);
  if (e < s) return { ok: false, error: 'Дата окончания раньше даты начала.' };

  const editingKey = editingId === null || editingId === undefined ? null : String(editingId);
  const candidate = { type, start, end };
  const overlaps = (employee.absences || []).some((absence) =>
    String(absence.id) !== editingKey && absencesOverlap(absence, candidate));
  if (overlaps) {
    return { ok: false, error: 'Период пересекается с другим отсутствием этого сотрудника.' };
  }
  return { ok: true, value: candidate };
}

function upsertAbsence(employee, draft, editingId = null) {
  employee.absences = normalizeAbsences(employee.absences);
  const editingKey = editingId === null || editingId === undefined ? null : String(editingId);
  const index = editingKey === null
    ? -1
    : employee.absences.findIndex((absence) => absence.id === editingKey);
  if (editingKey !== null && index < 0) {
    return { ok: false, error: 'Сохранённое отсутствие не найдено. Закройте окно и повторите попытку.' };
  }

  const validation = validateAbsenceDraft(employee, draft, editingKey);
  if (!validation.ok) return validation;
  const existing = index >= 0 ? employee.absences[index] : null;
  const absence = {
    id: existing ? existing.id : uid(),
    ...validation.value,
    // Ручные рабочие дни могут относиться к нескольким месяцам и не должны
    // пропадать при повторном редактировании дат.
    overrides: existing ? { ...existing.overrides } : {},
  };
  if (index >= 0) employee.absences[index] = absence;
  else employee.absences.push(absence);
  employee.absences.sort((a, b) => a.start.localeCompare(b.start));
  return { ok: true, absence };
}

function deleteAbsence(employee, absenceId) {
  employee.absences = normalizeAbsences(employee.absences);
  const id = String(absenceId);
  const before = employee.absences.length;
  employee.absences = employee.absences.filter((absence) => absence.id !== id);
  return employee.absences.length < before;
}

/* ---------- Норма рабочих дней ---------- */

/** Норма от даты выхода на работу: с даты выхода включительно до конца месяца. */
function autoNorm(employee, monthKey) {
  const { from, to } = monthBounds(monthKey);
  const hire = parseDate(employee.hireDate);
  const start = hire && hire > from ? hire : from;
  if (hire && hire > to) return 0;
  return CAL.workdaysBetween(start, to);
}

function normHint(employee, monthKey) {
  const hire = parseDate(employee.hireDate);
  const { from, to } = monthBounds(monthKey);
  const auto = autoNorm(employee, monthKey);
  if (hire && hire > to) return 'Сотрудник ещё не вышел на работу в этом месяце';
  if (hire && hire > from) return `Вышел ${formatDayMonth(employee.hireDate)} — норма с даты выхода: ${auto} рабочих дней`;
  return `Норма месяца по производственному календарю: ${auto} рабочих дней`;
}

/* ---------- Расчёт ---------- */

function calcEmployee(employee, monthKey = currentMonth) {
  const rec = monthRecord(employee.id, monthKey);
  const oklad = num(rec.oklad);
  const plan = num(rec.plan);
  const fullKpi = Math.max(plan - oklad, 0);
  const auto = autoNorm(employee, monthKey);
  const norm = rec.normManual ? num(rec.norm) : auto;
  const isDirector = employee.payType === 'director';

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
  const kpiEarned = norm > 0 ? round2(fullKpi * worked / norm) : 0;

  // Оплачиваемый отпуск и больничный не уменьшают фиксированную часть по
  // существующим правилам. Дни за свой счёт уменьшают её пропорционально.
  const fixedWorked = Math.max(0, norm - unpaidWork);
  const fixedEarned = norm > 0 && unpaidWork > 0
    ? round2(oklad * fixedWorked / norm)
    : oklad;

  const vacationPay = isDirector
    ? (vacationCal > 0 ? DIRECTOR_VACATION_PAY : 0)
    : round2(oklad / AVG_MONTH_DAYS * vacationCal);
  const vacationPayAdded = isDirector ? vacationPay : 0;
  const sickPay = round2(oklad / AVG_MONTH_DAYS * sickCal);

  const bonus = num(rec.bonus);
  const seniority = num(rec.seniority);
  const penalty = num(rec.penalty);
  const manual = num(rec.manual);

  const accrued = round2(fixedEarned + kpiEarned + vacationPayAdded + sickPay
    + bonus + seniority - penalty + manual);

  const first = rec.payments.first;
  const second = rec.payments.second;
  const firstPlanned = first.amount !== '' ? num(first.amount) : (isDirector ? 0 : MANAGER_FIRST_PAYMENT);
  const paidTotal = round2((first.paidAmount || 0) + (second.paidAmount || 0));
  const remaining = round2(accrued - paidTotal);
  const secondPlanned = second.paidAmount !== null ? num(second.paidAmount) : Math.max(remaining, 0);

  const revenueOut = num(rec.revenueOut);
  const revenueIn = num(rec.revenueIn);

  return {
    rec, employee, isDirector,
    oklad, fixedEarned, plan, fullKpi, norm, autoNorm: auto,
    vacationCal, vacationWork, sickCal, sickWork, unpaidCal, unpaidWork,
    missedWork, worked, kpiEarned, vacationPay, vacationPayAdded, sickPay,
    bonus, seniority, penalty, manual, accrued,
    firstPlanned, secondPlanned, paidTotal, remaining,
    overpaid: remaining < 0 ? -remaining : 0,
    revenueOut, revenueIn, profit: round2(revenueOut - revenueIn),
    hasAbsence: vacationCal + sickCal + unpaidCal > 0,
  };
}

function validate() {
  const problems = [];
  for (const emp of state.employees) {
    const c = calcEmployee(emp);
    const who = emp.name || 'Без имени';
    const negative = [['Оклад', c.oklad], ['Плановая зарплата', c.plan], ['Норма', c.norm],
      ['Премия', c.bonus], ['Выслуга лет', c.seniority], ['Штрафы', c.penalty],
      ['Оборот выход', c.revenueOut], ['Оборот вход', c.revenueIn]]
      .filter(([, value]) => value < 0).map(([label]) => label);
    if (negative.length) {
      problems.push(`${who}: отрицательные значения не допускаются (${negative.join(', ')}). Минус разрешён только в ручной корректировке.`);
    }
    if (c.plan && c.plan < c.oklad) {
      problems.push(`${who}: плановая зарплата с KPI меньше оклада.`);
    }
    if (c.norm <= 0 && c.missedWork > 0) {
      problems.push(`${who}: норма рабочих дней равна нулю, но указаны отсутствия.`);
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

function out(empId, key, value) {
  return `<span data-out="${empId}:${key}">${escapeHtml(value)}</span>`;
}

function outputs(c) {
  const id = c.employee.id;
  return {
    oklad: formatMoney(c.oklad),
    okladShort: formatMoneyShort(c.oklad),
    fixedEarned: formatMoney(c.fixedEarned),
    planShort: formatMoneyShort(c.plan),
    fullKpi: formatMoney(c.fullKpi),
    kpiEarned: formatMoney(c.kpiEarned),
    vacationPay: formatMoney(c.vacationPay),
    sickPay: formatMoney(c.sickPay),
    bonus: formatMoney(c.bonus),
    seniority: formatMoney(c.seniority),
    penalty: formatMoney(c.penalty),
    manual: formatMoney(c.manual),
    accrued: formatMoney(c.accrued),
    paidTotal: formatMoney(c.paidTotal),
    remaining: c.remaining >= 0 ? formatMoney(c.remaining) : formatMoney(c.overpaid),
    remainingLabel: c.remaining >= 0 ? 'Остаток к выплате' : 'Переплата',
    profit: formatMoney(c.profit),
    worked: `${c.worked} из ${c.norm}`,
    normHint: normHint(c.employee, currentMonth),
    secondPlanned: formatMoney(c.secondPlanned),
    accruedShort: formatMoneyShort(c.accrued),
    paidShort: formatMoneyShort(c.paidTotal),
    remainingShort: (c.remaining >= 0 ? '' : '−') + formatMoneyShort(Math.abs(c.remaining)),
    profitShort: c.profit ? formatMoneyShort(c.profit) : '–',
    _id: id,
  };
}

function moneyField(empId, name, label, value, opts = {}) {
  const attrs = [
    `data-emp="${empId}"`,
    `data-field="${name}"`,
    'type="number"',
    'step="0.01"',
    'inputmode="decimal"',
    opts.allowNegative ? '' : 'min="0"',
    opts.placeholder ? `placeholder="${escapeHtml(opts.placeholder)}"` : 'placeholder="0"',
  ].filter(Boolean).join(' ');
  return `<label class="field"><span>${escapeHtml(label)}</span><input ${attrs} value="${escapeHtml(fieldValue(value))}"></label>`;
}

function textField(empId, name, label, value, type = 'text', opts = {}) {
  const attrs = [
    `data-emp="${empId}"`, `data-field="${name}"`, `type="${type}"`,
    opts.readonly ? 'readonly' : '',
  ].filter(Boolean).join(' ');
  return `<label class="field"><span>${escapeHtml(label)}</span><input ${attrs} value="${escapeHtml(fieldValue(value))}"></label>`;
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
    acc.accrued += c.accrued;
    acc.remaining += c.remaining;
    acc.profit += c.profit;
    if (c.hasAbsence) acc.absent += 1;
    return acc;
  }, { accrued: 0, remaining: 0, profit: 0, absent: 0 });

  document.getElementById('summary').innerHTML = `
    <div class="stat"><div class="bubble">👥</div><div><div class="label">Сотрудников</div><div class="value">${state.employees.length}</div></div></div>
    <div class="stat green"><div class="bubble">💰</div><div><div class="label">Начислено</div><div class="value">${escapeHtml(formatMoneyShort(totals.accrued))}</div></div></div>
    <div class="stat blue"><div class="bubble">🧾</div><div><div class="label">Остаток к выплате</div><div class="value">${escapeHtml(formatMoneyShort(totals.remaining))}</div></div></div>
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

function renderAbsenceList(employee) {
  const list = employee.absences || [];
  if (!list.length) return '<p class="abs-sub">Отсутствий нет.</p>';
  return '<ul class="abs-list">' + list.map((a) => {
    const meta = ABSENCE_TYPES[a.type];
    const part = absenceInMonth(a, currentMonth);
    const inMonth = part
      ? `В ${monthTitle(currentMonth)}: ${part.calendarDays} кал. дн. / ${part.workDays} раб. дн.`
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

function renderPayment(c, key, title, plannedDay, amountValue, readonlyAmount) {
  const id = c.employee.id;
  const payment = c.rec.payments[key];
  const paid = payment.paidAmount !== null;
  const amountInput = readonlyAmount || paid
    ? `<input type="text" readonly value="${escapeHtml(formatMoney(paid ? payment.paidAmount : amountValue))}" data-pay-view="${id}:${key}">`
    : `<input type="number" min="0" step="0.01" placeholder="0" data-pay-amount="${key}" data-emp="${id}"
         value="${escapeHtml(payment.amount !== '' ? fieldValue(payment.amount) : (amountValue > 0 ? String(amountValue) : ''))}">`;
  return `<div class="payment ${paid ? 'paid' : ''}">
    <div class="payment-head"><strong>${escapeHtml(title)}</strong>
      <span class="abs-sub">план: ${plannedDay}</span></div>
    <label class="field"><span>Сумма</span>${amountInput}</label>
    ${paid
      ? `<div class="abs-sub">Выдано ${escapeHtml(formatMoney(payment.paidAmount))} · ${escapeHtml(payment.paidDate)}</div>
         <button class="btn btn-danger" data-pay-undo="${key}" data-emp="${id}">Отменить выдачу</button>`
      : `<button class="btn btn-primary" data-pay-mark="${key}" data-emp="${id}">Выдано</button>`}
  </div>`;
}

function renderDetail(employee, c) {
  const id = employee.id;
  const o = outputs(c);
  const { from } = monthBounds(currentMonth);
  const planned1 = formatDayMonth(toIso(from));
  const planned15 = '15.' + currentMonth.slice(5);

  return `<div class="detail">
    <div class="detail-head">
      <h3>Расчёт ${escapeHtml(employee.name || 'сотрудника')}</h3>
      <div>
        <button class="btn" data-calendar="${id}">Открыть календарь</button>
        <button class="btn btn-ghost" data-abs-add="${id}">＋ Отсутствие</button>
        <button class="btn btn-danger" data-emp-del="${id}">Удалить сотрудника</button>
      </div>
    </div>

    <div class="fields">
      ${textField(id, 'name', 'Имя', employee.name)}
      ${textField(id, 'position', 'Должность', employee.position)}
      <label class="field"><span>Тип расчёта</span>
        <select data-emp="${id}" data-field="payType">
          ${Object.entries(PAY_TYPES).map(([key, label]) =>
            `<option value="${key}" ${employee.payType === key ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      ${textField(id, 'hireDate', 'Дата выхода на работу', employee.hireDate, 'date')}
      ${moneyField(id, 'oklad', 'Оклад', c.rec.oklad)}
      ${moneyField(id, 'plan', 'Плановая зарплата с KPI', c.rec.plan)}
      <label class="field"><span>Полный KPI (авто)</span><input type="text" readonly value="${escapeHtml(formatMoney(c.fullKpi))}" data-out-value="${id}:fullKpi"></label>
      <label class="field"><span>Норма дней или смен</span>
        <input type="number" min="0" step="1" data-emp="${id}" data-field="norm"
          value="${escapeHtml(c.rec.normManual ? fieldValue(c.rec.norm) : String(c.norm))}"
          ${c.rec.normManual ? '' : 'readonly'} data-out-value="${id}:normValue">
        <label class="checkbox"><input type="checkbox" data-emp="${id}" data-field="normManual" ${c.rec.normManual ? 'checked' : ''}> Ввести вручную</label>
        <span class="hint">${out(id, 'normHint', o.normHint)}</span>
      </label>
      <label class="field"><span>Отработано (авто)</span><input type="text" readonly value="${escapeHtml(o.worked)}" data-out-value="${id}:worked"></label>
      ${textField(id, 'vacationDays', 'Отпуск, кал./раб. дн.', `${c.vacationCal} / ${c.vacationWork}`, 'text', { readonly: true })}
      ${textField(id, 'sickDays', 'Больничный, кал./раб. дн.', `${c.sickCal} / ${c.sickWork}`, 'text', { readonly: true })}
      ${textField(id, 'unpaidDays', 'За свой счёт, кал./раб. дн.', `${c.unpaidCal} / ${c.unpaidWork}`, 'text', { readonly: true })}
      ${moneyField(id, 'bonus', 'Премия', c.rec.bonus)}
      ${moneyField(id, 'seniority', 'Выслуга лет', c.rec.seniority)}
      ${moneyField(id, 'penalty', 'Штрафы', c.rec.penalty)}
      ${moneyField(id, 'manual', 'Ручная корректировка (± )', c.rec.manual, { allowNegative: true })}
      ${moneyField(id, 'revenueOut', 'Оборот выход', c.rec.revenueOut)}
      ${moneyField(id, 'revenueIn', 'Оборот вход', c.rec.revenueIn)}
      ${textField(id, 'comment', 'Комментарий', c.rec.comment)}
    </div>

    <div class="detail-columns">
      <div class="breakdown">
        <div class="line"><span>${c.unpaidWork > 0 ? 'Фиксированная часть после дней за свой счёт' : 'Фиксированный оклад'}</span>${out(id, 'fixedEarned', o.fixedEarned)}</div>
        <div class="line"><span>Полный KPI</span>${out(id, 'fullKpi', o.fullKpi)}</div>
        <div class="line"><span>KPI за отработанные дни</span>${out(id, 'kpiEarned', o.kpiEarned)}</div>
        <div class="line"><span>Отпускные${c.isDirector ? ' (фиксированная выплата)' : ' (справочно, включены в оклад)'}</span>${out(id, 'vacationPay', o.vacationPay)}</div>
        <div class="line"><span>Больничные</span>${out(id, 'sickPay', o.sickPay)}</div>
        <div class="line"><span>Премия</span>${out(id, 'bonus', o.bonus)}</div>
        <div class="line"><span>Выслуга лет</span>${out(id, 'seniority', o.seniority)}</div>
        <div class="line"><span>Штрафы</span>−${out(id, 'penalty', o.penalty)}</div>
        <div class="line"><span>Ручная корректировка</span>${out(id, 'manual', o.manual)}</div>
        <div class="line total"><span>Начислено всего</span>${out(id, 'accrued', o.accrued)}</div>
        <div class="line"><span>Выдано</span>${out(id, 'paidTotal', o.paidTotal)}</div>
        <div class="line total"><span>${out(id, 'remainingLabel', o.remainingLabel)}</span>${out(id, 'remaining', o.remaining)}</div>
        <div class="line"><span>Прибыль</span>${out(id, 'profit', o.profit)}</div>
      </div>
      <div class="payments">
        <h4>Выплаты</h4>
        ${renderPayment(c, 'first', 'Первая выплата', planned1, c.firstPlanned, false)}
        ${renderPayment(c, 'second', 'Вторая выплата (остаток)', planned15, c.secondPlanned, true)}
      </div>
    </div>

    <h4>Отсутствия</h4>
    ${renderAbsenceList(employee)}
  </div>`;
}

function renderTable() {
  const body = document.getElementById('gridBody');
  body.innerHTML = state.employees.map((emp) => {
    const c = calcEmployee(emp);
    const o = outputs(c);
    const open = openRows.has(emp.id);
    const main = `<tr class="${open ? 'row-open' : ''}" data-row="${emp.id}">
      <td class="left"><button class="toggle" data-toggle="${emp.id}">${open ? '⌄' : '›'}</button></td>
      <td class="left"><span class="name-link" data-toggle="${emp.id}">${escapeHtml(emp.name || 'Без имени')}</span></td>
      <td class="left pos">${escapeHtml(emp.position || '–')}</td>
      <td class="left pos">${escapeHtml(PAY_TYPES[emp.payType])}</td>
      <td>${out(emp.id, 'okladShort', o.okladShort)}</td>
      <td>${out(emp.id, 'planShort', o.planShort)}</td>
      <td>${out(emp.id, 'worked', o.worked)}</td>
      <td class="left">${absenceTags(emp)}</td>
      <td>${out(emp.id, 'vacationPay', o.vacationPay)}</td>
      <td>${c.profit ? `<span class="${c.profit > 0 ? 'money-pos' : 'money-neg'}">${out(emp.id, 'profitShort', o.profitShort)}</span>` : '<span class="dash">–</span>'}</td>
      <td><strong>${out(emp.id, 'accruedShort', o.accruedShort)}</strong></td>
      <td>${out(emp.id, 'paidShort', o.paidShort)}</td>
      <td class="${c.remaining < 0 ? 'money-neg' : ''}">${out(emp.id, 'remainingShort', o.remainingShort)}</td>
    </tr>`;
    const detail = open
      ? `<tr class="detail-row"><td colspan="13">${renderDetail(emp, c)}</td></tr>`
      : '';
    return main + detail;
  }).join('');
}

function renderMobile() {
  const list = document.getElementById('mobileList');
  list.innerHTML = state.employees.map((emp) => {
    const c = calcEmployee(emp);
    const o = outputs(c);
    const open = openRows.has(emp.id);
    return `<article class="emp-card">
      <div class="head">
        <div>
          <div class="name" data-toggle="${emp.id}">${escapeHtml(emp.name || 'Без имени')}</div>
          <div class="pos">${escapeHtml(emp.position || '')} · ${escapeHtml(PAY_TYPES[emp.payType])}</div>
        </div>
        <button class="btn" data-toggle="${emp.id}">${open ? 'Свернуть' : 'Подробнее'}</button>
      </div>
      <div>${absenceTags(emp)}</div>
      <div class="rows">
        <div class="line"><span>Отработано</span>${out(emp.id, 'worked', o.worked)}</div>
        <div class="line"><span>KPI за дни</span>${out(emp.id, 'kpiEarned', o.kpiEarned)}</div>
        <div class="line"><span>Отпускные${c.isDirector ? '' : ' (в окладе)'}</span>${out(emp.id, 'vacationPay', o.vacationPay)}</div>
        <div class="line"><span>Выдано</span>${out(emp.id, 'paidTotal', o.paidTotal)}</div>
        <div class="line"><span>${out(emp.id, 'remainingLabel', o.remainingLabel)}</span>${out(emp.id, 'remaining', o.remaining)}</div>
      </div>
      <div class="line"><span class="pos">Начислено</span></div>
      <div class="total">${out(emp.id, 'accrued', o.accrued)}</div>
      ${open ? renderDetail(emp, c) : ''}
    </article>`;
  }).join('');
}

function syncMonthControls() {
  if (!hasDom) return;
  const [year, month] = currentMonth.split('-');
  document.getElementById('monthSelect').value = String(Number(month));
  document.getElementById('yearInput').value = year;
  document.getElementById('currentMonthLabel').textContent = monthTitle(currentMonth);
  document.getElementById('btnPrevMonth').disabled = shiftMonthKey(currentMonth, -1) === null;
  document.getElementById('btnNextMonth').disabled = shiftMonthKey(currentMonth, 1) === null;
}

function changeMonthBy(delta) {
  const next = shiftMonthKey(currentMonth, delta);
  if (!next) return;
  currentMonth = next;
  saveState();
  render();
}

function render() {
  if (!hasDom) return;
  syncMonthControls();
  renderSummary();
  renderErrors();
  renderTable();
  renderMobile();
  document.getElementById('emptyHint').hidden = state.employees.length > 0;
}

/** Обновляет вычисляемые значения без перерисовки полей ввода. */
function patch(empId) {
  const emp = findEmployee(empId);
  if (!emp) return;
  const o = outputs(calcEmployee(emp));
  document.querySelectorAll(`[data-out^="${empId}:"]`).forEach((node) => {
    const key = node.dataset.out.split(':')[1];
    if (o[key] !== undefined) node.textContent = o[key];
  });
  document.querySelectorAll(`[data-out-value^="${empId}:"]`).forEach((node) => {
    const key = node.dataset.outValue.split(':')[1];
    const c = calcEmployee(emp);
    if (key === 'fullKpi') node.value = formatMoney(c.fullKpi);
    if (key === 'worked') node.value = o.worked;
    if (key === 'normValue' && !c.rec.normManual) node.value = String(c.norm);
  });
  document.querySelectorAll('[data-pay-view]').forEach((node) => {
    const [id, key] = node.dataset.payView.split(':');
    if (id !== empId) return;
    const c = calcEmployee(emp);
    const payment = c.rec.payments[key];
    node.value = formatMoney(payment.paidAmount !== null ? payment.paidAmount
      : (key === 'second' ? c.secondPlanned : c.firstPlanned));
  });
  renderSummary();
  renderErrors();
}

/* ---------- Действия ---------- */

function addEmployee() {
  const emp = { id: uid(), name: 'Новый сотрудник', position: '', payType: 'manager', hireDate: '', absences: [] };
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

/** Переносятся только постоянные условия; премии, обороты и выплаты начинаются пустыми. */
function copyPreviousMonth() {
  const prev = prevMonthKey(currentMonth);
  const source = state.months[prev];
  if (!source || !Object.keys(source).length) {
    alert('В месяце ' + monthTitle(prev) + ' нет данных для копирования.');
    return;
  }
  if (!confirm('Скопировать оклады, плановые зарплаты и норму из месяца ' + monthTitle(prev) + '?')) return;
  state.months[currentMonth] = state.months[currentMonth] || {};
  for (const emp of state.employees) {
    const from = source[emp.id];
    if (!from) continue;
    state.months[currentMonth][emp.id] = {
      ...defaultMonthRecord(),
      oklad: from.oklad,
      plan: from.plan,
      norm: from.norm,
      normManual: from.normManual,
    };
  }
  saveState();
  render();
}

const MONEY_FIELDS = new Set(['oklad', 'plan', 'bonus', 'seniority', 'penalty', 'manual', 'revenueOut', 'revenueIn', 'norm']);

function setEmployeeField(empId, fieldName, value) {
  const emp = findEmployee(empId);
  if (!emp) return;
  if (fieldName === 'name' || fieldName === 'position' || fieldName === 'hireDate' || fieldName === 'payType') {
    emp[fieldName] = value;
  } else if (fieldName === 'comment') {
    monthRecord(empId).comment = value;
  } else if (fieldName === 'normManual') {
    const rec = monthRecord(empId);
    rec.normManual = value;
    if (value && rec.norm === '') rec.norm = String(autoNorm(emp, currentMonth));
  } else if (MONEY_FIELDS.has(fieldName)) {
    monthRecord(empId)[fieldName] = value === '' ? '' : String(value);
  }
  saveState();
}

function markPaid(empId, key) {
  const emp = findEmployee(empId);
  const c = calcEmployee(emp);
  const payment = c.rec.payments[key];
  const amount = key === 'second' ? c.secondPlanned : c.firstPlanned;
  if (amount <= 0) {
    alert('Укажите сумму выплаты больше нуля.');
    return;
  }
  payment.paidAmount = round2(amount);
  payment.paidDate = todayIso();
  if (key === 'first' && payment.amount === '') payment.amount = String(round2(amount));
  saveState();
  render();
}

function undoPaid(empId, key) {
  const rec = monthRecord(empId);
  rec.payments[key] = { ...rec.payments[key], paidAmount: null, paidDate: '' };
  saveState();
  render();
}

/* ---------- Модальные окна ---------- */

let modalContext = null;

function openModal(title, bodyHtml, options = {}) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalSave').hidden = !!options.hideSave;
  document.getElementById('modalCancel').textContent = options.closeLabel || 'Отмена';
  document.getElementById('modal').hidden = false;
}

function closeModal() {
  document.getElementById('modal').hidden = true;
  modalContext = null;
}

function openAbsenceModal(empId, absenceId) {
  const emp = findEmployee(empId);
  if (!emp) return;
  const existing = (emp.absences || []).find((a) => a.id === absenceId);
  const { from } = monthBounds(currentMonth);
  const defaults = existing || { type: 'vacation', start: toIso(from), end: toIso(from) };
  modalContext = { kind: 'absence', empId, absenceId: absenceId || null };

  openModal(existing ? 'Изменить отсутствие' : 'Добавить отсутствие', `
    <label class="field"><span>Тип</span>
      <select id="absType">
        ${Object.entries(ABSENCE_TYPES).map(([key, meta]) =>
          `<option value="${key}" ${defaults.type === key ? 'selected' : ''}>${meta.label}</option>`).join('')}
      </select>
    </label>
    <label class="field"><span>Дата начала</span><input type="date" id="absStart" value="${escapeHtml(defaults.start)}"></label>
    <label class="field"><span>Дата окончания</span><input type="date" id="absEnd" value="${escapeHtml(defaults.end)}"></label>
    <label class="field"><span>Календарных дней (авто)</span><input type="text" id="absCal" readonly></label>
    <label class="field"><span>Пропущено рабочих дней (авто)</span><input type="text" id="absWork" readonly></label>
    <div class="modal-error" id="absError"></div>`);

  const refresh = () => {
    const s = parseDate(document.getElementById('absStart').value);
    const e = parseDate(document.getElementById('absEnd').value);
    const ok = s && e && e >= s;
    document.getElementById('absCal').value = ok ? daysBetweenInclusive(s, e) : '—';
    document.getElementById('absWork').value = ok ? CAL.workdaysBetween(s, e) : '—';
  };
  document.getElementById('absStart').addEventListener('input', refresh);
  document.getElementById('absEnd').addEventListener('input', refresh);
  refresh();
}

function saveAbsence() {
  if (!modalContext || modalContext.kind !== 'absence') return;
  const emp = findEmployee(modalContext.empId);
  if (!emp) return;
  const type = document.getElementById('absType').value;
  const start = document.getElementById('absStart').value;
  const end = document.getElementById('absEnd').value;
  const errorBox = document.getElementById('absError');
  const result = upsertAbsence(emp, { type, start, end }, modalContext.absenceId);
  if (!result.ok) { errorBox.textContent = result.error; return; }

  saveState();
  closeModal();
  render();
}

function dayClass(employee, date) {
  const iso = toIso(date);
  for (const { part } of absencesOfMonth(employee, currentMonth)) {
    if (iso >= part.from && iso <= part.to) return 'day-' + part.type;
  }
  const hire = parseDate(employee.hireDate);
  if (hire && date < hire) return 'day-before-hire';
  if (!CAL.isWorkingDay(date)) return 'day-off';
  return 'day-work';
}

function openCalendarModal(empId) {
  const emp = findEmployee(empId);
  if (!emp) return;
  modalContext = { kind: 'calendar', empId };
  const { from, to } = monthBounds(currentMonth);
  const lead = (from.getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push('<div class="day empty"></div>');
  for (const d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    cells.push(`<div class="day ${dayClass(emp, d)}">${d.getUTCDate()}</div>`);
  }
  const c = calcEmployee(emp);
  openModal(`Календарь: ${monthTitle(currentMonth)}`, `
    <p class="abs-sub">${escapeHtml(normHint(emp, currentMonth))}. Отработано: ${c.worked} из ${c.norm}.</p>
    <div class="cal-grid">${WEEKDAY_NAMES.map((w) => `<div class="day head">${w}</div>`).join('')}${cells.join('')}</div>
    <div class="cal-legend">
      <span><i class="day-work"></i> в норме</span>
      <span><i class="day-off"></i> выходной или праздник</span>
      <span><i class="day-before-hire"></i> до выхода</span>
      <span><i class="day-vacation"></i> отпуск</span>
      <span><i class="day-sick"></i> больничный</span>
      <span><i class="day-unpaid"></i> за свой счёт</span>
    </div>`, { hideSave: true, closeLabel: 'Закрыть' });
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

const CSV_HEADERS = ['Имя', 'Должность', 'Тип расчёта', 'Дата выхода', 'Базовый оклад', 'Фикс к начислению', 'Плановая ЗП с KPI',
  'Полный KPI', 'Норма дней', 'Отработано', 'Отпуск кал.', 'Отпуск раб.', 'Больничный кал.',
  'Больничный раб.', 'За свой счёт кал.', 'За свой счёт раб.', 'KPI за отработанные дни',
  'Отпускные (справочно у менеджера)', 'Больничные', 'Премия', 'Выслуга лет', 'Штрафы', 'Ручная корректировка',
  'Начислено', 'Первая выплата', 'Дата первой выплаты', 'Вторая выплата', 'Дата второй выплаты',
  'Всего выдано', 'Остаток', 'Переплата', 'Оборот выход', 'Оборот вход', 'Прибыль', 'Комментарий'];

function csvValue(value) {
  const text = typeof value === 'number' ? String(round2(value)).replace('.', ',') : String(value ?? '');
  return '"' + text.replace(/"/g, '""') + '"';
}

function exportCsv() {
  const rows = [CSV_HEADERS.map(csvValue).join(';')];
  for (const emp of state.employees) {
    const c = calcEmployee(emp);
    const first = c.rec.payments.first;
    const second = c.rec.payments.second;
    rows.push([
      emp.name, emp.position, PAY_TYPES[emp.payType], emp.hireDate,
      c.oklad, c.fixedEarned, c.plan, c.fullKpi, c.norm, c.worked,
      c.vacationCal, c.vacationWork, c.sickCal, c.sickWork, c.unpaidCal, c.unpaidWork,
      c.kpiEarned, c.vacationPay, c.sickPay, c.bonus, c.seniority, c.penalty, c.manual,
      c.accrued, first.paidAmount || 0, first.paidDate, second.paidAmount || 0, second.paidDate,
      c.paidTotal, Math.max(c.remaining, 0), c.overpaid,
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
      state = migrate(parsed);
      if (parsed.currentMonth) currentMonth = normalizeMonthKey(parsed.currentMonth, currentMonth);
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
  if (target.dataset.field !== undefined && !target.readOnly) {
    const value = target.type === 'checkbox' ? target.checked : target.value;
    setEmployeeField(target.dataset.emp, target.dataset.field, value);
    if (target.dataset.field === 'normManual' || target.dataset.field === 'payType') render();
    else patch(target.dataset.emp);
    return;
  }
  if (target.dataset.payAmount) {
    const rec = monthRecord(target.dataset.emp);
    rec.payments[target.dataset.payAmount].amount = target.value;
    saveState();
    patch(target.dataset.emp);
    return;
  }
  if (target.dataset.absDays) {
    const emp = findEmployee(target.dataset.emp);
    const absence = emp && (emp.absences || []).find((a) => a.id === target.dataset.absDays);
    if (!absence) return;
    absence.overrides = absence.overrides || {};
    absence.overrides[currentMonth] = Math.max(0, num(target.value));
    saveState();
    patch(emp.id);
  }
}

/** Ноль в пустом поле не должен мешать вводу нового числа. */
function onFocusIn(event) {
  const target = event.target;
  if (target.tagName !== 'INPUT' || target.type !== 'number' || target.readOnly) return;
  if (target.value === '0') {
    target.value = '';
    if (target.dataset.field) setEmployeeField(target.dataset.emp, target.dataset.field, '');
    if (target.dataset.payAmount) {
      monthRecord(target.dataset.emp).payments[target.dataset.payAmount].amount = '';
      saveState();
    }
  }
}

function onClick(event) {
  const target = event.target.closest('[data-toggle], [data-abs-add], [data-abs-edit], [data-abs-del], [data-emp-del], [data-calendar], [data-pay-mark], [data-pay-undo]');
  if (!target) return;
  const data = target.dataset;
  if (data.toggle) {
    if (openRows.has(data.toggle)) openRows.delete(data.toggle); else openRows.add(data.toggle);
    render();
  } else if (data.absAdd) {
    openAbsenceModal(data.absAdd, null);
  } else if (data.absEdit) {
    openAbsenceModal(data.emp, data.absEdit);
  } else if (data.absDel) {
    const emp = findEmployee(data.emp);
    if (emp && confirm('Удалить это отсутствие?')) {
      if (deleteAbsence(emp, data.absDel)) {
        saveState();
        render();
      }
    }
  } else if (data.empDel) {
    deleteEmployee(data.empDel);
  } else if (data.calendar) {
    openCalendarModal(data.calendar);
  } else if (data.payMark) {
    markPaid(data.emp, data.payMark);
  } else if (data.payUndo) {
    undoPaid(data.emp, data.payUndo);
  }
}

function init() {
  loadState();
  syncMonthControls();

  const selectMonthFromControls = () => {
    const next = monthKeyFromParts(
      document.getElementById('yearInput').value,
      document.getElementById('monthSelect').value,
    );
    if (!next) { syncMonthControls(); return; }
    currentMonth = next;
    saveState();
    render();
  };
  document.getElementById('monthSelect').addEventListener('change', selectMonthFromControls);
  document.getElementById('yearInput').addEventListener('change', selectMonthFromControls);
  document.getElementById('btnPrevMonth').addEventListener('click', () => changeMonthBy(-1));
  document.getElementById('btnNextMonth').addEventListener('click', () => changeMonthBy(1));
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
  document.addEventListener('change', (e) => {
    if (e.target.tagName === 'SELECT' && e.target.dataset.field) onInput(e);
  });
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('click', onClick);

  render();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    round2, formatMoney, num, parseDate, autoNorm, calcEmployee, validate, migrate,
    markPaid, monthRecord, copyPreviousMonth, shiftMonthKey, monthKeyFromParts, normalizeMonthKey,
    normalizeAbsences, validateAbsenceDraft, upsertAbsence, deleteAbsence,
    setTestState: (nextState, monthKey) => {
      state = migrate(nextState);
      currentMonth = normalizeMonthKey(monthKey, currentMonth);
      return state;
    },
    getState: () => state,
    setCurrentMonth: (monthKey) => { currentMonth = normalizeMonthKey(monthKey, currentMonth); },
  };
}
