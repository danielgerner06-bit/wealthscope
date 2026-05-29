// ===========================================================================
// CalcScope — Matrixrechner + AutoCalc
// ===========================================================================

let calcInited = false;
function initCalc() {
  if (calcInited) return;
  calcInited = true;
  setupCalcTabs();
  setupMatrix();
  setupAuto();
}

function setupCalcTabs() {
  document.querySelectorAll('.calc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.calc-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      document.getElementById('panelMatrix').classList.toggle('active', which === 'matrix');
      document.getElementById('panelAuto').classList.toggle('active', which === 'auto');
    });
  });
}

// =========================================================================
// MATRIXRECHNER — löst A · x = b (Gauss mit Teilpivotisierung)
// =========================================================================
function setupMatrix() {
  const sizeSel = document.getElementById('matrixSize');
  document.getElementById('matrixSolve').addEventListener('click', solveMatrixUI);
  document.getElementById('matrixClear').addEventListener('click', () => renderMatrixInputs(+sizeSel.value));
  sizeSel.addEventListener('change', () => renderMatrixInputs(+sizeSel.value));
  renderMatrixInputs(+sizeSel.value);
}

function renderMatrixInputs(n) {
  const A = document.getElementById('matrixA');
  const B = document.getElementById('matrixB');
  A.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  A.innerHTML = '';
  B.innerHTML = '';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const inp = document.createElement('input');
      inp.className = 'matrix-cell';
      inp.dataset.r = i; inp.dataset.c = j;
      inp.placeholder = '0';
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') solveMatrixUI(); });
      A.appendChild(inp);
    }
    const bInp = document.createElement('input');
    bInp.className = 'matrix-cell';
    bInp.dataset.r = i;
    bInp.placeholder = '0';
    bInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') solveMatrixUI(); });
    B.appendChild(bInp);
  }
  document.getElementById('matrixResult').innerHTML = '';
}

// Sicheres Parsen einfacher Ausdrücke: 1/3, 2*4, -5.5, (1+2)/3
function parseNum(str) {
  str = (str || '').trim();
  if (str === '') return 0;
  if (!/^[-+*/().\d\s]+$/.test(str)) return NaN;
  try {
    const v = Function('"use strict";return(' + str + ')')();
    return (typeof v === 'number' && isFinite(v)) ? v : NaN;
  } catch (e) { return NaN; }
}

function solveMatrixUI() {
  const n = +document.getElementById('matrixSize').value;
  const A = [], b = [];
  let bad = false;
  for (let i = 0; i < n; i++) {
    A[i] = [];
    for (let j = 0; j < n; j++) {
      const cell = document.querySelector(`#matrixA .matrix-cell[data-r="${i}"][data-c="${j}"]`);
      const v = parseNum(cell.value);
      if (isNaN(v)) { cell.classList.add('err'); bad = true; } else cell.classList.remove('err');
      A[i][j] = v;
    }
    const bCell = document.querySelector(`#matrixB .matrix-cell[data-r="${i}"]`);
    const bv = parseNum(bCell.value);
    if (isNaN(bv)) { bCell.classList.add('err'); bad = true; } else bCell.classList.remove('err');
    b[i] = bv;
  }
  const out = document.getElementById('matrixResult');
  if (bad) { out.innerHTML = '<div class="matrix-err">Ungültige Eingabe — bitte die rot markierten Felder prüfen.</div>'; return; }
  const x = solveLinear(A, b);
  if (!x) { out.innerHTML = '<div class="matrix-err">Keine eindeutige Lösung — die Matrix ist singulär.</div>'; return; }
  out.innerHTML = '<div class="matrix-sol-title">Lösung</div>' +
    '<div class="matrix-sol">' +
    x.map((v, i) => `<div class="matrix-sol-row"><span>x<sub>${i + 1}</sub></span><b>${fmtNum(v)}</b></div>`).join('') +
    '</div>';
}

