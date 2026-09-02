---
name: testing-salary-calculator
description: How to run and UI-test the static "Зарплатный калькулятор" app locally (server, localStorage reset, Cyrillic input, mobile-width screenshots, expected payroll formulas).
---

# Testing the salary calculator (static app)

## Run it
The app is plain `index.html` + `styles.css` + `app.js`, no build step.

```bash
cd <repo> && python3 -m http.server 8123
# open http://localhost:8123/index.html in Chrome
```
Prefer `http://` over `file://` — downloads and `localStorage` behave more like production.
Headless calculation checks: `node tests/check.js`.

## State
All data lives in `localStorage` under key `salary-calculator-v1`.
To start from a clean slate, clear site data for `localhost:8123` (DevTools → Application → Clear storage)
or delete that key. Data is stored **per month**: switching the month input resets
оклад / план / норма for that employee, so they must be re-entered for each month you test.

## Typing Cyrillic text
`computer.type` may drop or mangle Cyrillic characters. Use xdotool instead:

```bash
DISPLAY=:0 xdotool type --delay 40 'Алексей Ч.'
```
(`xclip` is typically NOT installed, so clipboard paste is not a reliable fallback.)
Always re-read the field afterwards — partial input like `Менджер` instead of `Менеджер` is common.

## The month input
`<input type="month">` is easy to corrupt (e.g. typing produces `82026-08`).
Click the month segment first, type the month, then the year; verify the value in the DOM
before relying on any calculation.

## Mobile / responsive view
Breakpoint is `@media (max-width: 900px)`: the desktop `.table-wrap` is hidden and `.mobile-list`
cards appear, each with a «Подробнее» / «Свернуть» toggle.
For a *clean* mobile screenshot without the DevTools panel eating half the frame, resize the real
Chrome window instead of using device emulation:

```bash
DISPLAY=:0 wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz
DISPLAY=:0 wmctrl -r :ACTIVE: -e 0,20,10,470,745
DISPLAY=:0 wmctrl -r :ACTIVE: -b add,maximized_vert   # gives a tall, narrow window
```
Restore with `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`.

## Downloads
«Экспорт CSV» → `~/Downloads/zarplata-<YYYY-MM>.csv` (semicolon-separated, UTF-8 BOM, comma decimals).
«Резервная копия» → `~/Downloads/zarplata-backup-<YYYY-MM>.json`.
«Импорт копии» opens a native file picker; in the GTK dialog you can double-click the file in the
list. Import shows a `confirm()` then an `alert()` — both must be dismissed.
Verify file contents from the shell (`cat ~/Downloads/...`) rather than in the browser.

## Calculation formulas (to predict expected values)
```
KPI          = план − оклад
worked       = норма − пропущенные рабочие дни (график 5/2, пн–пт)
зарплата за работу = план × worked / норма
отпускные    = оклад / 29.3 × календарных дней отпуска В ЭТОМ МЕСЯЦЕ
итого        = зарплата за работу + отпускные + больничные + корректировка
прибыль      = оборот выход − оборот вход
```
An absence spanning two months is split by month: only the calendar days falling inside the
selected month count toward that month's отпускные.

## Known gotcha (fixed, may regress)
`.modal { display: grid }` overrides the UA `[hidden] { display: none }` rule, which makes the
absence modal a permanently visible full-screen overlay that blocks every click on the page.
The guard is `.modal[hidden] { display: none; }` in `styles.css`. If the page loads with a grey
overlay and nothing is clickable, check that this rule still exists.

## Devin Secrets Needed
none
