'use strict';

/**
 * Производственный календарь РФ: рабочие дни 5/2 с учётом праздников и переносов.
 * Для лет без явной таблицы применяется правило статьи 112 ТК РФ:
 * праздник, выпавший на выходной, переносится на следующий рабочий день.
 */
const ProductionCalendar = (() => {
  /** Нерабочие праздничные дни (месяц-день). */
  const FIXED_HOLIDAYS = [
    '01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08',
    '02-23', '03-08', '05-01', '05-09', '06-12', '11-04',
  ];

  /**
   * Официально утверждённые календари.
   * `nonWorking` — дополнительные нерабочие дни (кроме суббот и воскресений),
   * `working` — рабочие субботы и воскресенья.
   */
  const OFFICIAL = {
    2025: {
      nonWorking: [
        '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07', '2025-01-08',
        '2025-03-10', '2025-05-01', '2025-05-02', '2025-05-08', '2025-05-09',
        '2025-06-12', '2025-06-13', '2025-11-03', '2025-11-04', '2025-12-31',
      ],
      working: ['2025-11-01'],
    },
    2026: {
      nonWorking: [
        '2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08',
        '2026-01-09', '2026-02-23', '2026-03-09', '2026-05-01', '2026-05-11',
        '2026-06-12', '2026-11-04', '2026-12-31',
      ],
      working: [],
    },
  };

  const cache = new Map();

  function isoOf(date) {
    return date.toISOString().slice(0, 10);
  }

  function isWeekend(date) {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
  }

  /** Расчёт по общему правилу ТК РФ, если официальная таблица неизвестна. */
  function generateYear(year) {
    const nonWorking = new Set(FIXED_HOLIDAYS.map((md) => `${year}-${md}`));
    for (const md of FIXED_HOLIDAYS) {
      const holiday = new Date(`${year}-${md}T00:00:00Z`);
      if (!isWeekend(holiday)) continue;
      const moved = new Date(holiday);
      do {
        moved.setUTCDate(moved.getUTCDate() + 1);
      } while (isWeekend(moved) || nonWorking.has(isoOf(moved)));
      nonWorking.add(isoOf(moved));
    }
    return { nonWorking, working: new Set() };
  }

  function yearData(year) {
    if (cache.has(year)) return cache.get(year);
    const official = OFFICIAL[year];
    const data = official
      ? { nonWorking: new Set(official.nonWorking), working: new Set(official.working) }
      : generateYear(year);
    cache.set(year, data);
    return data;
  }

  /** Учтён ли год официальной таблицей переносов. */
  function isOfficialYear(year) {
    return Object.prototype.hasOwnProperty.call(OFFICIAL, year);
  }

  function isWorkingDay(date) {
    const iso = isoOf(date);
    const data = yearData(date.getUTCFullYear());
    if (data.working.has(iso)) return true;
    if (data.nonWorking.has(iso)) return false;
    return !isWeekend(date);
  }

  function isHoliday(date) {
    const data = yearData(date.getUTCFullYear());
    return data.nonWorking.has(isoOf(date));
  }

  function workdaysBetween(from, to) {
    let count = 0;
    for (const d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      if (isWorkingDay(d)) count += 1;
    }
    return count;
  }

  return { isWorkingDay, isHoliday, isWeekend, workdaysBetween, isOfficialYear, isoOf };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProductionCalendar;
}