function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function fmtNum(v) {
  if (Math.abs(v) < 1e-10) v = 0;
  const r = Math.round(v * 1e6) / 1e6;
  if (Number.isInteger(r)) return String(r);
  return parseFloat(r.toFixed(4)).toString();
}

// =========================================================================
// AUTOCALC — Autos vergleichen (Kosten, Wertverlust, Autowechsel)
// =========================================================================
let autoCars = [];
let autoSeq = 0;
let autoPrevFactor = 1;

// recurring = folgt dem Zeitraum-Umschalter (Monat/Jahr)
const AUTO_FIELDS = [
  { key: 'kaufpreis',     label: 'Kaufpreis',            unit: '€',       recurring: false, group: 'Anschaffung' },
  { key: 'ueberfuehrung', label: 'Überführung',          unit: '€',       recurring: false, group: 'Anschaffung' },
  { key: 'anzahlung',     label: 'Anzahlung',            unit: '€',       recurring: false, group: 'Anschaffung' },
  { key: 'rate',          label: 'Rate / Fixkosten',     unit: '€',       recurring: true,  group: 'Laufend' },
  { key: 'versicherung',  label: 'Versicherung',         unit: '€',       recurring: true,  group: 'Laufend' },
  { key: 'steuer',        label: 'Steuer',               unit: '€',       recurring: true,  group: 'Laufend' },
  { key: 'wartung',       label: 'Wartung',              unit: '€',       recurring: true,  group: 'Laufend', suggest: 'wartung' },
  { key: 'sonstiges',     label: 'Sonstiges',            unit: '€',       recurring: true,  group: 'Laufend' },
  { key: 'verbrauch',     label: 'Verbrauch',            unit: 'l/100km', recurring: false, group: 'Sprit' },
  { key: 'spritpreis',    label: 'Spritpreis',           unit: '€/l',     recurring: false, group: 'Sprit' },
  { key: 'fahrstrecke',   label: 'Fahrstrecke',          unit: 'km',      recurring: true,  group: 'Sprit' },
  { key: 'wertverlust',   label: 'Wertverlust',          unit: '€',       recurring: true,  group: 'Wert', suggest: 'wertverlust' },
  { key: 'erloes',        label: 'Erlös (Verkauf)',      unit: '€',       recurring: false, group: 'Wert' },
];
const RECURRING_KEYS = AUTO_FIELDS.filter(f => f.recurring).map(f => f.key);

function setupAuto() {
  document.getElementById('autoAdd').addEventListener('click', () => addCar());
  document.getElementById('autoPeriod').addEventListener('change', onPeriodChange);
  if (autoCars.length === 0) addCar();
}

function periodFactor() {
  return document.getElementById('autoPeriod').value === 'year' ? 12 : 1;
}
function periodWord() {
  return document.getElementById('autoPeriod').value === 'year' ? 'Jahr' : 'Monat';
}

function addCar() {
  autoSeq++;
  const car = { id: autoSeq, name: 'Auto ' + autoSeq, year: '', mileage: '', haltedauer: 5 };
  AUTO_FIELDS.forEach(f => car[f.key] = '');
  autoCars.push(car);
  renderAuto();
}

function removeCar(id) {
  autoCars = autoCars.filter(c => c.id !== id);
  renderAuto();
}

// Beim Umschalten Monat <-> Jahr die recurring-Werte umrechnen
function onPeriodChange() {
  const f = periodFactor();
  const ratio = f / autoPrevFactor;
  autoCars.forEach(car => {
    RECURRING_KEYS.forEach(k => {
      if (car[k] !== '' && !isNaN(+car[k])) car[k] = round2(+car[k] * ratio);
    });
  });
  autoPrevFactor = f;
  renderAuto();
}

