'use strict';

const CAL = typeof ProductionCalendar !== 'undefined'
  ? ProductionCalendar
  : require('./calendar.js');

const STORAGE_KEY = 'salary-calculator-v1';
const THEME_KEY = 'salary-calculator-theme';
const DATA_VERSION = 3;
const AVG_MONTH_DAYS = 29.3;
const DIRECTOR_VACATION_PAY = 60000;
const MANAGER_FIRST_PAYMENT = 60000;
const PAY_TYPES = { manager: 'Менеджер', director: 'Руководитель' };
const CURRENCIES = { RUB: 'RUB', USD: 'USD', BYN: 'BYN' };
const ABSENCE_TYPES = {
  vacation: { label: 'Отпуск', short: 'Отпуск', cls: 'vacation' },
  sick: { label: 'Больничный', short: 'Больничный', cls: 'sick' },
  unpaid: { label: 'За свой счёт', short: 'За свой счёт', cls: 'unpaid' },
};
const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function num(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(String(value).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value) {
  const text = round2(num(value)).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return text.replace(/\u00A0/g, ' ') + ' ₽';
}

function formatMoneyShort(value) {
  return Math.round(num(value)).toLocaleString('ru-RU').replace(/\u00A0/g, ' ') + ' ₽';
}

function formatForeign(value, currency) {
  const text = round2(num(value)).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).replace(/\u00A0/g, ' ');
  return `${text} ${currency}`;
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid() {
  return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function fieldValue(value) {
  return value === '' || value === null || value === undefined ? '' : String(value);
}

function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthKeyOf(date) {
  return date.toISOString().slice(0, 7);
}

function monthBounds(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 0)),
  };
}

function monthTitle(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
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

function prevMonthKey(monthKey) {
  return shiftMonthKey(monthKey, -1);
}

function monthKeyFromParts(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 1900 || y > 9999 || !Number.isInteger(m) || m < 1 || m > 12) return null;
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
  const date = parseDate(iso);
  if (!date) return '';
  return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isValidIsoDate(value) {
  const text = String(value || '');
  const parsed = parseDate(text);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && parsed !== null && toIso(parsed) === text;
}

function normalizeCurrency(value) {
  const currency = String(value || 'RUB').toUpperCase();
  return CURRENCIES[currency] ? currency : 'RUB';
}

function defaultPayment(kind = 'custom', monthKey = '') {
  const day = kind === 'first' ? '01' : kind === 'remaining' ? '15' : '';
  return {
    id: uid(),
    kind,
    date: monthKey && day ? `${monthKey}-${day}` : '',
    currency: 'RUB',
    amount: '',
    rate: '1',
    autoAmount: kind === 'remaining',
    issued: false,
    issuedDate: '',
    issuedAmount: null,
    issuedCurrency: '',
    issuedRate: null,
    issuedRub: null,
  };
}

function defaultPayments(monthKey = '') {
  return [defaultPayment('first', monthKey), defaultPayment('remaining', monthKey)];
}

function defaultMonthRecord(monthKey = '') {
  return {
    oklad: '', plan: '', norm: '', normManual: false,
    bonus: '', seniority: '', penalty: '', manual: '',
    revenueOut: '', revenueIn: '', comment: '',
    payments: defaultPayments(monthKey),
  };
}

function defaultMonthSettings() {
  return {
    rates: {
      USD: { value: '', locked: false },
      BYN: { value: '', locked: false },
    },
  };
}

let state = { version: DATA_VERSION, employees: [], months: {}, monthSettings: {} };
let currentMonth = monthKeyOf(new Date());
const openRows = new Set();
const hasDom = typeof document !== 'undefined';

function normalizeAbsences(absences) {
  const usedIds = new Set();
  return (Array.isArray(absences) ? absences : []).map((absence) => {
    let id = absence && absence.id !== undefined && absence.id !== null ? String(absence.id) : '';
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

function normalizePayment(payment, index, monthKey, legacySlot = '') {
  const source = payment || {};
  const currency = normalizeCurrency(source.currency || source.issuedCurrency);
  const legacyIssued = source.paidAmount !== null && source.paidAmount !== undefined;
  const issued = source.issued === undefined ? legacyIssued : !!source.issued;
  const fallbackAmount = legacyIssued ? source.paidAmount : '';
  const amount = source.amount !== undefined ? source.amount : fallbackAmount;
  const rate = currency === 'RUB' ? 1 : (source.rate ?? source.issuedRate ?? '');
  const issuedAmount = issued ? num(source.issuedAmount ?? source.paidAmount ?? amount) : null;
  const issuedCurrency = issued ? normalizeCurrency(source.issuedCurrency || currency) : '';
  const issuedRate = issued
    ? (issuedCurrency === 'RUB' ? 1 : num(source.issuedRate ?? source.rate))
    : null;
  const issuedRub = issued
    ? round2(source.issuedRub ?? source.rubEquivalent ?? (issuedAmount * issuedRate))
    : null;
  const kind = source.kind || legacySlot || 'custom';
  const defaultDay = kind === 'first' ? '01' : kind === 'remaining' ? '15' : '';
  return {
    id: String(source.id || (legacySlot ? `legacy-${legacySlot}` : uid())),
    kind,
    date: String(source.date || source.issuedDate || source.paidDate || (defaultDay ? `${monthKey}-${defaultDay}` : '')),
    currency,
    amount: amount === null || amount === undefined ? '' : String(amount),
    rate: currency === 'RUB' ? '1' : fieldValue(rate),
    autoAmount: source.autoAmount === undefined ? kind === 'remaining' && amount === '' : !!source.autoAmount,
    issued,
    issuedDate: issued ? String(source.issuedDate || source.paidDate || source.date || '') : '',
    issuedAmount,
    issuedCurrency,
    issuedRate,
    issuedRub,
  };
}

function normalizePayments(payments, monthKey) {
  if (Array.isArray(payments)) {
    return payments.map((payment, index) => normalizePayment(payment, index, monthKey));
  }
  if (payments && typeof payments === 'object' && (payments.first || payments.second)) {
    return [
      normalizePayment(payments.first || {}, 0, monthKey, 'first'),
      normalizePayment(payments.second || {}, 1, monthKey, 'remaining'),
    ];
  }
  return defaultPayments(monthKey);
}

function normalizeMonthSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const rates = source.rates && typeof source.rates === 'object' ? source.rates : source;
  const result = defaultMonthSettings();
  for (const currency of ['USD', 'BYN']) {
    const rate = rates[currency] || {};
    result.rates[currency] = {
      value: rate.value === undefined || rate.value === null ? '' : String(rate.value),
      locked: !!rate.locked,
    };
  }
  return result;
}

function migrate(raw = {}) {
  const employees = (Array.isArray(raw.employees) ? raw.employees : []).map((employee) => ({
    id: employee.id === undefined || employee.id === null || employee.id === '' ? uid() : String(employee.id),
    name: employee.name || '',
    position: employee.position || '',
    payType: PAY_TYPES[employee.payType] ? employee.payType : 'manager',
    hireDate: employee.hireDate || '',
    absences: normalizeAbsences(employee.absences),
  }));
  const months = {};
  for (const [monthKey, byEmployee] of Object.entries(raw.months || {})) {
    months[monthKey] = {};
    for (const [empId, recordValue] of Object.entries(byEmployee || {})) {
      const record = recordValue || {};
      months[monthKey][String(empId)] = {
        ...defaultMonthRecord(monthKey),
        ...record,
        normManual: record.normManual === undefined
          ? record.norm !== undefined && record.norm !== ''
          : !!record.normManual,
        payments: normalizePayments(record.payments, monthKey),
      };
    }
  }
  const monthSettings = {};
  const rawSettings = raw.monthSettings || raw.rates || {};
  for (const [monthKey, settings] of Object.entries(rawSettings)) {
    monthSettings[monthKey] = normalizeMonthSettings(settings);
  }
  return { version: DATA_VERSION, employees, months, monthSettings };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (parsed && Array.isArray(parsed.employees) && parsed.months) {
      state = migrate(parsed);
      if (parsed.currentMonth) currentMonth = normalizeMonthKey(parsed.currentMonth, currentMonth);
    }
  } catch (error) {
    console.warn('Не удалось прочитать сохранённые данные', error);
  }
}

let savedTimer = null;
function flashSaved() {
  const badge = document.getElementById('savedBadge');
  if (!badge) return;
  badge.style.opacity = '0.35';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { badge.style.opacity = '1'; }, 180);
}

function saveState() {
  if (!hasDom) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, currentMonth }));
  flashSaved();
}

