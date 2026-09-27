'use strict';

// ---------- Storage ----------
// Amounts are stored as integer cents to avoid floating point drift.
// Dates are stored as local "YYYY-MM-DD" strings.

const STORAGE_KEY = 'budgetkeeper.v1';
const CURRENCY = 'USD';

// Budgets are kept per week so changing the budget never rewrites history:
//   budgetHistory: [{ from: "YYYY-MM-DD", cents }] — the default budget, effective from a week onward
//   weekBudgets:   { "YYYY-MM-DD": cents }         — one-off overrides for a single week
const defaultState = () => ({
  settings: { weekStartDay: 0, budgetHistory: [], weekBudgets: {} },
  expenses: [],
});

function normalizeState(data) {
  const s = data.settings || {};
  const settings = {
    weekStartDay: Number.isInteger(s.weekStartDay) ? s.weekStartDay : 0,
    budgetHistory: Array.isArray(s.budgetHistory) ? s.budgetHistory : [],
    weekBudgets: s.weekBudgets && typeof s.weekBudgets === 'object' ? s.weekBudgets : {},
  };
  // Migrate from the original single-budget format.
  if (!settings.budgetHistory.length && s.weeklyBudgetCents > 0) {
    settings.budgetHistory.push({ from: '1970-01-01', cents: s.weeklyBudgetCents });
  }
  settings.budgetHistory.sort((a, b) => a.from.localeCompare(b.from));
  return { settings, expenses: Array.isArray(data.expenses) ? data.expenses : [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : defaultState();
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

// ---------- Date helpers ----------

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function weekStartFor(date, startDay) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() - startDay + 7) % 7;
  return addDays(d, -diff);
}

const today = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

// ---------- Budget lookup ----------

function weekOverride(start) {
  // Overrides are matched by any date inside the week, so they survive a change of start day.
  const s = toISODate(start);
  const e = toISODate(addDays(start, 7));
  const key = Object.keys(state.settings.weekBudgets).find((k) => k >= s && k < e);
  return key ? { key, cents: state.settings.weekBudgets[key] } : null;
}

function defaultBudgetForWeek(start) {
  const history = state.settings.budgetHistory;
  if (!history.length) return 0;
  const s = toISODate(start);
  let match = history[0]; // weeks before the first budget was set use the earliest one
  for (const h of history) if (h.from <= s) match = h;
  return match.cents;
}

function budgetForWeek(start) {
  const o = weekOverride(start);
  return o ? o.cents : defaultBudgetForWeek(start);
}

function hasAnyBudget() {
  return state.settings.budgetHistory.length > 0 || Object.keys(state.settings.weekBudgets).length > 0;
}

// ---------- Formatting ----------

const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY });
const fmtMoney = (cents) => money.format(cents / 100);
const fmtShort = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function parseAmountToCents(text) {
  const cleaned = String(text).replace(/[^0-9.]/g, '');
  if (!cleaned || (cleaned.match(/\./g) || []).length > 1) return NaN;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

const centsToInput = (cents) => (cents / 100).toFixed(2);

// ---------- View state ----------

let viewWeekStart = weekStartFor(today(), state.settings.weekStartDay);

// ---------- DOM ----------

const $ = (id) => document.getElementById(id);

const els = {
  weekRange: $('weekRange'),
  weekHint: $('weekHint'),
  prevWeek: $('prevWeek'),
  nextWeek: $('nextWeek'),
  weekLabel: $('weekLabel'),
  needle: $('needle'),
  zones: $('gaugeZones'),
  ticks: $('gaugeTicks'),
  remainingAmount: $('remainingAmount'),
  remainingLabel: $('remainingLabel'),
  spentAmount: $('spentAmount'),
  budgetAmount: $('budgetAmount'),
  budgetLabel: $('budgetLabel'),
  budgetStat: $('budgetStat'),

  weekBudgetSheet: $('weekBudgetSheet'),
  weekBudgetForm: $('weekBudgetForm'),
  weekBudgetRange: $('weekBudgetRange'),
  weekBudgetInput: $('weekBudgetInput'),
  weekBudgetError: $('weekBudgetError'),
  weekBudgetReset: $('weekBudgetReset'),
  usedPct: $('usedPct'),
  list: $('expenseList'),
  empty: $('emptyState'),
  addBtn: $('addBtn'),
  settingsBtn: $('settingsBtn'),

  expenseSheet: $('expenseSheet'),
  expenseForm: $('expenseForm'),
  expenseSheetTitle: $('expenseSheetTitle'),
  categoryInput: $('categoryInput'),
  suggestions: $('suggestions'),
  amountInput: $('amountInput'),
  dateInput: $('dateInput'),
  notesInput: $('notesInput'),
  formError: $('formError'),
  deleteBtn: $('deleteBtn'),

  settingsSheet: $('settingsSheet'),
  settingsForm: $('settingsForm'),
  budgetInput: $('budgetInput'),
  weekStartInput: $('weekStartInput'),
  settingsError: $('settingsError'),
  exportBtn: $('exportBtn'),
  importBtn: $('importBtn'),
  importFile: $('importFile'),
};

// ---------- Gauge ----------
// Semicircle centered at (150,150), radius 120. Angle 180° = E (left), 0° = F (right).
// The needle shows fuel left: a full budget points at F and drains toward E as you spend.

const CX = 150, CY = 150, R = 118;
const SVG_NS = 'http://www.w3.org/2000/svg';

function polar(angleDeg, r) {
  const a = (angleDeg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function arcPath(fromDeg, toDeg, r) {
  const [x1, y1] = polar(fromDeg, r);
  const [x2, y2] = polar(toDeg, r);
  const large = Math.abs(fromDeg - toDeg) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

function buildGauge() {
  const zones = [
    { from: 180, to: 153, color: 'var(--bad)' },   // 0–15% left
    { from: 153, to: 117, color: 'var(--warn)' },  // 15–35% left
    { from: 117, to: 0, color: 'var(--good)' },    // 35–100% left
  ];
  const track = document.createElementNS(SVG_NS, 'path');
  track.setAttribute('d', arcPath(180, 0, R));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--gauge-track)');
  track.setAttribute('stroke-width', '22');
  els.zones.appendChild(track);
  for (const z of zones) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', arcPath(z.from, z.to, R));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', z.color);
    p.setAttribute('stroke-width', '14');
    els.zones.appendChild(p);
  }
  for (let i = 0; i <= 8; i++) {
    const angle = 180 - i * 22.5;
    const major = i % 2 === 0;
    const [x1, y1] = polar(angle, R - 14);
    const [x2, y2] = polar(angle, R - (major ? 30 : 23));
    const t = document.createElementNS(SVG_NS, 'line');
    t.setAttribute('x1', x1); t.setAttribute('y1', y1);
    t.setAttribute('x2', x2); t.setAttribute('y2', y2);
    t.setAttribute('class', 'gauge-tick');
    t.setAttribute('stroke-width', major ? 3.5 : 2);
    els.ticks.appendChild(t);
  }
}

function setNeedle(fractionLeft) {
  // Let the needle dip slightly past E when over budget.
  const clamped = Math.max(-0.04, Math.min(1, fractionLeft));
  const angle = 180 - clamped * 180;
  // Needle is drawn pointing at 0° (F); SVG rotation is clockwise, so negate.
  els.needle.style.transform = `rotate(${-angle}deg)`;
}

// ---------- Rendering ----------

function expensesInWeek(start) {
  const s = toISODate(start);
  const e = toISODate(addDays(start, 7));
  return state.expenses
    .filter((x) => x.date >= s && x.date < e)
    .sort((a, b) => (b.date.localeCompare(a.date)) || (b.createdAt - a.createdAt));
}

function render() {
  const start = viewWeekStart;
  const end = addDays(start, 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  const yearSuffix = end.getFullYear() !== today().getFullYear() || !sameYear ? `, ${end.getFullYear()}` : '';
  els.weekRange.textContent = `${fmtShort.format(start)} – ${fmtShort.format(end)}${yearSuffix}`;

  const currentStart = weekStartFor(today(), state.settings.weekStartDay);
  const weeksAway = Math.round((start - currentStart) / (7 * 864e5));
  els.weekHint.textContent =
    weeksAway === 0 ? 'This week'
    : weeksAway === -1 ? 'Last week · tap for this week'
    : weeksAway === 1 ? 'Next week · tap for this week'
    : `${Math.abs(weeksAway)} weeks ${weeksAway < 0 ? 'ago' : 'ahead'} · tap for this week`;

  const items = expensesInWeek(start);
  const spent = items.reduce((sum, x) => sum + x.amountCents, 0);
  const budget = budgetForWeek(start);
  const left = budget - spent;

  els.spentAmount.textContent = fmtMoney(spent);
  els.budgetAmount.textContent = budget > 0 ? fmtMoney(budget) : '—';
  els.budgetLabel.textContent = weekOverride(start) ? 'Budget ✱' : 'Budget';
  els.usedPct.textContent = budget > 0 ? `${Math.round((spent / budget) * 100)}%` : '—';

  if (budget <= 0) {
    els.remainingAmount.textContent = fmtMoney(spent);
    els.remainingAmount.classList.remove('over');
    els.remainingLabel.textContent = 'spent · set a weekly budget in ⚙︎ Settings';
    setNeedle(spent > 0 ? 0 : 1);
  } else if (left >= 0) {
    els.remainingAmount.textContent = fmtMoney(left);
    els.remainingAmount.classList.remove('over');
    els.remainingLabel.textContent = 'left this week';
    setNeedle(left / budget);
  } else {
    els.remainingAmount.textContent = fmtMoney(-left);
    els.remainingAmount.classList.add('over');
    els.remainingLabel.textContent = 'over budget';
    setNeedle(left / budget);
  }

  els.list.replaceChildren(
    ...items.map((x) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'expense-item';
      btn.type = 'button';
      btn.addEventListener('click', () => openExpenseSheet(x));

      const cat = document.createElement('span');
      cat.className = 'expense-cat';
      cat.textContent = x.category;
      const amt = document.createElement('span');
      amt.className = 'expense-amt';
      amt.textContent = fmtMoney(x.amountCents);
      const meta = document.createElement('span');
      meta.className = 'expense-meta';
      meta.textContent = fmtDay.format(parseISODate(x.date)) + (x.notes ? ` · ${x.notes}` : '');

      btn.append(cat, amt, meta);
      li.append(btn);
      return li;
    })
  );
  els.empty.hidden = items.length > 0;
}

// ---------- Sheets ----------

function openSheet(sheet) {
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheet(sheet) {
  sheet.hidden = true;
  document.body.style.overflow = '';
}

const allSheets = [els.expenseSheet, els.settingsSheet, els.weekBudgetSheet];

for (const sheet of allSheets) {
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('[data-close]')) closeSheet(sheet);
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const sheet of allSheets) if (!sheet.hidden) closeSheet(sheet);
});