function round2(v) { return Math.round(v * 100) / 100; }
function eur(v) { return (Math.round(v * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €'; }
function eur2(v) { return (Math.round(v * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }

function num(car, key) {
  const v = car[key];
  return (v === '' || v === null || isNaN(+v)) ? 0 : +v;
}

// Rechnet alle Kennzahlen eines Autos (intern in Monatswerten)
function computeCar(car) {
  const f = periodFactor();
  // recurring sind in der aktuellen Periode gespeichert -> /f = monatlich
  const rateM        = num(car, 'rate') / f;
  const versM        = num(car, 'versicherung') / f;
  const steuerM      = num(car, 'steuer') / f;
  const wartungM     = num(car, 'wartung') / f;
  const sonstM       = num(car, 'sonstiges') / f;
  const wertM        = num(car, 'wertverlust') / f;
  const fahrM        = num(car, 'fahrstrecke') / f; // km/Monat
  const verbrauch    = num(car, 'verbrauch');       // l/100km
  const spritpreis   = num(car, 'spritpreis');      // €/l
  const fuelM        = (verbrauch / 100) * fahrM * spritpreis;

  const runningM = rateM + versM + steuerM + wartungM + sonstM + wertM + fuelM;
  const oneTime  = num(car, 'ueberfuehrung') + num(car, 'anzahlung');
  const erloes   = num(car, 'erloes');
  const halt     = Math.max(0, num(car, 'haltedauer')); // Jahre
  const total    = oneTime + runningM * 12 * halt - erloes;

  return { runningM, fuelM, oneTime, erloes, halt, total };
}

// ---- Wertverlust-Modell ----
// Wert nach t Jahren: Jahr 1 -25 %, danach -13 %/Jahr
function carValueAt(price, t) {
  if (price <= 0) return 0;
  if (t <= 0) return price;
  return price * 0.75 * Math.pow(0.87, t - 1);
}
function carAge(car) {
  const y = parseInt(car.year, 10);
  if (!y || y < 1950) return null;
  return Math.max(0, new Date().getFullYear() - y);
}

// ---- Vorschläge ----
function suggestWertverlust(car) {
  // Wertverlust im kommenden Jahr, in aktueller Periode
  const price = num(car, 'kaufpreis');
  if (price <= 0) return null;
  const age = carAge(car) ?? 0;
  const dropYear = Math.max(0, carValueAt(price, age) - carValueAt(price, age + 1));
  return round2(dropYear / 12 * periodFactor());
}
function suggestWartung(car) {
  // km-basiert, steigt mit Alter; Default 1250 km/Monat falls leer
  const f = periodFactor();
  let fahrM = num(car, 'fahrstrecke') / f;
  if (fahrM <= 0) fahrM = 1250;
  const age = carAge(car) ?? 5;
  const perKm = 0.04 + 0.006 * age; // €/km, älter = teurer
  return round2(fahrM * perKm * f);
}

function renderAuto() {
  const list = document.getElementById('autoList');
  list.innerHTML = '';
  autoCars.forEach(car => list.appendChild(buildCarCard(car)));
  renderCompare();
}

function buildCarCard(car) {
  const card = document.createElement('div');
  card.className = 'auto-card';
  card.dataset.id = car.id;

  const groups = ['Anschaffung', 'Laufend', 'Sprit', 'Wert'];
  const pw = periodWord();

  let fieldsHtml = '';
  groups.forEach(g => {
    fieldsHtml += `<div class="auto-group"><div class="auto-group-title">${g}</div><div class="auto-group-fields">`;
    AUTO_FIELDS.filter(f => f.group === g).forEach(f => {
      const unitLabel = f.recurring ? `${f.unit} / ${pw}` : f.unit;
      const sug = f.suggest ? `<button class="auto-suggest" data-sug="${f.suggest}" data-id="${car.id}" type="button" title="Vorschlag übernehmen">Vorschlag</button>` : '';
      fieldsHtml += `
        <label class="auto-field">
          <span class="auto-field-label">${f.label} <em>${unitLabel}</em></span>
          <span class="auto-field-input">
            <input type="text" inputmode="decimal" data-key="${f.key}" data-id="${car.id}" value="${car[f.key]}" placeholder="0">
            ${sug}
          </span>
        </label>`;
    });
    fieldsHtml += `</div></div>`;
  });

  card.innerHTML = `
    <div class="auto-card-head">
      <input class="auto-name" data-id="${car.id}" value="${escapeAttr(car.name)}" placeholder="Modell / Name">
      <button class="auto-remove" data-id="${car.id}" type="button" aria-label="Entfernen">×</button>
    </div>
    <div class="auto-id-row">
      <label class="auto-field auto-field-sm">
        <span class="auto-field-label">Baujahr</span>
        <input type="text" inputmode="numeric" data-key="year" data-id="${car.id}" value="${car.year}" placeholder="2018">
      </label>
      <label class="auto-field auto-field-sm">
        <span class="auto-field-label">Laufleistung <em>km</em></span>
        <input type="text" inputmode="numeric" data-key="mileage" data-id="${car.id}" value="${car.mileage}" placeholder="60000">
      </label>
      <label class="auto-field auto-field-sm">
        <span class="auto-field-label">Haltedauer <em>Jahre</em></span>
        <input type="text" inputmode="numeric" data-key="haltedauer" data-id="${car.id}" value="${car.haltedauer}" placeholder="5">
      </label>
    </div>
    <div class="auto-fields">${fieldsHtml}</div>
    <div class="auto-card-result" id="autoResult-${car.id}"></div>
    <div class="auto-card-chart" id="autoChart-${car.id}"></div>
  `;

  // Eingaben verkabeln
  card.querySelectorAll('input[data-key]').forEach(inp => {
    inp.addEventListener('input', () => {
      const c = autoCars.find(x => x.id === +inp.dataset.id);
      if (!c) return;
      c[inp.dataset.key] = inp.value.replace(',', '.');
      updateCarComputed(c);
      renderCompare();
    });
  });
  card.querySelector('.auto-name').addEventListener('input', (e) => {
    const c = autoCars.find(x => x.id === +e.target.dataset.id);
    if (c) { c.name = e.target.value; renderCompare(); }
  });
  card.querySelector('.auto-remove').addEventListener('click', () => removeCar(car.id));
  card.querySelectorAll('.auto-suggest').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = autoCars.find(x => x.id === +btn.dataset.id);
      if (!c) return;
      const which = btn.dataset.sug;
      const val = which === 'wartung' ? suggestWartung(c) : suggestWertverlust(c);
      if (val === null) return;
      c[which] = val;
      const field = card.querySelector(`input[data-key="${which}"]`);
      if (field) field.value = val;
      updateCarComputed(c);
      renderCompare();
    });
  });

  // initial berechnen (nach dem das Element im DOM ist)
  setTimeout(() => updateCarComputed(car), 0);
  return card;
}

function updateCarComputed(car) {
  const r = computeCar(car);
  const pw = periodWord();
  const f = periodFactor();
  const resEl = document.getElementById('autoResult-' + car.id);
  if (resEl) {
    resEl.innerHTML = `
      <div class="auto-stat"><span>Laufende Kosten</span><b>${eur2(r.runningM * f)} / ${pw}</b></div>
      <div class="auto-stat"><span>davon Sprit</span><b>${eur2(r.fuelM * f)} / ${pw}</b></div>
      <div class="auto-stat"><span>Einmalig (netto)</span><b>${eur(r.oneTime - r.erloes)}</b></div>
      <div class="auto-stat auto-stat-total"><span>Gesamt über ${fmtNum(r.halt)} J.</span><b>${eur(r.total)}</b></div>
    `;
  }
  const chartEl = document.getElementById('autoChart-' + car.id);
  if (chartEl) chartEl.innerHTML = buildDepreciationChart(car);
}

function buildDepreciationChart(car) {
  const price = num(car, 'kaufpreis');
  if (price <= 0) {
    return '<div class="auto-chart-empty">Kaufpreis eingeben, um den Wertverlust zu sehen.</div>';
  }
  const years = 12;
  const W = 320, H = 150, padL = 8, padR = 8, padT = 14, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const pts = [];
  for (let t = 0; t <= years; t++) pts.push({ t, v: carValueAt(price, t) });
  const maxV = price;
  const xOf = (t) => padL + (t / years) * innerW;
  const yOf = (v) => padT + (1 - v / maxV) * innerH;

  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + xOf(p.t).toFixed(1) + ' ' + yOf(p.v).toFixed(1)).join(' ');
  const area = path + ` L${xOf(years).toFixed(1)} ${padT + innerH} L${padL} ${padT + innerH} Z`;

  const age = carAge(car);
  let marker = '';
  if (age !== null && age <= years) {
    const vx = xOf(age), vy = yOf(carValueAt(price, age));
    marker = `
      <line x1="${vx.toFixed(1)}" y1="${padT}" x2="${vx.toFixed(1)}" y2="${(padT + innerH).toFixed(1)}" class="dep-marker-line"/>
      <circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="5" class="dep-marker-dot"/>
      <text x="${vx.toFixed(1)}" y="${(vy - 9).toFixed(1)}" class="dep-marker-label" text-anchor="middle">${eur(carValueAt(price, age))}</text>`;
  }

  // X-Achsenbeschriftung (0, mitte, ende)
  const labels = [0, Math.round(years / 2), years].map(t =>
    `<text x="${xOf(t).toFixed(1)}" y="${H - 6}" class="dep-axis" text-anchor="middle">${age !== null ? (new Date().getFullYear() - age + t) : t + ' J.'}</text>`
  ).join('');

  return `
    <div class="auto-chart-title">Wertverlust</div>
    <svg viewBox="0 0 ${W} ${H}" class="dep-chart" preserveAspectRatio="none">
      <defs>
        <linearGradient id="depGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(99,102,241,0.35)"/>
          <stop offset="100%" stop-color="rgba(99,102,241,0)"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#depGrad)"/>
      <path d="${path}" class="dep-line" fill="none"/>
      ${marker}
      ${labels}
    </svg>`;
}