function monthRecord(empId, monthKey = currentMonth) {
  const id = String(empId);
  if (!state.months[monthKey]) state.months[monthKey] = {};
  if (!state.months[monthKey][id]) state.months[monthKey][id] = defaultMonthRecord(monthKey);
  const record = state.months[monthKey][id];
  record.payments = normalizePayments(record.payments, monthKey);
  return record;
}

function monthSettings(monthKey = currentMonth) {
  if (!state.monthSettings) state.monthSettings = {};
  if (!state.monthSettings[monthKey]) state.monthSettings[monthKey] = defaultMonthSettings();
  state.monthSettings[monthKey] = normalizeMonthSettings(state.monthSettings[monthKey]);
  return state.monthSettings[monthKey];
}

function setMonthRate(currency, value, locked, monthKey = currentMonth) {
  if (!['USD', 'BYN'].includes(currency)) return false;
  const entry = monthSettings(monthKey).rates[currency];
  entry.value = value === '' || value === null || value === undefined ? '' : String(value);
  if (locked !== undefined) entry.locked = !!locked;
  return true;
}

function findEmployee(empId) {
  return state.employees.find((employee) => String(employee.id) === String(empId));
}

function absenceInMonth(absence, monthKey) {
  const start = parseDate(absence.start);
  const end = parseDate(absence.end);
  if (!start || !end || end < start) return null;
  const { from, to } = monthBounds(monthKey);
  const clippedStart = start > from ? start : from;
  const clippedEnd = end < to ? end : to;
  if (clippedStart > clippedEnd) return null;
  const override = absence.overrides && absence.overrides[monthKey];
  const defaultWorkDays = CAL.workdaysBetween(clippedStart, clippedEnd);
  return {
    type: absence.type,
    calendarDays: daysBetweenInclusive(clippedStart, clippedEnd),
    defaultWorkDays,
    workDays: override === undefined || override === null || override === ''
      ? defaultWorkDays
      : Math.max(0, num(override)),
    from: toIso(clippedStart),
    to: toIso(clippedEnd),
  };
}

function absencesOfMonth(employee, monthKey) {
  return (employee.absences || [])
    .map((absence) => ({ absence, part: absenceInMonth(absence, monthKey) }))
    .filter((item) => item.part !== null);
}

function absencesOverlap(a, b) {
  const aStart = parseDate(a.start);
  const aEnd = parseDate(a.end);
  const bStart = parseDate(b.start);
  const bEnd = parseDate(b.end);
  return !!(aStart && aEnd && bStart && bEnd && aStart <= bEnd && bStart <= aEnd);
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
  if (parseDate(end) < parseDate(start)) return { ok: false, error: 'Дата окончания раньше даты начала.' };
  const editingKey = editingId === null || editingId === undefined ? null : String(editingId);
  const overlaps = (employee.absences || []).some((absence) =>
    String(absence.id) !== editingKey && absencesOverlap(absence, { start, end }));
  if (overlaps) return { ok: false, error: 'Период пересекается с другим отсутствием этого сотрудника.' };
  return { ok: true, value: { type, start, end } };
}

function upsertAbsence(employee, draft, editingId = null) {
  employee.absences = normalizeAbsences(employee.absences);
  const editingKey = editingId === null || editingId === undefined ? null : String(editingId);
  const index = editingKey === null ? -1 : employee.absences.findIndex((item) => item.id === editingKey);
  if (editingKey !== null && index < 0) {
    return { ok: false, error: 'Сохранённое отсутствие не найдено. Закройте окно и повторите попытку.' };
  }
  const validation = validateAbsenceDraft(employee, draft, editingKey);
  if (!validation.ok) return validation;
  const existing = index >= 0 ? employee.absences[index] : null;
  const absence = {
    id: existing ? existing.id : uid(),
    ...validation.value,
    overrides: existing ? { ...existing.overrides } : {},
  };
  if (index >= 0) employee.absences[index] = absence;
  else employee.absences.push(absence);
  employee.absences.sort((a, b) => a.start.localeCompare(b.start));
  return { ok: true, absence };
}

function deleteAbsence(employee, absenceId) {
  employee.absences = normalizeAbsences(employee.absences);
  const before = employee.absences.length;
  employee.absences = employee.absences.filter((absence) => absence.id !== String(absenceId));
  return employee.absences.length < before;
}

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
  const automatic = autoNorm(employee, monthKey);
  if (hire && hire > to) return 'Сотрудник ещё не вышел на работу в этом месяце';
  if (hire && hire > from) return `Вышел ${formatDayMonth(employee.hireDate)} — норма с даты выхода: ${automatic} рабочих дней`;
  return `Норма месяца по производственному календарю: ${automatic} рабочих дней`;
}

function issuedRub(payment) {
  if (!payment.issued) return 0;
  if (payment.issuedRub !== null && payment.issuedRub !== undefined) return round2(num(payment.issuedRub));
  const currency = normalizeCurrency(payment.issuedCurrency || payment.currency);
  const rate = currency === 'RUB' ? 1 : num(payment.issuedRate || payment.rate);
  return round2(num(payment.issuedAmount ?? payment.amount) * rate);
}

function paymentReference(record, reference) {
  if (reference === 'first') return record.payments[0] || null;
  if (reference === 'second') return record.payments[1] || null;
  return record.payments.find((payment) => payment.id === String(reference)) || null;
}

function calcEmployee(employee, monthKey = currentMonth) {
  const record = monthRecord(employee.id, monthKey);
  const oklad = num(record.oklad);
  const plan = num(record.plan);
  const fullKpi = Math.max(plan - oklad, 0);
  const automaticNorm = autoNorm(employee, monthKey);
  const norm = record.normManual ? num(record.norm) : automaticNorm;
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
  const fixedWorked = Math.max(0, norm - unpaidWork);
  const fixedEarned = norm > 0 && unpaidWork > 0 ? round2(oklad * fixedWorked / norm) : oklad;
  const vacationPay = isDirector
    ? (vacationCal > 0 ? DIRECTOR_VACATION_PAY : 0)
    : round2(oklad / AVG_MONTH_DAYS * vacationCal);
  const vacationPayAdded = isDirector ? vacationPay : 0;
  const sickPay = round2(oklad / AVG_MONTH_DAYS * sickCal);
  const bonus = num(record.bonus);
  const seniority = num(record.seniority);
  const penalty = num(record.penalty);
  const manual = num(record.manual);
  const accrued = round2(fixedEarned + kpiEarned + vacationPayAdded + sickPay
    + bonus + seniority - penalty + manual);
  const paidTotal = round2(record.payments.reduce((sum, payment) => sum + issuedRub(payment), 0));
  const remaining = round2(accrued - paidTotal);
  const paymentDetails = record.payments.map((payment, index) => {
    const currency = payment.issued ? payment.issuedCurrency : payment.currency;
    const amount = payment.issued
      ? num(payment.issuedAmount)
      : payment.autoAmount
        ? Math.max(remaining, 0)
        : payment.kind === 'first' && payment.amount === '' && !isDirector
          ? MANAGER_FIRST_PAYMENT
          : num(payment.amount);
    const rate = payment.issued
      ? num(payment.issuedRate)
      : currency === 'RUB' ? 1 : num(payment.rate);
    return {
      payment,
      index,
      currency,
      amount: round2(amount),
      rate,
      rubEquivalent: payment.issued ? issuedRub(payment) : round2(amount * rate),
    };
  });
  const firstPlanned = paymentDetails[0] ? paymentDetails[0].amount : 0;
  const secondPlanned = paymentDetails[1] ? paymentDetails[1].amount : Math.max(remaining, 0);
  const revenueOut = num(record.revenueOut);
  const revenueIn = num(record.revenueIn);
  return {
    rec: record, employee, isDirector,
    oklad, fixedEarned, plan, fullKpi, norm, autoNorm: automaticNorm,
    vacationCal, vacationWork, sickCal, sickWork, unpaidCal, unpaidWork,
    missedWork, worked, kpiEarned, vacationPay, vacationPayAdded, sickPay,
    bonus, seniority, penalty, manual, accrued, paidTotal, remaining,
    firstPlanned, secondPlanned, paymentDetails,
    overpaid: remaining < 0 ? -remaining : 0,
    revenueOut, revenueIn, profit: round2(revenueOut - revenueIn),
    hasAbsence: vacationCal + sickCal + unpaidCal > 0,
  };
}