// ---------- Add / edit expense ----------

let editingId = null;

function openExpenseSheet(expense = null) {
  editingId = expense ? expense.id : null;
  els.expenseSheetTitle.textContent = expense ? 'Edit Expense' : 'Add Expense';
  els.categoryInput.value = expense ? expense.category : '';
  els.amountInput.value = expense ? centsToInput(expense.amountCents) : '';
  els.dateInput.value = expense ? expense.date : toISODate(today());
  els.notesInput.value = expense ? expense.notes || '' : '';
  els.deleteBtn.hidden = !expense;
  els.formError.hidden = true;
  updateSuggestions();
  openSheet(els.expenseSheet);
  if (!expense) els.categoryInput.focus();
}

function showFormError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

els.expenseForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const category = els.categoryInput.value.trim().replace(/\s+/g, ' ');
  const amountCents = parseAmountToCents(els.amountInput.value);
  const date = els.dateInput.value;
  const notes = els.notesInput.value.trim();

  if (!category) return showFormError(els.formError, 'Please enter a category.');
  if (!Number.isFinite(amountCents) || amountCents <= 0) return showFormError(els.formError, 'Please enter an amount greater than zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showFormError(els.formError, 'Please choose a date.');

  // Reuse the existing spelling/capitalization of a category if it matches.
  const existing = knownCategories().find((c) => c.name.toLowerCase() === category.toLowerCase());
  const finalCategory = existing ? existing.name : category;

  if (editingId) {
    const x = state.expenses.find((x) => x.id === editingId);
    Object.assign(x, { category: finalCategory, amountCents, date, notes });
  } else {
    state.expenses.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      category: finalCategory,
      amountCents,
      date,
      notes,
      createdAt: Date.now(),
    });
  }
  saveState();
  // Show the week the expense landed in.
  viewWeekStart = weekStartFor(parseISODate(date), state.settings.weekStartDay);
  closeSheet(els.expenseSheet);
  render();
});