function renderCompare() {
  const el = document.getElementById('autoCompare');
  if (autoCars.length < 1) { el.innerHTML = ''; return; }
  const rows = autoCars.map(c => ({ car: c, r: computeCar(c) }));
  const valid = rows.filter(x => x.r.total !== 0 || x.r.runningM !== 0);
  const pw = periodWord();
  const f = periodFactor();

  let best = null;
  valid.forEach(x => { if (best === null || x.r.total < best.r.total) best = x; });

  let html = `<h2>Vergleich</h2>`;
  if (autoCars.length < 2) {
    html += `<p class="auto-compare-hint">Füge ein zweites Auto hinzu, um Kosten und Autowechsel zu vergleichen.</p>`;
  }
  html += `<div class="auto-table">
    <div class="auto-table-head">
      <span>Auto</span><span>Laufend / ${pw}</span><span>Gesamt</span>
    </div>`;
  rows.forEach(x => {
    const isBest = best && x.car.id === best.car.id && autoCars.length >= 2;
    html += `<div class="auto-table-row${isBest ? ' best' : ''}">
      <span>${escapeHtml(x.car.name || 'Auto')}${isBest ? ' <em>günstigster</em>' : ''}</span>
      <span>${eur2(x.r.runningM * f)}</span>
      <span>${eur(x.r.total)}</span>
    </div>`;
  });
  html += `</div>`;

  // Autowechsel-Hinweis
  if (best && autoCars.length >= 2) {
    const sorted = [...rows].sort((a, b) => a.r.total - b.r.total);
    const diff = sorted[1].r.total - sorted[0].r.total;
    if (diff > 0) {
      html += `<p class="auto-compare-note"><b>${escapeHtml(sorted[0].car.name || 'Auto 1')}</b> ist über die Haltedauer rund <b>${eur(diff)}</b> günstiger als <b>${escapeHtml(sorted[1].car.name || 'Auto 2')}</b>.</p>`;
    }
  }
  el.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