function markPaid(empId, reference) {
  const employee = findEmployee(empId);
  if (!employee) return false;
  const calculation = calcEmployee(employee);
  const payment = paymentReference(calculation.rec, reference);
  if (!payment) return false;
  const detail = calculation.paymentDetails.find((item) => item.payment.id === payment.id);
  if (!detail || detail.amount <= 0) {
    if (hasDom) alert('Укажите сумму выплаты больше нуля.');
    return false;
  }
  if (detail.currency !== 'RUB' && detail.rate <= 0) {
    if (hasDom) alert('Укажите курс к RUB больше нуля.');
    return false;
  }
  const issueDate = payment.date || todayIso();
  payment.date = issueDate;
  payment.issued = true;
  payment.issuedDate = issueDate;
  payment.issuedAmount = detail.amount;
  payment.issuedCurrency = detail.currency;
  payment.issuedRate = detail.currency === 'RUB' ? 1 : detail.rate;
  payment.issuedRub = round2(detail.amount * payment.issuedRate);
  if (payment.amount === '') payment.amount = String(detail.amount);
  saveState();
  render();
  return true;
}

function undoPaid(empId, reference) {
  const record = monthRecord(empId);
  const payment = paymentReference(record, reference);
  if (!payment) return false;
  payment.issued = false;
  payment.issuedDate = '';
  payment.issuedAmount = null;
  payment.issuedCurrency = '';
  payment.issuedRate = null;
  payment.issuedRub = null;
  saveState();
  render();
  return true;
}

function validate() {
  const problems = [];
  for (const employee of state.employees) {
    const calculation = calcEmployee(employee);
    const who = employee.name || 'Без имени';
    const negative = [['Оклад', calculation.oklad], ['Плановая зарплата', calculation.plan], ['Норма', calculation.norm],
      ['Премия', calculation.bonus], ['Выслуга лет', calculation.seniority], ['Штрафы', calculation.penalty],
      ['Оборот выход', calculation.revenueOut], ['Оборот вход', calculation.revenueIn]]
      .filter(([, value]) => value < 0).map(([label]) => label);
    if (negative.length) problems.push(`${who}: отрицательные значения не допускаются (${negative.join(', ')}). Минус разрешён только в ручной корректировке.`);
    if (calculation.plan && calculation.plan < calculation.oklad) problems.push(`${who}: плановая зарплата с KPI меньше оклада.`);
    if (calculation.norm <= 0 && calculation.missedWork > 0) problems.push(`${who}: норма рабочих дней равна нулю, но указаны отсутствия.`);
    if (calculation.missedWork > calculation.norm) problems.push(`${who}: пропущено ${calculation.missedWork} рабочих дней при норме ${calculation.norm}.`);
    for (const detail of calculation.paymentDetails) {
      if (detail.amount < 0) problems.push(`${who}: сумма выплаты не может быть отрицательной.`);
      if (detail.amount > 0 && detail.currency !== 'RUB' && detail.rate <= 0) problems.push(`${who}: у выплаты в ${detail.currency} не указан курс к RUB.`);
    }
    const list = employee.absences || [];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (absencesOverlap(list[i], list[j])) problems.push(`${who}: периоды отсутствий пересекаются (${list[i].start} — ${list[i].end} и ${list[j].start} — ${list[j].end}).`);
      }
    }
  }
  return problems;
}

function parseDelimitedLine(line, delimiter) {
  const result = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      result.push(value.trim());
      value = '';
    } else value += char;
  }
  result.push(value.trim());
  return result;
}

function normalizeBulkDate(value) {
  const text = String(value || '').trim();
  const local = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const iso = local ? `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}` : text;
  return isValidIsoDate(iso) ? iso : null;
}

function normalizePayType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['менеджер', 'manager', 'м'].includes(text)) return 'manager';
  if (['руководитель', 'директор', 'director', 'р'].includes(text)) return 'director';
  return null;
}

function parseBulkEmployees(text) {
  const lines = String(text || '').split(/\r?\n/).map((line, index) => ({ line, number: index + 1 }))
    .filter((item) => item.line.trim());
  if (!lines.length) return { rows: [], errors: [{ line: 0, message: 'Вставьте хотя бы одну строку.' }] };
  const sample = lines[0].line;
  const delimiter = sample.includes('\t') ? '\t' : (sample.split(';').length >= 6 ? ';' : ',');
  const parsed = lines.map((item) => ({ ...item, cells: parseDelimitedLine(item.line, delimiter) }));
  const first = String(parsed[0].cells[0] || '').toLowerCase();
  if (first.includes('имя') || first === 'name') parsed.shift();
  const rows = [];
  const errors = [];
  for (const item of parsed) {
    if (item.cells.length !== 6) {
      errors.push({ line: item.number, message: `ожидается 6 колонок, найдено ${item.cells.length}` });
      continue;
    }
    const [name, position, typeRaw, dateRaw, okladRaw, planRaw] = item.cells;
    const rowErrors = [];
    const payType = normalizePayType(typeRaw);
    const hireDate = normalizeBulkDate(dateRaw);
    const numericPattern = /^\s*\d+(?:[.,]\d+)?\s*$/;
    const oklad = numericPattern.test(okladRaw) ? num(okladRaw) : NaN;
    const plan = numericPattern.test(planRaw) ? num(planRaw) : NaN;
    if (!name) rowErrors.push('не указано имя');
    if (!position) rowErrors.push('не указана должность');
    if (!payType) rowErrors.push('тип: Менеджер или Руководитель');
    if (!hireDate) rowErrors.push('дата: ГГГГ-ММ-ДД или ДД.ММ.ГГГГ');
    if (!Number.isFinite(oklad) || oklad < 0) rowErrors.push('оклад должен быть числом');
    if (!Number.isFinite(plan) || plan < 0) rowErrors.push('плановая зарплата должна быть числом');
    if (Number.isFinite(oklad) && Number.isFinite(plan) && plan < oklad) rowErrors.push('плановая зарплата меньше оклада');
    if (rowErrors.length) errors.push({ line: item.number, message: rowErrors.join('; ') });
    else rows.push({ line: item.number, name, position, payType, hireDate, oklad: round2(oklad), plan: round2(plan) });
  }
  return { rows, errors, delimiter };
}

function addBulkEmployees(rows, monthKey = currentMonth) {
  const added = [];
  for (const row of rows) {
    const employee = {
      id: uid(),
      name: row.name,
      position: row.position,
      payType: row.payType,
      hireDate: row.hireDate,
      absences: [],
    };
    state.employees.push(employee);
    const record = monthRecord(employee.id, monthKey);
    record.oklad = String(row.oklad);
    record.plan = String(row.plan);
    added.push(employee);
  }
  return added;
}

function out(empId, key, value) {
  return `<span data-out="${empId}:${key}">${escapeHtml(value)}</span>`;
}

function outputs(calculation) {
  return {
    fixedEarned: formatMoney(calculation.fixedEarned),
    fullKpi: formatMoney(calculation.fullKpi),
    kpiEarned: formatMoney(calculation.kpiEarned),
    vacationPay: formatMoney(calculation.vacationPay),
    sickPay: formatMoney(calculation.sickPay),
    bonus: formatMoney(calculation.bonus),
    seniority: formatMoney(calculation.seniority),
    penalty: formatMoney(calculation.penalty),
    manual: formatMoney(calculation.manual),
    accrued: formatMoney(calculation.accrued),
    paidTotal: formatMoney(calculation.paidTotal),
    remaining: calculation.remaining >= 0 ? formatMoney(calculation.remaining) : formatMoney(calculation.overpaid),
    remainingLabel: calculation.remaining >= 0 ? 'Остаток к выплате' : 'Переплата',
    profit: formatMoney(calculation.profit),
    worked: `${calculation.worked} из ${calculation.norm}`,
    normHint: normHint(calculation.employee, currentMonth),
    okladShort: formatMoneyShort(calculation.oklad),
    planShort: formatMoneyShort(calculation.plan),
    accruedShort: formatMoneyShort(calculation.accrued),
    paidShort: formatMoneyShort(calculation.paidTotal),
    remainingShort: (calculation.remaining >= 0 ? '' : '−') + formatMoneyShort(Math.abs(calculation.remaining)),
    profitShort: calculation.profit ? formatMoneyShort(calculation.profit) : '–',
  };
}