els.deleteBtn.addEventListener('click', () => {
  if (!editingId) return;
  if (!confirm('Delete this expense?')) return;
  state.expenses = state.expenses.filter((x) => x.id !== editingId);
  saveState();
  closeSheet(els.expenseSheet);
  render();
});

// ---------- Category autocomplete ----------
// Categories are ranked by how often they've been used, with recent use as a tiebreaker.

function knownCategories() {
  const map = new Map();
  for (const x of state.expenses) {
    const key = x.category.toLowerCase();
    const entry = map.get(key) || { name: x.category, count: 0, last: 0 };
    entry.count++;
    if ((x.createdAt || 0) >= entry.last) {
      entry.last = x.createdAt || 0;
      entry.name = x.category;
    }
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}

function updateSuggestions() {
  const q = els.categoryInput.value.trim().toLowerCase();
  let matches = knownCategories();
  if (q) {
    matches = matches
      .filter((c) => c.name.toLowerCase().includes(q) && c.name.toLowerCase() !== q)
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)));
  }
  matches = matches.slice(0, 8);

  els.suggestions.replaceChildren(
    ...matches.map((c) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const i = q ? c.name.toLowerCase().indexOf(q) : -1;
      if (i >= 0) {
        const mark = document.createElement('mark');
        mark.textContent = c.name.slice(i, i + q.length);
        btn.append(c.name.slice(0, i), mark, c.name.slice(i + q.length));
      } else {
        btn.textContent = c.name;
      }
      // pointerdown + preventDefault keeps the keyboard up while choosing.
      btn.addEventListener('pointerdown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        els.categoryInput.value = c.name;
        updateSuggestions();
        els.amountInput.focus();
      });
      li.append(btn);
      return li;
    })
  );
  els.suggestions.hidden = matches.length === 0;
}

