/* Проверка формул v2: node tests/check.js */
const assert = require('assert');
const app = require('../app.js');
const CAL = require('../calendar.js');

function check(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: получено ${actual}, ожидалось ${expected}`);
  console.log(`ok  ${label} = ${actual}`);
}

function checkTrue(label, value) {
  assert.ok(value, label);
  console.log(`ok  ${label}`);
}

/* ---------- Производственный календарь ---------- */

const d = (iso) => new Date(iso + 'T00:00:00Z');

check('Рабочих дней в июле 2026', CAL.workdaysBetween(d('2026-07-01'), d('2026-07-31')), 23);
check('Рабочих дней в августе 2026', CAL.workdaysBetween(d('2026-08-01'), d('2026-08-31')), 21);
check('Рабочих дней с 5 по 31 августа 2026', CAL.workdaysBetween(d('2026-08-05'), d('2026-08-31')), 19);
check('9 мая 2026 — нерабочий', CAL.isWorkingDay(d('2026-05-09')), false);

/* ---------- Данные для расчётов ---------- */

const baseState = () => ({
  version: 2,
  employees: [
    {
      id: 'alexey',
      name: 'Алексей Ч.',
      position: 'Менеджер отдела',
      payType: 'manager',
      hireDate: '',
      absences: [{ id: 'a1', type: 'vacation', start: '2026-07-27', end: '2026-08-09', overrides: {} }],
    },
    {
      id: 'artem',
      name: 'Артём Б.',
      position: 'Руководитель',
      payType: 'director',
      hireDate: '',
      absences: [{ id: 'a2', type: 'vacation', start: '2026-08-01', end: '2026-08-14', overrides: {} }],
    },
    {
      id: 'novichok',
      name: 'Новый сотрудник',
      position: 'Менеджер',
      payType: 'manager',
      hireDate: '2026-08-05',
      absences: [],
    },
  ],
  months: {
    '2026-07': {
      alexey: { oklad: 60000, plan: 200000 },
    },
    '2026-08': {
      alexey: { oklad: 60000, plan: 200000, revenueOut: 82003087, revenueIn: 56455540 },
      artem: { oklad: 60000, plan: 266000 },
      novichok: { oklad: 60000, plan: 200000 },
    },
  },
});

function load(monthKey) {
  return app.setTestState(baseState(), monthKey);
}

const employeeOf = (state, id) => state.employees.find((e) => e.id === id);

/* ---------- Менеджер ---------- */

let state = load('2026-07');
let c = app.calcEmployee(employeeOf(state, 'alexey'), '2026-07');
check('Алексей, июль: норма считается автоматически', c.norm, 23);
check('Алексей, июль: календарные дни отпуска', c.vacationCal, 5);
check('Алексей, июль: рабочие дни отпуска', c.vacationWork, 5);
check('Алексей, июль: отработано', c.worked, 18);
check('Алексей, июль: оклад не уменьшается из-за отпуска', c.oklad, 60000);
check('Алексей, июль: полный KPI', c.fullKpi, 140000);
check('Алексей, июль: KPI за отработанные дни', c.kpiEarned, 109565.22);
check('Алексей, июль: отпускные только от оклада', c.vacationPay, 10238.91);
check('Алексей, июль: начислено', c.accrued, 179804.13);

state = load('2026-08');
c = app.calcEmployee(employeeOf(state, 'alexey'), '2026-08');
check('Алексей, август: норма', c.norm, 21);
check('Алексей, август: календарные дни отпуска', c.vacationCal, 9);
check('Алексей, август: рабочие дни отпуска', c.vacationWork, 5);
check('Алексей, август: отработано', c.worked, 16);
check('Алексей, август: KPI за отработанные дни', c.kpiEarned, 106666.67);
check('Алексей, август: отпускные', c.vacationPay, 18430.03);
check('Алексей, август: начислено', c.accrued, 185096.70);
check('Алексей, август: прибыль', c.profit, 25547547);

/* ---------- Руководитель ---------- */

c = app.calcEmployee(employeeOf(state, 'artem'), '2026-08');
check('Артём, август: рабочие дни отпуска', c.vacationWork, 10);
check('Артём, август: отработано', c.worked, 11);
check('Артём, август: оклад полностью', c.oklad, 60000);
check('Артём, август: KPI за отработанные дни', c.kpiEarned, 107904.76);
check('Артём, август: фиксированные отпускные', c.vacationPay, 60000);
check('Артём, август: начислено', c.accrued, 227904.76);

/* Руководитель без отпуска не получает фиксированные отпускные. */
state = load('2026-07');
state.months['2026-07'].artem = { oklad: 60000, plan: 266000 };
c = app.calcEmployee(employeeOf(state, 'artem'), '2026-07');
check('Артём, июль без отпуска: отпускные', c.vacationPay, 0);
check('Артём, июль без отпуска: начислено', c.accrued, 266000);

/* ---------- Дата выхода ---------- */

state = load('2026-08');
const novichok = employeeOf(state, 'novichok');
c = app.calcEmployee(novichok, '2026-08');
check('Дата выхода 5 августа: норма', c.norm, 19);
check('Дата выхода 5 августа: отработано', c.worked, 19);
check('Дата выхода 5 августа: KPI полностью за свою норму', c.kpiEarned, 140000);
check('Дата выхода 5 августа: начислено', c.accrued, 200000);

/* Ручной ввод нормы имеет приоритет над автоматической. */
state.months['2026-08'].novichok.normManual = true;
state.months['2026-08'].novichok.norm = 15;
c = app.calcEmployee(novichok, '2026-08');
check('Ручная норма', c.norm, 15);

/* ---------- Премия, выслуга, штраф, корректировка ---------- */

state = load('2026-07');
const alexeyJuly = state.months['2026-07'].alexey;
const baseAccrued = app.calcEmployee(employeeOf(state, 'alexey'), '2026-07').accrued;
alexeyJuly.bonus = 10000;
alexeyJuly.seniority = 5000;
check('Премия и выслуга увеличивают итог',
  app.calcEmployee(employeeOf(state, 'alexey'), '2026-07').accrued, app.round2(baseAccrued + 15000));
alexeyJuly.penalty = 3000;
check('Штраф уменьшает итог',
  app.calcEmployee(employeeOf(state, 'alexey'), '2026-07').accrued, app.round2(baseAccrued + 12000));
alexeyJuly.manual = -2000;
check('Ручная корректировка может быть отрицательной',
  app.calcEmployee(employeeOf(state, 'alexey'), '2026-07').accrued, app.round2(baseAccrued + 10000));

/* ---------- Пустые поля ---------- */

state = load('2026-07');
state.months['2026-07'].alexey.bonus = '';
c = app.calcEmployee(employeeOf(state, 'alexey'), '2026-07');
check('Пустое поле трактуется как ноль', c.bonus, 0);
check('Пустое поле не ломает итог', c.accrued, 179804.13);
check('Ввод 123 в пустое поле даёт 123', app.num('123'), 123);
check('Строка "0123" не появляется при вводе', app.num('0123'), 123);

/* ---------- Выплаты ---------- */

state = load('2026-08');
const payEmp = employeeOf(state, 'alexey');
state.months['2026-08'].alexey = { oklad: 60000, plan: 100000, normManual: true, norm: 21 };
state.employees[0].absences = [];
c = app.calcEmployee(payEmp, '2026-08');
check('Начислено для проверки выплат', c.accrued, 100000);
check('Первая выплата менеджера по умолчанию', c.firstPlanned, 60000);

app.markPaid('alexey', 'first');
c = app.calcEmployee(payEmp, '2026-08');
check('Всего выдано после первой выплаты', c.paidTotal, 60000);
check('Остаток к 15-му числу', c.remaining, 40000);
checkTrue('Фактическая дата первой выплаты сохранена', !!c.rec.payments.first.paidDate);

app.markPaid('alexey', 'second');
c = app.calcEmployee(payEmp, '2026-08');
check('Остаток после второй выплаты', c.remaining, 0);
check('Всего выдано', c.paidTotal, 100000);

state.months['2026-08'].alexey.bonus = 5000;
c = app.calcEmployee(payEmp, '2026-08');
check('После увеличения начисления виден долг', c.remaining, 5000);
state.months['2026-08'].alexey.bonus = '';
state.months['2026-08'].alexey.penalty = 7000;
c = app.calcEmployee(payEmp, '2026-08');
check('После уменьшения начисления видна переплата', c.overpaid, 7000);

/* Пример из ТЗ: начислено 160 000, первая выплата 60 000, остаток 100 000. */
state = load('2026-08');
state.employees[0].absences = [];
state.months['2026-08'].alexey = { oklad: 60000, plan: 160000, normManual: true, norm: 21 };
c = app.calcEmployee(employeeOf(state, 'alexey'), '2026-08');
check('Пример ТЗ: начислено', c.accrued, 160000);
app.markPaid('alexey', 'first');
check('Пример ТЗ: остаток', app.calcEmployee(employeeOf(state, 'alexey'), '2026-08').remaining, 100000);

/* Руководителю сумма первой выплаты не подставляется. */
state = load('2026-08');
c = app.calcEmployee(employeeOf(state, 'artem'), '2026-08');
check('Первая выплата руководителя не подставляется', c.firstPlanned, 0);

/* ---------- Совместимость со старыми данными ---------- */

const oldBackup = {
  version: 1,
  currentMonth: '2026-08',
  employees: [
    {
      id: 'alexey',
      name: 'Алексей Ч.',
      position: 'Менеджер',
      absences: [{ id: 'a1', type: 'vacation', start: '2026-07-27', end: '2026-08-09', overrides: { '2026-08': 5 } }],
    },
  ],
  months: {
    '2026-07': { alexey: { oklad: 60000, plan: 200000, norm: 23, manual: 0, revenueOut: 0, revenueIn: 0, comment: 'старый месяц' } },
    '2026-08': { alexey: { oklad: 60000, plan: 200000, norm: 21, manual: 0, revenueOut: 82003087, revenueIn: 56455540, comment: '' } },
  },
};

const migrated = app.migrate(oldBackup);
check('Старая копия: сотрудники не потеряны', migrated.employees.length, 1);
check('Старая копия: месяцы не потеряны', Object.keys(migrated.months).length, 2);
check('Старая копия: тип расчёта по умолчанию', migrated.employees[0].payType, 'manager');
check('Старая копия: комментарий сохранён', migrated.months['2026-07'].alexey.comment, 'старый месяц');
check('Старая копия: норма остаётся ручной', migrated.months['2026-08'].alexey.normManual, true);
check('Старая копия: новые поля пустые', migrated.months['2026-08'].alexey.bonus, '');
check('Старая копия: выплаты не выданы', migrated.months['2026-08'].alexey.payments.first.paidAmount, null);
check('Старая копия: отсутствия сохранены', migrated.employees[0].absences[0].start, '2026-07-27');

state = app.setTestState(oldBackup, '2026-08');
c = app.calcEmployee(state.employees[0], '2026-08');
check('Старая копия считается по новым формулам', c.accrued, 185096.70);

/* ---------- Форматирование ---------- */

check('Формат денег', app.formatMoney(82003087), '82 003 087,00 ₽');
check('Формат пустого значения', app.formatMoney(''), '0,00 ₽');

console.log('\nВсе проверки пройдены.');