function moneyField(empId, name, label, value, options = {}) {
  const attrs = [
    `data-emp="${empId}"`, `data-field="${name}"`, 'type="number"', 'step="0.01"',
    'inputmode="decimal"', options.allowNegative ? '' : 'min="0"',
    `placeholder="${escapeHtml(options.placeholder || '0')}"`,
  ].filter(Boolean).join(' ');
  return `<label class="field"><span>${escapeHtml(label)}</span><input ${attrs} value="${escapeHtml(fieldValue(value))}"></label>`;
}

function textField(empId, name, label, value, type = 'text', options = {}) {
  const attrs = [`data-emp="${empId}"`, `data-field="${name}"`, `type="${type}"`, options.readonly ? 'readonly' : '']
    .filter(Boolean).join(' ');
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

function renderRates() {
  const settings = monthSettings();
  document.getElementById('currencyRates').innerHTML = `
    <div class="rates-title"><strong>Курсы валют</strong><span>RUB за 1 единицу · ${escapeHtml(monthTitle(currentMonth))}</span></div>
    <div class="rates-list">
      ${['USD', 'BYN'].map((currency) => {
        const rate = settings.rates[currency];
        return `<div class="rate-item ${rate.locked ? 'locked' : ''}">
          <label><span>${currency} → RUB</span><input type="number" min="0" step="0.0000001" inputmode="decimal"
            data-rate-input="${currency}" value="${escapeHtml(rate.value)}" ${rate.locked ? 'readonly' : ''} placeholder="0.0000000"></label>
          <button class="btn ${rate.locked ? '' : 'btn-primary'}" type="button" data-rate-lock="${currency}">
            ${rate.locked ? 'Изменить' : 'Зафиксировать'}
          </button>
        </div>`;
      }).join('')}
    </div>`;
}

function renderSummary() {
  const totals = state.employees.reduce((acc, employee) => {
    const calculation = calcEmployee(employee);
    acc.accrued += calculation.accrued;
    acc.remaining += calculation.remaining;
    acc.profit += calculation.profit;
    if (calculation.hasAbsence) acc.absent += 1;
    return acc;
  }, { accrued: 0, remaining: 0, profit: 0, absent: 0 });
  document.getElementById('summary').innerHTML = `
    <div class="stat"><span class="bubble">👥</span><div><span class="label">Сотрудников</span><strong class="value">${state.employees.length}</strong></div></div>
    <div class="stat green"><span class="bubble">₽</span><div><span class="label">Начислено</span><strong class="value">${escapeHtml(formatMoneyShort(totals.accrued))}</strong></div></div>
    <div class="stat blue"><span class="bubble">→</span><div><span class="label">Остаток</span><strong class="value">${escapeHtml(formatMoneyShort(totals.remaining))}</strong></div></div>
    <div class="stat green"><span class="bubble">↗</span><div><span class="label">Прибыль</span><strong class="value">${escapeHtml(formatMoneyShort(totals.profit))}</strong></div></div>
    <div class="stat amber"><span class="bubble">○</span><div><span class="label">Отсутствуют</span><strong class="value">${totals.absent}</strong></div></div>`;
}

function renderErrors() {
  const box = document.getElementById('errors');
  const problems = validate();
  box.hidden = problems.length === 0;
  box.innerHTML = problems.length ? `<strong>Проверьте данные:</strong><ul>${problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('')}</ul>` : '';
}

function renderAbsenceList(employee) {
  const list = employee.absences || [];
  if (!list.length) return '<p class="abs-sub">Отсутствий нет.</p>';
  return `<ul class="abs-list">${list.map((absence) => {
    const meta = ABSENCE_TYPES[absence.type];
    const part = absenceInMonth(absence, currentMonth);
    const inMonth = part
      ? `В ${monthTitle(currentMonth)}: ${part.calendarDays} кал. дн. / ${part.workDays} раб. дн.`
      : 'В выбранном месяце нет';
    const override = part
      ? `<label class="field compact-field"><span>Пропущено раб. дней</span><input class="days" type="number" min="0" step="1" data-abs-days="${absence.id}" data-emp="${employee.id}" value="${part.workDays}"></label>`
      : '';
    const totalDays = parseDate(absence.start) && parseDate(absence.end)
      ? daysBetweenInclusive(parseDate(absence.start), parseDate(absence.end))
      : 0;
    return `<li><div class="abs-main"><strong>${meta.label}</strong> ${escapeHtml(absence.start)} — ${escapeHtml(absence.end)}
      <span class="abs-sub">${escapeHtml(inMonth)} · всего ${totalDays} кал. дн.</span></div>${override}
      <div class="item-actions"><button class="btn" type="button" data-abs-edit="${absence.id}" data-emp="${employee.id}">Изменить</button>
      <button class="btn btn-danger" type="button" data-abs-del="${absence.id}" data-emp="${employee.id}">Удалить</button></div></li>`;
  }).join('')}</ul>`;
}

function renderPayment(calculation, detail) {
  const employeeId = calculation.employee.id;
  const payment = detail.payment;
  const issued = payment.issued;
  const currency = issued ? payment.issuedCurrency : payment.currency;
  const rateReadonly = issued || currency === 'RUB';
  const amountReadonly = issued || payment.autoAmount;
  return `<div class="payment ${issued ? 'paid' : ''}" data-payment-row="${payment.id}">
    <div class="payment-head"><strong>Выплата ${detail.index + 1}</strong>
      <span class="status ${issued ? 'success' : ''}">${issued ? 'Выдано' : 'Запланировано'}</span></div>
    <div class="payment-fields">
      <label class="field"><span>Дата</span><input type="date" data-pay-field="date" data-pay-id="${payment.id}" data-emp="${employeeId}" value="${escapeHtml(issued ? payment.issuedDate : payment.date)}" ${issued ? 'readonly' : ''}></label>
      <label class="field"><span>Валюта</span><select data-pay-field="currency" data-pay-id="${payment.id}" data-emp="${employeeId}" ${issued ? 'disabled' : ''}>
        ${Object.keys(CURRENCIES).map((item) => `<option value="${item}" ${currency === item ? 'selected' : ''}>${item}</option>`).join('')}
      </select></label>
      <label class="field"><span>Сумма в валюте${payment.autoAmount && !issued ? ' (остаток)' : ''}</span><input type="number" min="0" step="0.01" inputmode="decimal"
        data-pay-field="amount" data-pay-id="${payment.id}" data-emp="${employeeId}" value="${escapeHtml(detail.amount || '')}" ${amountReadonly ? 'readonly' : ''} placeholder="0"></label>
      <label class="field"><span>Курс к RUB</span><input type="number" min="0" step="0.0000001" inputmode="decimal"
        data-pay-field="rate" data-pay-id="${payment.id}" data-emp="${employeeId}" value="${escapeHtml(detail.rate || '')}" ${rateReadonly ? 'readonly' : ''} placeholder="0.0000000"></label>
      <label class="field"><span>Эквивалент RUB</span><input type="text" readonly data-payment-rub="${employeeId}:${payment.id}" value="${escapeHtml(formatMoney(detail.rubEquivalent))}"></label>
    </div>
    ${issued ? `<p class="payment-note">Зафиксировано: ${escapeHtml(formatForeign(payment.issuedAmount, payment.issuedCurrency))} × ${escapeHtml(String(payment.issuedRate))} = ${escapeHtml(formatMoney(payment.issuedRub))}, ${escapeHtml(payment.issuedDate)}</p>` : ''}
    <div class="payment-actions">
      ${issued
        ? `<button class="btn" type="button" data-pay-undo="${payment.id}" data-emp="${employeeId}">Отменить выдачу</button>`
        : `<button class="btn btn-primary" type="button" data-pay-mark="${payment.id}" data-emp="${employeeId}">Выдано</button>`}
      <button class="btn btn-danger" type="button" data-pay-del="${payment.id}" data-emp="${employeeId}">Удалить строку</button>
    </div>
  </div>`;
}

function renderDetail(employee, calculation) {
  const id = employee.id;
  const values = outputs(calculation);
  return `<div class="detail">
    <div class="detail-head"><h3>Расчёт ${escapeHtml(employee.name || 'сотрудника')}</h3><div class="detail-actions">
      <button class="btn" type="button" data-calendar="${id}">Календарь</button>
      <button class="btn btn-ghost" type="button" data-abs-add="${id}">＋ Отсутствие</button>
      <button class="btn btn-danger-outline" type="button" data-abs-manage="${id}">Удалить отсутствие</button>
      <button class="btn btn-danger" type="button" data-emp-del="${id}">Удалить сотрудника</button>
    </div></div>
    <div class="fields">
      ${textField(id, 'name', 'Имя', employee.name)}
      ${textField(id, 'position', 'Должность', employee.position)}
      <label class="field"><span>Тип расчёта</span><select data-emp="${id}" data-field="payType">${Object.entries(PAY_TYPES).map(([key, label]) => `<option value="${key}" ${employee.payType === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      ${textField(id, 'hireDate', 'Дата выхода на работу', employee.hireDate, 'date')}
      ${moneyField(id, 'oklad', 'Оклад', calculation.rec.oklad)}
      ${moneyField(id, 'plan', 'Плановая зарплата с KPI', calculation.rec.plan)}
      <label class="field"><span>Полный KPI (авто)</span><input type="text" readonly value="${escapeHtml(formatMoney(calculation.fullKpi))}" data-out-value="${id}:fullKpi"></label>
      <label class="field"><span>Норма дней или смен</span><input type="number" min="0" step="1" data-emp="${id}" data-field="norm" value="${escapeHtml(calculation.rec.normManual ? fieldValue(calculation.rec.norm) : String(calculation.norm))}" ${calculation.rec.normManual ? '' : 'readonly'} data-out-value="${id}:normValue">
        <label class="checkbox"><input type="checkbox" data-emp="${id}" data-field="normManual" ${calculation.rec.normManual ? 'checked' : ''}> Ввести вручную</label><span class="hint">${out(id, 'normHint', values.normHint)}</span></label>
      <label class="field"><span>Отработано (авто)</span><input type="text" readonly value="${escapeHtml(values.worked)}" data-out-value="${id}:worked"></label>
      ${textField(id, 'vacationDays', 'Отпуск, кал./раб. дн.', `${calculation.vacationCal} / ${calculation.vacationWork}`, 'text', { readonly: true })}
      ${textField(id, 'sickDays', 'Больничный, кал./раб. дн.', `${calculation.sickCal} / ${calculation.sickWork}`, 'text', { readonly: true })}
      ${textField(id, 'unpaidDays', 'За свой счёт, кал./раб. дн.', `${calculation.unpaidCal} / ${calculation.unpaidWork}`, 'text', { readonly: true })}
      ${moneyField(id, 'bonus', 'Премия', calculation.rec.bonus)}
      ${moneyField(id, 'seniority', 'Выслуга лет', calculation.rec.seniority)}
      ${moneyField(id, 'penalty', 'Штрафы', calculation.rec.penalty)}
      ${moneyField(id, 'manual', 'Ручная корректировка (±)', calculation.rec.manual, { allowNegative: true })}
      ${moneyField(id, 'revenueOut', 'Оборот выход', calculation.rec.revenueOut)}
      ${moneyField(id, 'revenueIn', 'Оборот вход', calculation.rec.revenueIn)}
      ${textField(id, 'comment', 'Комментарий', calculation.rec.comment)}
    </div>
    <div class="detail-columns">
      <div class="breakdown">
        <div class="line"><span>${calculation.unpaidWork > 0 ? 'Фикс после дней за свой счёт' : 'Фиксированный оклад'}</span>${out(id, 'fixedEarned', values.fixedEarned)}</div>
        <div class="line"><span>Полный KPI</span>${out(id, 'fullKpi', values.fullKpi)}</div>
        <div class="line"><span>KPI за отработанные дни</span>${out(id, 'kpiEarned', values.kpiEarned)}</div>
        <div class="line"><span>Отпускные${calculation.isDirector ? ' (фиксированная выплата)' : ' (справочно, включены в оклад)'}</span>${out(id, 'vacationPay', values.vacationPay)}</div>
        <div class="line"><span>Больничные</span>${out(id, 'sickPay', values.sickPay)}</div>
        <div class="line"><span>Премия</span>${out(id, 'bonus', values.bonus)}</div>
        <div class="line"><span>Выслуга лет</span>${out(id, 'seniority', values.seniority)}</div>
        <div class="line"><span>Штрафы</span>−${out(id, 'penalty', values.penalty)}</div>
        <div class="line"><span>Ручная корректировка</span>${out(id, 'manual', values.manual)}</div>
        <div class="line total"><span>Начислено всего</span>${out(id, 'accrued', values.accrued)}</div>
        <div class="line"><span>Выдано</span>${out(id, 'paidTotal', values.paidTotal)}</div>
        <div class="line total"><span>${out(id, 'remainingLabel', values.remainingLabel)}</span>${out(id, 'remaining', values.remaining)}</div>
        <div class="line"><span>Прибыль</span>${out(id, 'profit', values.profit)}</div>
      </div>
      <div class="payments"><div class="section-head"><h4>Выплаты</h4><button class="btn" type="button" data-pay-add="${id}">＋ Выплата</button></div>
        ${calculation.paymentDetails.length ? calculation.paymentDetails.map((detail) => renderPayment(calculation, detail)).join('') : '<p class="abs-sub">Выплат пока нет.</p>'}
      </div>
    </div>
    <h4>Отсутствия</h4>${renderAbsenceList(employee)}
  </div>`;
}

function renderTable() {
  document.getElementById('gridBody').innerHTML = state.employees.map((employee) => {
    const calculation = calcEmployee(employee);
    const values = outputs(calculation);
    const open = openRows.has(employee.id);
    const main = `<tr class="employee-row ${open ? 'row-open' : ''}" data-toggle-row="${employee.id}" tabindex="0" role="button" aria-expanded="${open}">
      <td class="left"><button class="toggle" type="button" data-toggle="${employee.id}" aria-label="${open ? 'Свернуть' : 'Раскрыть'}">${open ? '⌄' : '›'}</button></td>
      <td class="left"><strong>${escapeHtml(employee.name || 'Без имени')}</strong></td><td class="left pos">${escapeHtml(employee.position || '–')}</td><td class="left pos">${escapeHtml(PAY_TYPES[employee.payType])}</td>
      <td>${out(employee.id, 'okladShort', values.okladShort)}</td><td>${out(employee.id, 'planShort', values.planShort)}</td><td>${out(employee.id, 'worked', values.worked)}</td>
      <td class="left">${absenceTags(employee)}</td><td>${out(employee.id, 'vacationPay', values.vacationPay)}</td>
      <td>${calculation.profit ? `<span class="${calculation.profit > 0 ? 'money-pos' : 'money-neg'}">${out(employee.id, 'profitShort', values.profitShort)}</span>` : '<span class="dash">–</span>'}</td>
      <td><strong>${out(employee.id, 'accruedShort', values.accruedShort)}</strong></td><td>${out(employee.id, 'paidShort', values.paidShort)}</td>
      <td class="${calculation.remaining < 0 ? 'money-neg' : ''}">${out(employee.id, 'remainingShort', values.remainingShort)}</td></tr>`;
    return main + (open ? `<tr class="detail-row"><td colspan="13">${renderDetail(employee, calculation)}</td></tr>` : '');
  }).join('');
}

function renderMobile() {
  document.getElementById('mobileList').innerHTML = state.employees.map((employee) => {
    const calculation = calcEmployee(employee);
    const values = outputs(calculation);
    const open = openRows.has(employee.id);
    return `<article class="emp-card ${open ? 'row-open' : ''}">
      <div class="head" data-toggle-row="${employee.id}" tabindex="0" role="button" aria-expanded="${open}"><div><strong class="name">${escapeHtml(employee.name || 'Без имени')}</strong><span class="pos">${escapeHtml(employee.position || '')} · ${escapeHtml(PAY_TYPES[employee.payType])}</span></div><span class="chevron">${open ? '⌃' : '⌄'}</span></div>
      <div class="card-tags">${absenceTags(employee)}</div>
      <div class="rows"><div class="line"><span>Отработано</span>${out(employee.id, 'worked', values.worked)}</div><div class="line"><span>KPI за дни</span>${out(employee.id, 'kpiEarned', values.kpiEarned)}</div><div class="line"><span>Выдано</span>${out(employee.id, 'paidTotal', values.paidTotal)}</div><div class="line"><span>${out(employee.id, 'remainingLabel', values.remainingLabel)}</span>${out(employee.id, 'remaining', values.remaining)}</div></div>
      <div class="card-total"><span>Начислено</span><strong>${out(employee.id, 'accrued', values.accrued)}</strong></div>
      ${open ? renderDetail(employee, calculation) : ''}</article>`;
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

function render() {
  if (!hasDom) return;
  syncMonthControls();
  renderRates();
  renderSummary();
  renderErrors();
  renderTable();
  renderMobile();
  document.getElementById('emptyHint').hidden = state.employees.length > 0;
}

function patch(empId) {
  const employee = findEmployee(empId);
  if (!employee) return;
  const calculation = calcEmployee(employee);
  const values = outputs(calculation);
  document.querySelectorAll(`[data-out^="${empId}:"]`).forEach((node) => {
    const key = node.dataset.out.split(':')[1];
    if (values[key] !== undefined) node.textContent = values[key];
  });
  document.querySelectorAll(`[data-out-value^="${empId}:"]`).forEach((node) => {
    const key = node.dataset.outValue.split(':')[1];
    if (key === 'fullKpi') node.value = formatMoney(calculation.fullKpi);
    if (key === 'worked') node.value = values.worked;
    if (key === 'normValue' && !calculation.rec.normManual) node.value = String(calculation.norm);
  });
  for (const detail of calculation.paymentDetails) {
    document.querySelectorAll(`[data-payment-rub="${empId}:${detail.payment.id}"]`).forEach((node) => { node.value = formatMoney(detail.rubEquivalent); });
    if (detail.payment.autoAmount && !detail.payment.issued) {
      document.querySelectorAll(`[data-pay-id="${detail.payment.id}"][data-pay-field="amount"]`).forEach((node) => { node.value = detail.amount || ''; });
    }
  }
  renderSummary();
  renderErrors();
}

function addEmployee() {
  const employee = { id: uid(), name: 'Новый сотрудник', position: '', payType: 'manager', hireDate: '', absences: [] };
  state.employees.push(employee);
  monthRecord(employee.id);
  openRows.add(employee.id);
  saveState();
  render();
}

function deleteEmployee(empId) {
  if (!confirm('Удалить сотрудника вместе со всеми его данными?')) return;
  state.employees = state.employees.filter((employee) => employee.id !== empId);
  for (const month of Object.keys(state.months)) delete state.months[month][empId];
  openRows.delete(empId);
  saveState();
  render();
}

function copyPreviousMonth() {
  const previous = prevMonthKey(currentMonth);
  const source = state.months[previous];
  if (!source || !Object.keys(source).length) {
    if (hasDom) alert(`В месяце ${monthTitle(previous)} нет данных для копирования.`);
    return false;
  }
  if (hasDom && !confirm(`Скопировать оклады, плановые зарплаты и норму из месяца ${monthTitle(previous)}?`)) return false;
  state.months[currentMonth] = state.months[currentMonth] || {};
  for (const employee of state.employees) {
    const from = source[employee.id];
    if (!from) continue;
    state.months[currentMonth][employee.id] = {
      ...defaultMonthRecord(currentMonth),
      oklad: from.oklad,
      plan: from.plan,
      norm: from.norm,
      normManual: from.normManual,
    };
  }
  saveState();
  render();
  return true;
}

const MONEY_FIELDS = new Set(['oklad', 'plan', 'bonus', 'seniority', 'penalty', 'manual', 'revenueOut', 'revenueIn', 'norm']);
function setEmployeeField(empId, fieldName, value) {
  const employee = findEmployee(empId);
  if (!employee) return;
  if (['name', 'position', 'hireDate', 'payType'].includes(fieldName)) employee[fieldName] = value;
  else if (fieldName === 'comment') monthRecord(empId).comment = value;
  else if (fieldName === 'normManual') {
    const record = monthRecord(empId);
    record.normManual = value;
    if (value && record.norm === '') record.norm = String(autoNorm(employee, currentMonth));
  } else if (MONEY_FIELDS.has(fieldName)) monthRecord(empId)[fieldName] = value === '' ? '' : String(value);
  saveState();
}

function addPayment(empId) {
  const record = monthRecord(empId);
  record.payments.push(defaultPayment('custom'));
  saveState();
  render();
}

function deletePayment(empId, paymentId) {
  const record = monthRecord(empId);
  const payment = paymentReference(record, paymentId);
  if (!payment) return;
  const message = payment.issued ? 'Удалить уже выданную выплату? Остаток будет пересчитан.' : 'Удалить эту строку выплаты?';
  if (!confirm(message)) return;
  record.payments = record.payments.filter((item) => item.id !== payment.id);
  saveState();
  render();
}

let modalContext = null;
function openModal(title, bodyHtml, options = {}) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  const saveButton = document.getElementById('modalSave');
  saveButton.hidden = !!options.hideSave;
  saveButton.disabled = !!options.disableSave;
  saveButton.textContent = options.saveLabel || 'Сохранить';
  document.getElementById('modalCancel').textContent = options.closeLabel || 'Отмена';
  document.getElementById('modal').hidden = false;
}

function closeModal() {
  document.getElementById('modal').hidden = true;
  modalContext = null;
}

function openAbsenceModal(empId, absenceId) {
  const employee = findEmployee(empId);
  if (!employee) return;
  const existing = (employee.absences || []).find((absence) => absence.id === String(absenceId));
  const defaults = existing || { type: 'vacation', start: toIso(monthBounds(currentMonth).from), end: toIso(monthBounds(currentMonth).from) };
  modalContext = { kind: 'absence', empId, absenceId: existing ? existing.id : null };
  openModal(existing ? 'Изменить отсутствие' : 'Добавить отсутствие', `
    <div class="modal-fields"><label class="field"><span>Тип</span><select id="absType">${Object.entries(ABSENCE_TYPES).map(([key, meta]) => `<option value="${key}" ${defaults.type === key ? 'selected' : ''}>${meta.label}</option>`).join('')}</select></label>
    <label class="field"><span>Дата начала</span><input type="date" id="absStart" value="${escapeHtml(defaults.start)}"></label>
    <label class="field"><span>Дата окончания</span><input type="date" id="absEnd" value="${escapeHtml(defaults.end)}"></label>
    <label class="field"><span>Календарных дней (авто)</span><input type="text" id="absCal" readonly></label>
    <label class="field"><span>Пропущено рабочих дней (авто)</span><input type="text" id="absWork" readonly></label></div><div class="modal-error" id="absError"></div>`);
  const refresh = () => {
    const start = parseDate(document.getElementById('absStart').value);
    const end = parseDate(document.getElementById('absEnd').value);
    const valid = start && end && end >= start;
    document.getElementById('absCal').value = valid ? daysBetweenInclusive(start, end) : '—';
    document.getElementById('absWork').value = valid ? CAL.workdaysBetween(start, end) : '—';
  };
  document.getElementById('absStart').addEventListener('input', refresh);
  document.getElementById('absEnd').addEventListener('input', refresh);
  refresh();
}

function saveAbsence() {
  if (!modalContext || modalContext.kind !== 'absence') return;
  const employee = findEmployee(modalContext.empId);
  const result = upsertAbsence(employee, {
    type: document.getElementById('absType').value,
    start: document.getElementById('absStart').value,
    end: document.getElementById('absEnd').value,
  }, modalContext.absenceId);
  if (!result.ok) { document.getElementById('absError').textContent = result.error; return; }
  saveState();
  closeModal();
  render();
}

function absenceManagerHtml(employee) {
  const entries = absencesOfMonth(employee, currentMonth);
  if (!entries.length) return `<p class="empty-modal">У ${escapeHtml(employee.name || 'сотрудника')} нет отсутствий в ${escapeHtml(monthTitle(currentMonth))}.</p>`;
  return `<p class="modal-intro">${escapeHtml(employee.name || 'Сотрудник')} · ${escapeHtml(monthTitle(currentMonth))}</p><ul class="absence-delete-list">${entries.map(({ absence, part }) => `<li><div><strong>${escapeHtml(ABSENCE_TYPES[absence.type].label)}</strong><span>${escapeHtml(formatDayMonth(part.from))}–${escapeHtml(formatDayMonth(part.to))}</span></div><button class="btn btn-danger" type="button" data-modal-abs-del="${absence.id}" data-emp="${employee.id}">Удалить</button></li>`).join('')}</ul>`;
}

function openAbsenceManager(empId) {
  const employee = findEmployee(empId);
  if (!employee) return;
  modalContext = { kind: 'absence-manager', empId };
  openModal('Удалить отсутствие', absenceManagerHtml(employee), { hideSave: true, closeLabel: 'Закрыть' });
}

function openBulkModal() {
  modalContext = { kind: 'bulk', parsed: { rows: [], errors: [] } };
  openModal('Массовое добавление', `
    <p class="modal-intro">Вставьте 6 колонок из Excel, Google Sheets, CSV или TSV. Первая строка с заголовками необязательна.</p>
    <pre class="bulk-example">Имя\tДолжность\tТип расчёта\tДата выхода\tОклад\tЗП с KPI
Анна П.\tМенеджер\tМенеджер\t2026-09-01\t60000\t130000</pre>
    <label class="field"><span>Строки сотрудников</span><textarea id="bulkInput" rows="7" placeholder="Вставьте строки сюда"></textarea></label>
    <div class="bulk-preview" id="bulkPreview"><p class="abs-sub">Предварительная проверка появится здесь.</p></div>`,
  { saveLabel: 'Добавить всех', disableSave: true });
  document.getElementById('bulkInput').focus();
}

function updateBulkPreview() {
  if (!modalContext || modalContext.kind !== 'bulk') return;
  const parsed = parseBulkEmployees(document.getElementById('bulkInput').value);
  modalContext.parsed = parsed;
  const preview = document.getElementById('bulkPreview');
  const errors = parsed.errors.length
    ? `<ul class="bulk-errors">${parsed.errors.map((error) => `<li>${error.line ? `Строка ${error.line}: ` : ''}${escapeHtml(error.message)}</li>`).join('')}</ul>`
    : '';
  const rows = parsed.rows.length
    ? `<div class="bulk-ok">Готово к добавлению: <strong>${parsed.rows.length}</strong></div><div class="bulk-table-wrap"><table class="bulk-table"><thead><tr><th>Имя</th><th>Должность</th><th>Тип</th><th>Дата</th><th>Оклад</th><th>С KPI</th></tr></thead><tbody>${parsed.rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.position)}</td><td>${escapeHtml(PAY_TYPES[row.payType])}</td><td>${escapeHtml(row.hireDate)}</td><td>${escapeHtml(formatMoneyShort(row.oklad))}</td><td>${escapeHtml(formatMoneyShort(row.plan))}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  preview.innerHTML = errors + rows;
  document.getElementById('modalSave').disabled = parsed.errors.length > 0 || parsed.rows.length === 0;
}

function saveBulk() {
  const parsed = modalContext && modalContext.kind === 'bulk' ? modalContext.parsed : null;
  if (!parsed || parsed.errors.length || !parsed.rows.length) return;
  const added = addBulkEmployees(parsed.rows);
  added.forEach((employee) => openRows.add(employee.id));
  saveState();
  closeModal();
  render();
}

function dayClass(employee, date) {
  const iso = toIso(date);
  for (const { part } of absencesOfMonth(employee, currentMonth)) {
    if (iso >= part.from && iso <= part.to) return `day-${part.type}`;
  }
  const hire = parseDate(employee.hireDate);
  if (hire && date < hire) return 'day-before-hire';
  if (!CAL.isWorkingDay(date)) return 'day-off';
  return 'day-work';
}

function openCalendarModal(empId) {
  const employee = findEmployee(empId);
  if (!employee) return;
  modalContext = { kind: 'calendar', empId };
  const { from, to } = monthBounds(currentMonth);
  const cells = [];
  for (let i = 0; i < (from.getUTCDay() + 6) % 7; i += 1) cells.push('<div class="day empty"></div>');
  for (const day = new Date(from); day <= to; day.setUTCDate(day.getUTCDate() + 1)) cells.push(`<div class="day ${dayClass(employee, day)}">${day.getUTCDate()}</div>`);
  const calculation = calcEmployee(employee);
  openModal(`Календарь: ${monthTitle(currentMonth)}`, `<p class="abs-sub">${escapeHtml(normHint(employee, currentMonth))}. Отработано: ${calculation.worked} из ${calculation.norm}.</p><div class="cal-grid">${WEEKDAY_NAMES.map((day) => `<div class="day head">${day}</div>`).join('')}${cells.join('')}</div><div class="cal-legend"><span><i class="day-work"></i> в норме</span><span><i class="day-off"></i> выходной или праздник</span><span><i class="day-before-hire"></i> до выхода</span><span><i class="day-vacation"></i> отпуск</span><span><i class="day-sick"></i> больничный</span><span><i class="day-unpaid"></i> за свой счёт</span></div>`, { hideSave: true, closeLabel: 'Закрыть' });
}

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
  'Полный KPI', 'Норма дней', 'Отработано', 'Отпуск кал.', 'Отпуск раб.', 'Больничный кал.', 'Больничный раб.',
  'За свой счёт кал.', 'За свой счёт раб.', 'KPI за отработанные дни', 'Отпускные (справочно у менеджера)', 'Больничные',
  'Премия', 'Выслуга лет', 'Штрафы', 'Ручная корректировка', 'Начислено', 'Первая выплата', 'Дата первой выплаты',
  'Вторая выплата', 'Дата второй выплаты', 'Всего выдано', 'Остаток', 'Переплата', 'Оборот выход', 'Оборот вход',
  'Прибыль', 'Комментарий', 'Выплаты: дата', 'Выплаты: валюта', 'Выплаты: сумма в валюте', 'Выплаты: курс к RUB',
  'Выплаты: эквивалент RUB', 'Выплаты: выдано'];