els.categoryInput.addEventListener('input', updateSuggestions);
els.categoryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    els.amountInput.focus();
  }
});

// ---------- Settings ----------

function openSettings() {
  const current = defaultBudgetForWeek(weekStartFor(today(), state.settings.weekStartDay));
  els.budgetInput.value = current > 0 ? centsToInput(current) : '';
  els.weekStartInput.value = String(state.settings.weekStartDay);
  els.settingsError.hidden = true;
  openSheet(els.settingsSheet);
}

els.settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const cents = parseAmountToCents(els.budgetInput.value);
  if (!Number.isFinite(cents) || cents <= 0) {
    return showFormError(els.settingsError, 'Please enter a weekly budget greater than zero.');
  }
  const startDay = Number(els.weekStartInput.value);
  // Keep looking at the week that contains the same point in time after changing the start day.
  const anchor = viewWeekStart;
  state.settings.weekStartDay = startDay;

  // A new default budget takes effect from the current week; earlier weeks keep theirs.
  const thisWeek = weekStartFor(today(), startDay);
  if (defaultBudgetForWeek(thisWeek) !== cents) {
    const from = toISODate(thisWeek);
    const history = state.settings.budgetHistory.filter((h) => h.from < from);
    history.push({ from, cents });
    state.settings.budgetHistory = history;
  }
  saveState();
  viewWeekStart = weekStartFor(anchor, startDay);
  closeSheet(els.settingsSheet);
  render();
});

