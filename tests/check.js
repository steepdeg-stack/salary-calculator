/* Проверка формул на примерах из технического задания: node tests/check.js */
const assert = require('assert');
const app = require('../app.js');

const employees = [
  {
    id: 'alexey',
    name: 'Алексей Ч.',
    position: 'Менеджер',
    absences: [{ id: 'a1', type: 'vacation', start: '2026-07-27', end: '2026-08-09', overrides: {} }],
  },
  {
    id: 'artem',
    name: 'Артём Б.',
    position: 'Руководитель',
    absences: [{ id: 'a2', type: 'vacation', start: '2026-08-01', end: '2026-08-14', overrides: {} }],
  },
];

const months = {
  '2026-07': {
    alexey: { oklad: 60000, plan: 200000, norm: 23, manual: 0, revenueOut: 0, revenueIn: 0, comment: '' },
  },
  '2026-08': {
    alexey: { oklad: 60000, plan: 200000, norm: 21, manual: 0, revenueOut: 82003087, revenueIn: 56455540, comment: '' },
    artem: { oklad: 60000, plan: 266000, norm: 21, manual: 0, revenueOut: 0, revenueIn: 0, comment: '' },
  },
};

const state = { version: 1, employees, months };

function check(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: получено ${actual}, ожидалось ${expected}`);
  console.log(`ok  ${label} = ${actual}`);
}

app.setTestState(state, '2026-07');
let c = app.calcEmployee(employees[0], '2026-07');
check('Алексей, июль: календарные дни отпуска', c.vacationCal, 5);
check('Алексей, июль: рабочие дни отпуска', c.vacationWork, 5);
check('Алексей, июль: отработано', c.worked, 18);
check('Алексей, июль: зарплата за работу', c.salaryWork, 156521.74);
check('Алексей, июль: отпускные', c.vacationPay, 10238.91);
check('Алексей, июль: итог', c.total, 166760.65);

app.setTestState(state, '2026-08');
c = app.calcEmployee(employees[0], '2026-08');
check('Алексей, август: календарные дни отпуска', c.vacationCal, 9);
check('Алексей, август: рабочие дни отпуска', c.vacationWork, 5);
check('Алексей, август: отработано', c.worked, 16);
check('Алексей, август: оклад за работу', c.okladWork, 45714.29);
check('Алексей, август: KPI за работу', c.kpiWork, 106666.67);
check('Алексей, август: зарплата за работу', c.salaryWork, 152380.95);
check('Алексей, август: отпускные', c.vacationPay, 18430.03);
check('Алексей, август: итог', c.total, 170810.98);
check('Алексей, август: прибыль', c.profit, 25547547);

c = app.calcEmployee(employees[1], '2026-08');
check('Артём, август: календарные дни отпуска', c.vacationCal, 14);
check('Артём, август: рабочие дни отпуска', c.vacationWork, 10);
check('Артём, август: отработано', c.worked, 11);
check('Артём, август: зарплата за работу', c.salaryWork, 139333.33);
check('Артём, август: отпускные', c.vacationPay, 28668.94);
check('Артём, август: итог', c.total, 168002.27);

months['2026-08'].artem.plan = 290000;
c = app.calcEmployee(employees[1], '2026-08');
check('Артём, август при плане 290 000: итог', c.total, 180573.70);
months['2026-08'].artem.plan = 266000;

check('Полные отпускные Алексея за 14 дней', app.round2(60000 / 29.3 * 14), 28668.94);
check('Формат денег', app.formatMoney(82003087), '82 003 087,00 ₽');

console.log('\nВсе проверки пройдены.');