function csvValue(value) {
  const text = typeof value === 'number' ? String(round2(value)).replace('.', ',') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(monthKey = currentMonth) {
  const rows = [CSV_HEADERS.map(csvValue).join(';')];
  for (const employee of state.employees) {
    const c = calcEmployee(employee, monthKey);
    const details = c.paymentDetails;
    const first = details[0];
    const second = details[1];
    const joined = (getter) => details.map(getter).join(' | ');
    rows.push([
      employee.name, employee.position, PAY_TYPES[employee.payType], employee.hireDate,
      c.oklad, c.fixedEarned, c.plan, c.fullKpi, c.norm, c.worked, c.vacationCal, c.vacationWork,
      c.sickCal, c.sickWork, c.unpaidCal, c.unpaidWork, c.kpiEarned, c.vacationPay, c.sickPay,
      c.bonus, c.seniority, c.penalty, c.manual, c.accrued,
      first && first.payment.issued ? first.rubEquivalent : 0, first && first.payment.issued ? first.payment.issuedDate : '',
      second && second.payment.issued ? second.rubEquivalent : 0, second && second.payment.issued ? second.payment.issuedDate : '',
      c.paidTotal, Math.max(c.remaining, 0), c.overpaid, c.revenueOut, c.revenueIn, c.profit, c.rec.comment,
      joined((detail) => detail.payment.issued ? detail.payment.issuedDate : detail.payment.date),
      joined((detail) => detail.currency), joined((detail) => detail.amount), joined((detail) => detail.rate),
      joined((detail) => detail.rubEquivalent), joined((detail) => detail.payment.issued ? 'Да' : 'Нет'),
    ].map(csvValue).join(';'));
  }
  return '\uFEFF' + rows.join('\r\n');
}

function exportCsv() {
  download(`zarplata-${currentMonth}.csv`, buildCsv(), 'text/csv;charset=utf-8');
}

function exportBackup() {
  download(`zarplata-backup-${currentMonth}.json`, JSON.stringify({ ...state, currentMonth }, null, 2), 'application/json');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed || !Array.isArray(parsed.employees) || typeof parsed.months !== 'object') throw new Error('Неверный формат файла');
      if (!confirm('Заменить текущие данные данными из файла?')) return;
      state = migrate(parsed);
      if (parsed.currentMonth) currentMonth = normalizeMonthKey(parsed.currentMonth, currentMonth);
      openRows.clear();
      saveState();
      render();
      alert('Резервная копия загружена.');
    } catch (error) {
      alert(`Не удалось прочитать файл: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

function changeMonthBy(delta) {
  const next = shiftMonthKey(currentMonth, delta);
  if (!next) return;
  currentMonth = next;
  saveState();
  render();
}

function toggleRow(empId) {
  const id = String(empId);
  if (openRows.has(id)) openRows.delete(id); else openRows.add(id);
  render();
}

function onInput(event) {
  const target = event.target;
  if (target.id === 'bulkInput') { updateBulkPreview(); return; }
  if (target.dataset.rateInput) {
    const rate = monthSettings().rates[target.dataset.rateInput];
    if (!rate.locked) { rate.value = target.value; saveState(); }
    return;
  }
  if (target.dataset.field !== undefined && !target.readOnly) {
    const value = target.type === 'checkbox' ? target.checked : target.value;
    setEmployeeField(target.dataset.emp, target.dataset.field, value);
    if (target.dataset.field === 'normManual' || target.dataset.field === 'payType') render(); else patch(target.dataset.emp);
    return;
  }
  if (target.dataset.payField) {
    const record = monthRecord(target.dataset.emp);
    const payment = paymentReference(record, target.dataset.payId);
    if (!payment || payment.issued) return;
    const field = target.dataset.payField;
    payment[field] = target.value;
    if (field === 'currency') {
      payment.currency = normalizeCurrency(target.value);
      payment.rate = payment.currency === 'RUB' ? '1' : monthSettings().rates[payment.currency].value;
      saveState();
      render();
    } else {
      saveState();
      patch(target.dataset.emp);
    }
    return;
  }
  if (target.dataset.absDays) {
    const employee = findEmployee(target.dataset.emp);
    const absence = employee && (employee.absences || []).find((item) => item.id === target.dataset.absDays);
    if (!absence) return;
    absence.overrides = absence.overrides || {};
    absence.overrides[currentMonth] = Math.max(0, num(target.value));
    saveState();
    patch(employee.id);
  }
}

function onFocusIn(event) {
  const target = event.target;
  if (target.tagName !== 'INPUT' || target.type !== 'number' || target.readOnly || target.value !== '0') return;
  target.value = '';
  if (target.dataset.field) setEmployeeField(target.dataset.emp, target.dataset.field, '');
  if (target.dataset.payField === 'amount') {
    const payment = paymentReference(monthRecord(target.dataset.emp), target.dataset.payId);
    if (payment && !payment.issued) { payment.amount = ''; saveState(); }
  }
}

function onClick(event) {
  const target = event.target.closest('[data-toggle], [data-abs-add], [data-abs-manage], [data-abs-edit], [data-abs-del], [data-modal-abs-del], [data-emp-del], [data-calendar], [data-pay-add], [data-pay-mark], [data-pay-undo], [data-pay-del], [data-rate-lock]');
  if (target) {
    const data = target.dataset;
    if (data.toggle) toggleRow(data.toggle);
    else if (data.absAdd) openAbsenceModal(data.absAdd, null);
    else if (data.absManage) openAbsenceManager(data.absManage);
    else if (data.absEdit) openAbsenceModal(data.emp, data.absEdit);
    else if (data.absDel || data.modalAbsDel) {
      const absenceId = data.absDel || data.modalAbsDel;
      const employee = findEmployee(data.emp);
      if (employee && confirm('Удалить это отсутствие?') && deleteAbsence(employee, absenceId)) {
        saveState();
        render();
        if (data.modalAbsDel) {
          modalContext = { kind: 'absence-manager', empId: employee.id };
          document.getElementById('modalBody').innerHTML = absenceManagerHtml(employee);
        }
      }
    } else if (data.empDel) deleteEmployee(data.empDel);
    else if (data.calendar) openCalendarModal(data.calendar);
    else if (data.payAdd) addPayment(data.payAdd);
    else if (data.payMark) markPaid(data.emp, data.payMark);
    else if (data.payUndo) undoPaid(data.emp, data.payUndo);
    else if (data.payDel) deletePayment(data.emp, data.payDel);
    else if (data.rateLock) {
      const entry = monthSettings().rates[data.rateLock];
      if (entry.locked) entry.locked = false;
      else if (num(entry.value) <= 0) { alert('Сначала укажите курс больше нуля.'); return; }
      else entry.locked = true;
      saveState();
      renderRates();
    }
    return;
  }
  const row = event.target.closest('[data-toggle-row]');
  if (!row || event.target.closest('button, a, input, select, textarea, label')) return;
  toggleRow(row.dataset.toggleRow);
}

function onKeyDown(event) {
  const row = event.target.closest('[data-toggle-row]');
  if (!row || event.target !== row || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  toggleRow(row.dataset.toggleRow);
}

function saveModal() {
  if (!modalContext) return;
  if (modalContext.kind === 'absence') saveAbsence();
  else if (modalContext.kind === 'bulk') saveBulk();
}

function syncThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const button = document.getElementById('btnTheme');
  button.setAttribute('aria-pressed', String(dark));
  button.textContent = dark ? '☀ Светлая' : '◐ Тёмная';
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  syncThemeButton();
}

function init() {
  loadState();
  syncThemeButton();
  const selectMonth = () => {
    const next = monthKeyFromParts(document.getElementById('yearInput').value, document.getElementById('monthSelect').value);
    if (!next) { syncMonthControls(); return; }
    currentMonth = next;
    saveState();
    render();
  };
  document.getElementById('monthSelect').addEventListener('change', selectMonth);
  document.getElementById('yearInput').addEventListener('change', selectMonth);
  document.getElementById('btnPrevMonth').addEventListener('click', () => changeMonthBy(-1));
  document.getElementById('btnNextMonth').addEventListener('click', () => changeMonthBy(1));
  document.getElementById('btnAdd').addEventListener('click', addEmployee);
  document.getElementById('btnBulk').addEventListener('click', openBulkModal);
  document.getElementById('btnCopy').addEventListener('click', copyPreviousMonth);
  document.getElementById('btnCalc').addEventListener('click', () => { saveState(); render(); });
  document.getElementById('btnCsv').addEventListener('click', exportCsv);
  document.getElementById('btnBackup').addEventListener('click', exportBackup);
  document.getElementById('btnRestore').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('btnTheme').addEventListener('click', toggleTheme);
  document.getElementById('fileInput').addEventListener('change', (event) => {
    if (event.target.files && event.target.files[0]) importBackup(event.target.files[0]);
    event.target.value = '';
  });
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalSave').addEventListener('click', saveModal);
  document.getElementById('modal').addEventListener('click', (event) => { if (event.target.id === 'modal') closeModal(); });
  document.addEventListener('input', onInput);
  document.addEventListener('change', (event) => { if (event.target.tagName === 'SELECT' && (event.target.dataset.field || event.target.dataset.payField)) onInput(event); });
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('modal').hidden) closeModal();
    else onKeyDown(event);
  });
  render();
}

if (hasDom) document.addEventListener('DOMContentLoaded', init);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    round2, formatMoney, num, parseDate, autoNorm, calcEmployee, validate, migrate,
    markPaid, undoPaid, monthRecord, monthSettings, setMonthRate, copyPreviousMonth,
    shiftMonthKey, monthKeyFromParts, normalizeMonthKey, normalizeAbsences,
    normalizePayments, validateAbsenceDraft, upsertAbsence, deleteAbsence,
    parseBulkEmployees, addBulkEmployees, buildCsv, issuedRub,
    setTestState: (nextState, monthKey) => {
      state = migrate(nextState);
      currentMonth = normalizeMonthKey(monthKey, currentMonth);
      return state;
    },
    getState: () => state,
    setCurrentMonth: (monthKey) => { currentMonth = normalizeMonthKey(monthKey, currentMonth); },
  };
}