// ---------- This week's budget ----------

function openWeekBudget() {
  const start = viewWeekStart;
  const override = weekOverride(start);
  const fallback = defaultBudgetForWeek(start);
  const current = override ? override.cents : fallback;
  els.weekBudgetRange.textContent = `Budget for ${fmtShort.format(start)} – ${fmtShort.format(addDays(start, 6))}`;
  els.weekBudgetInput.value = current > 0 ? centsToInput(current) : '';
  els.weekBudgetReset.hidden = !override || fallback <= 0;
  els.weekBudgetReset.textContent = `Reset to default (${fmtMoney(fallback)})`;
  els.weekBudgetError.hidden = true;
  openSheet(els.weekBudgetSheet);
}

function clearWeekOverride(start) {
  const o = weekOverride(start);
  if (o) delete state.settings.weekBudgets[o.key];
}

els.weekBudgetForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const cents = parseAmountToCents(els.weekBudgetInput.value);
  if (!Number.isFinite(cents) || cents <= 0) {
    return showFormError(els.weekBudgetError, 'Please enter a budget greater than zero.');
  }
  clearWeekOverride(viewWeekStart);
  // Only store an override when it differs from the default for that week.
  if (cents !== defaultBudgetForWeek(viewWeekStart) || !state.settings.budgetHistory.length) {
    state.settings.weekBudgets[toISODate(viewWeekStart)] = cents;
  }
  saveState();
  closeSheet(els.weekBudgetSheet);
  render();
});

els.weekBudgetReset.addEventListener('click', () => {
  clearWeekOverride(viewWeekStart);
  saveState();
  closeSheet(els.weekBudgetSheet);
  render();
});

els.budgetStat.addEventListener('click', openWeekBudget);

// ---------- Backup ----------

els.exportBtn.addEventListener('click', async () => {
  const json = JSON.stringify(state, null, 2);
  const name = `budget-keeper-backup-${toISODate(today())}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Budget Keeper backup' });
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

els.importBtn.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files[0];
  els.importFile.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.expenses) || !data.settings) throw new Error('bad format');
    const valid = data.expenses.every(
      (x) => x && typeof x.category === 'string' && Number.isInteger(x.amountCents) && /^\d{4}-\d{2}-\d{2}$/.test(x.date)
    );
    if (!valid) throw new Error('bad expenses');
    if (!confirm(`Replace all current data with this backup (${data.expenses.length} expenses)?`)) return;
    state = normalizeState(data);
    saveState();
    viewWeekStart = weekStartFor(today(), state.settings.weekStartDay);
    closeSheet(els.settingsSheet);
    render();
  } catch {
    showFormError(els.settingsError, "That file isn't a valid Budget Keeper backup.");
  }
});

// ---------- Navigation ----------

els.prevWeek.addEventListener('click', () => {
  viewWeekStart = addDays(viewWeekStart, -7);
  render();
});
els.nextWeek.addEventListener('click', () => {
  viewWeekStart = addDays(viewWeekStart, 7);
  render();
});
els.weekLabel.addEventListener('click', () => {
  viewWeekStart = weekStartFor(today(), state.settings.weekStartDay);
  render();
});

// Horizontal swipe on the main area also changes weeks.
(() => {
  let x0 = null, y0 = null;
  const main = document.querySelector('main');
  main.addEventListener('touchstart', (e) => {
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      viewWeekStart = addDays(viewWeekStart, dx < 0 ? 7 : -7);
      render();
    }
  }, { passive: true });
})();

els.addBtn.addEventListener('click', () => openExpenseSheet());
els.settingsBtn.addEventListener('click', openSettings);

// When the app is reopened on a new day, make sure "today" is current.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render();
});

// ---------- Boot ----------

buildGauge();
render();

// First run: prompt for a budget.
if (!hasAnyBudget() && state.expenses.length === 0) {
  openSettings();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
