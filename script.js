// ===========================================================================
// WealthScope — Quiz Engine
// ===========================================================================

// ---- STATE ----
let map = null;
let geoCountriesData = null;
let activeLayers = [];
let countryFeatures = [];
let cityMarkers = [];
let waterMarkers = [];
let landmarkMarkers = [];

let pendingLaenderMode = null;
let hoverLatLng = null;
let wheelLock = false;

const quizState = {
  type: null,
  questions: [],
  idx: 0,
  correctCount: 0,
  wrongCount: 0,
  active: false,
  current: null,
  modeFilter: null,
  modeBounds: null,
  showGuessed: true,
  answeredCorrectly: new Set(),
  answeredWrongly: new Set(),
};

// ---- CONFIG ----
const QUIZ_CONFIG = {
  laender: { title: "Länderquiz", description: "Klicke das gefragte Land.", promptLabel: "Klicke das Land:" },
  flaggen: { title: "Flaggenquiz", description: "Klicke das Land zur angezeigten Flagge.", promptLabel: "Klicke das Land:" },
  staedte: { title: "Städtequiz", description: "Klicke die gefragte Stadt auf der Karte.", promptLabel: "Klicke die Stadt:" },
  wasser:  { title: "Wasserquiz", description: "Klicke das gefragte Gewässer.", promptLabel: "Klicke das Gewässer:" },
  sehenswuerdigkeiten: { title: "Sehenswürdigkeiten", description: "Klicke die gefragte Sehenswürdigkeit auf der Karte.", promptLabel: "Klicke:" },
};

// ---- LÄNDER-MODI ----
const LAENDER_MODES = {
  world_easy:    { label: 'Welt — 100 größte',     filter: (p, iso2) => TOP_100_AREA.has((iso2 || '').toUpperCase()),    bounds: WORLD_BOUNDS },
  world_medium:  { label: 'Welt — 196 anerkannte', filter: (p, iso2) => RECOGNIZED_196.has((iso2 || '').toUpperCase()),  bounds: WORLD_BOUNDS },
  world_hard:    { label: 'Welt — Alle Länder',    filter: (p) => isCountryType(p.TYPE),                                  bounds: WORLD_BOUNDS },
  world_expert:  { label: 'Welt — Alle 258',       filter: () => true,                                                    bounds: WORLD_BOUNDS },
};
['Europe','Asia','Africa','North America','South America','Oceania'].forEach(cont => {
  const k = cont.toLowerCase().replace(' ', '');
  LAENDER_MODES[`${k}_c`] = {
    label: `${CONTINENT_DE[cont]} — Länder`,
    filter: (p) => p.CONTINENT === cont && isCountryType(p.TYPE),
    bounds: CONTINENT_BOUNDS[cont],
  };
  LAENDER_MODES[`${k}_t`] = {
    label: `${CONTINENT_DE[cont]} — alle`,
    filter: (p) => p.CONTINENT === cont,
    bounds: CONTINENT_BOUNDS[cont],
  };
});

function isCountryType(type) {
  return ['Sovereign country', 'Country', 'Disputed'].includes(type);
}

const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const FIT_PADDING = { paddingTopLeft: [40, 90], paddingBottomRight: [40, 40] };

// ---- SCREEN NAV ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.body.classList.toggle('locked', id !== 'homeScreen');

  const portfolioBtn = document.querySelector('.portfolio-fixed');
  if (portfolioBtn) {
    portfolioBtn.classList.toggle('visible', id === 'homeScreen');
  }
}

function chooseLaenderDifficulty() {
  populateContinentList();
  showScreen('diffScreen');
}

function startLaenderWith(mode) {
  pendingLaenderMode = mode;
  openQuiz('laender');
}

function openQuiz(quizType) {
  if (quizType === 'laender' && !pendingLaenderMode) {
    chooseLaenderDifficulty();
    return;
  }

  quizState.type = quizType;
  const cfg = QUIZ_CONFIG[quizType];

  let title = cfg.title;
  let desc = cfg.description;
  if (quizType === 'laender' && pendingLaenderMode) {
    title = cfg.title + ' — ' + LAENDER_MODES[pendingLaenderMode].label.replace(/^.*— /, '');
    desc = `Modus: ${LAENDER_MODES[pendingLaenderMode].label}`;
  }

  document.getElementById('startTitle').textContent = title;
  document.getElementById('startDesc').textContent = desc;
  document.getElementById('qNum').textContent = 0;
  document.getElementById('qTotal').textContent = 0;

  document.getElementById('startOverlay').classList.remove('hidden');
  document.getElementById('resultOverlay').classList.add('hidden');
  document.getElementById('loadingOverlay').classList.add('hidden');

  showScreen('quizScreen');
  setTimeout(initMap, 50);
}

function exitQuiz() {
  quizState.active = false;
  hideCursorTip();
  clearMarkers();
  pendingLaenderMode = null;
  showScreen('homeScreen');
}

// ---- MAP INIT ----
function initMap() {
  if (map) {
    map.invalidateSize();
    return;
  }
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
    boxZoom: false,
    keyboard: false,
    zoomSnap: 0,
    zoomDelta: 0,
    minZoom: 1,
    maxZoom: 10,
    worldCopyJump: false,
    inertia: false,
  });
  map.setView([20, 25], 2);
  setupMapInteractions();
}

function setupMapInteractions() {
  if (!map || map._interactionsSetup) return;
  map._interactionsSetup = true;

  map.on('mousemove', (e) => { hoverLatLng = e.latlng; });

  const container = map.getContainer();
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (wheelLock) return;
    wheelLock = true;
    setTimeout(() => { wheelLock = false; }, 450);

    if (e.deltaY < 0) {
      const region = findRegionAt(hoverLatLng);
      if (region && REGION_BOUNDS[region]) {
        map.fitBounds(REGION_BOUNDS[region], { animate: true, duration: 0.4, ...FIT_PADDING });
      }
    } else {
      map.fitBounds(quizState.modeBounds || WORLD_BOUNDS, { animate: true, duration: 0.4, ...FIT_PADDING });
    }
  }, { passive: false });

  // Prevent browser pinch/ctrl-zoom
  container.addEventListener('gesturestart', (e) => e.preventDefault());
}

function findRegionAt(latlng) {
  if (!latlng) return null;
  for (const name of REGION_ORDER) {
    const b = REGION_BOUNDS[name];
    if (latlng.lat >= b[0][0] && latlng.lat <= b[1][0] && latlng.lng >= b[0][1] && latlng.lng <= b[1][1]) {
      return name;
    }
  }
  return null;
}

// ---- GEOJSON HELPERS ----
function visitCoords(coords, fn) {
  if (typeof coords[0] === 'number') {
    fn(coords);
  } else {
    coords.forEach(c => visitCoords(c, fn));
  }
}

function applyCoordTransform(geometry, transform) {
  if (!geometry || !geometry.coordinates) return;
  const t = geometry.type;
  if (t === 'Polygon') {
    geometry.coordinates = geometry.coordinates.map(ring => ring.map(transform));
  } else if (t === 'MultiPolygon') {
    geometry.coordinates = geometry.coordinates.map(poly => poly.map(ring => ring.map(transform)));
  }
}

// Shift datelining/Pacific features so each continent renders as one piece.
function preprocessPacific(geojson) {
  geojson.features.forEach(f => {
    const props = f.properties || {};
    const continent = props.CONTINENT || '';

    let lngMin = 180, lngMax = -180;
    let eastCount = 0, westCount = 0;
    try {
      visitCoords(f.geometry.coordinates, ([lng]) => {
        if (lng < lngMin) lngMin = lng;
        if (lng > lngMax) lngMax = lng;
        if (lng > 0) eastCount++; else westCount++;
      });
    } catch (e) { return; }

    let transform = null;
    if (lngMax - lngMin > 180) {
      // crosses dateline — unify halves
      if (eastCount >= westCount) {
        transform = ([lng, lat]) => [lng < 0 ? lng + 360 : lng, lat];
      } else {
        transform = ([lng, lat]) => [lng > 0 ? lng - 360 : lng, lat];
      }
    } else if (continent === 'Oceania' && lngMin < -100) {
      // Pacific Oceania islands entirely on the left of the world map
      transform = ([lng, lat]) => [lng + 360, lat];
    }

    if (transform) applyCoordTransform(f.geometry, transform);
  });
}

// ---- DATA LOADING ----
async function ensureCountriesLoaded() {
  if (geoCountriesData) return geoCountriesData;
  document.getElementById('loadingOverlay').classList.remove('hidden');
  try {
    const res = await fetch(COUNTRY_GEOJSON_URL);
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    geoCountriesData = await res.json();
    preprocessPacific(geoCountriesData);
  } catch (e) {
    console.error('Failed to load countries:', e);
    alert('Karte konnte nicht geladen werden. Bitte prüfe deine Internetverbindung.');
    throw e;
  } finally {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }
  return geoCountriesData;
}

// ---- QUIZ BEGIN ----
async function beginQuiz() {
  document.getElementById('startOverlay').classList.add('hidden');
  document.getElementById('resultOverlay').classList.add('hidden');

  const toggle = document.getElementById('showGuessedToggle');
  quizState.showGuessed = toggle ? toggle.checked : true;
  quizState.answeredCorrectly = new Set();
  quizState.answeredWrongly = new Set();
  quizState.correctCount = 0;
  quizState.wrongCount = 0;

  clearMarkers();
  initMap();

  const type = quizState.type;

  if (type === 'laender' && pendingLaenderMode) {
    const mode = LAENDER_MODES[pendingLaenderMode];
    quizState.modeFilter = mode.filter;
    quizState.modeBounds = mode.bounds;
  } else {
    quizState.modeFilter = null;
    quizState.modeBounds = WORLD_BOUNDS;
  }

  const isInPoolFn = buildIsInPool(type);

  try {
    if (type === 'laender' || type === 'flaggen') {
      await renderCountries(true, isInPoolFn);
    } else if (type === 'staedte') {
      await renderCountries(false, null);
      renderCities();
    } else if (type === 'wasser') {
      await renderCountries(false, null);
      renderWaters();
    } else if (type === 'sehenswuerdigkeiten') {
      await renderCountries(false, null);
      renderLandmarks();
    }
  } catch (e) {
    return;
  }

  buildQuestions(type);

  map.invalidateSize();
  map.fitBounds(quizState.modeBounds, { animate: false, ...FIT_PADDING });

  quizState.idx = 0;
  quizState.active = true;

  const hudPrompt = document.querySelector('.hud-prompt');
  hudPrompt.classList.toggle('flag-mode', type === 'flaggen');
  document.getElementById('cursorTip').classList.toggle('flag-mode', type === 'flaggen');

  document.getElementById('promptLabel').textContent = QUIZ_CONFIG[type].promptLabel;
  document.getElementById('qTotal').textContent = quizState.questions.length;

  nextQuestion();
}

function buildIsInPool(type) {
  if (type === 'laender') {
    return (f) => {
      const props = f.properties || {};
      const iso2raw = props.ISO_A2_EH || props.ISO_A2 || '';
      const iso2 = (iso2raw && iso2raw !== '-99' && iso2raw.length === 2) ? iso2raw : '';
      if (!quizState.modeFilter) return true;
      return quizState.modeFilter(props, iso2);
    };
  }
  if (type === 'flaggen') {
    return (f) => {
      const props = f.properties || {};
      const iso2raw = props.ISO_A2_EH || props.ISO_A2 || '';
      const iso2 = (iso2raw && iso2raw !== '-99' && iso2raw.length === 2) ? iso2raw : '';
      const nameEn = props.NAME_LONG || props.NAME || 'Unknown';
      return !!(iso2 && nameEn && nameEn !== 'Unknown');
    };
  }
  return null;
}

// ---- COUNTRIES ----
async function renderCountries(interactive, isInPool) {
  const data = await ensureCountriesLoaded();
  countryFeatures = [];

  const poolFeatures = isInPool ? data.features.filter(f => isInPool(f)) : data.features;
  const fadedFeatures = isInPool ? data.features.filter(f => !isInPool(f)) : [];

  // Faded layer (under the active layer)
  if (fadedFeatures.length > 0) {
    const fadedLayer = L.geoJSON({ type: 'FeatureCollection', features: fadedFeatures }, {
      style: () => countryFadedStyle(),
      interactive: false,
    }).addTo(map);
    activeLayers.push(fadedLayer);
  }

  // Active layer
  const layer = L.geoJSON({ type: 'FeatureCollection', features: poolFeatures }, {
    style: () => countryDefaultStyle(),
    interactive: interactive,
    onEachFeature: (feature, lyr) => {
      const props = feature.properties || {};
      const nameEn = props.NAME_LONG || props.NAME || 'Unknown';
      const nameDe = DE_NAME_OVERRIDES[nameEn] || props.NAME_DE || nameEn;
      const iso2raw = props.ISO_A2_EH || props.ISO_A2 || '';
      const iso2 = (iso2raw && iso2raw !== '-99' && iso2raw.length === 2) ? iso2raw.toLowerCase() : '';

      const entry = { name: nameDe, nameEn, iso2, layer: lyr, dotMarker: null, props };
      countryFeatures.push(entry);

      if (interactive) {
        lyr.on('click', () => handleClick(entry));
        lyr.on('mouseover', () => {
          if (!quizState.active || lyr._isHighlighted) return;
          lyr.setStyle({ fillColor: MAP_COLORS.landHover });
        });
        lyr.on('mouseout', () => {
          if (!quizState.active || lyr._isHighlighted) return;
          lyr.setStyle(countryDefaultStyle());
        });
      }
    },
  }).addTo(map);
  activeLayers.push(layer);

  if (interactive) {
    countryFeatures.forEach(entry => {
      try {
        const bounds = entry.layer.getBounds();
        const w = bounds.getEast() - bounds.getWest();
        const h = bounds.getNorth() - bounds.getSouth();
        if (Math.max(w, h) < 1.2) {
          const center = bounds.getCenter();
          const dot = L.circleMarker(center, tinyDotStyle()).addTo(map);
          dot.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            handleClick(entry);
          });
          dot.on('mouseover', () => {
            if (!quizState.active || dot._isHighlighted) return;
            dot.setStyle({ radius: 5 });
          });
          dot.on('mouseout', () => {
            if (!quizState.active || dot._isHighlighted) return;
            dot.setStyle(tinyDotStyle());
          });
          entry.dotMarker = dot;
          activeLayers.push(dot);
        }
      } catch (e) { /* skip */ }
    });
  }
}

function countryDefaultStyle() {
  return { fillColor: MAP_COLORS.land, color: MAP_COLORS.landBorder, weight: 0.6, fillOpacity: 1 };
}

function countryFadedStyle() {
  return { fillColor: MAP_COLORS.landFaded, color: MAP_COLORS.landFadedBorder, weight: 0.4, fillOpacity: 0.55 };
}

function tinyDotStyle() {
  return { radius: 3, fillColor: MAP_COLORS.dot, color: MAP_COLORS.dotBorder, weight: 1.2, opacity: 0.95, fillOpacity: 0.95 };
}

// ---- CITIES ----
function renderCities() {
  cityMarkers = [];
  CITIES.forEach(([name, lat, lng]) => {
    const m = L.circleMarker([lat, lng], cityDefaultStyle()).addTo(map);
    const entry = { name, lat, lng, marker: m };
    cityMarkers.push(entry);
    activeLayers.push(m);
    m.on('click', () => handleClick(entry));
    m.on('mouseover', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle({ radius: 7, fillOpacity: 1 });
    });
    m.on('mouseout', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle(cityDefaultStyle());
    });
  });
}

function cityDefaultStyle() {
  return { radius: 4, fillColor: MAP_COLORS.city, color: MAP_COLORS.cityBorder, weight: 1.2, opacity: 1, fillOpacity: 0.9 };
}

// ---- WATERS ----
function renderWaters() {
  waterMarkers = [];
  WATERS.forEach(([name, lat, lng, type]) => {
    const m = L.circleMarker([lat, lng], waterDefaultStyle(type)).addTo(map);
    const entry = { name, lat, lng, type, marker: m };
    waterMarkers.push(entry);
    activeLayers.push(m);
    m.on('click', () => handleClick(entry));
    m.on('mouseover', () => {
      if (!quizState.active || m._isHighlighted) return;
      const s = waterDefaultStyle(type);
      m.setStyle({ ...s, radius: s.radius + 3, fillOpacity: 0.95 });
    });
    m.on('mouseout', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle(waterDefaultStyle(type));
    });
  });
}

function waterDefaultStyle(type) {
  const colors = { ocean: MAP_COLORS.ocean, sea: MAP_COLORS.sea, lake: MAP_COLORS.lake, river: MAP_COLORS.river };
  const sizes  = { ocean: 10, sea: 8, lake: 6, river: 5 };
  return {
    radius: sizes[type] || 5,
    fillColor: colors[type] || MAP_COLORS.sea,
    color: '#fff', weight: 1.2, opacity: 1, fillOpacity: 0.85,
  };
}

// ---- LANDMARKS ----
function renderLandmarks() {
  landmarkMarkers = [];
  LANDMARKS.forEach(([name, lat, lng]) => {
    const m = L.circleMarker([lat, lng], landmarkDefaultStyle()).addTo(map);
    const entry = { name, lat, lng, marker: m };
    landmarkMarkers.push(entry);
    activeLayers.push(m);
    m.on('click', () => handleClick(entry));
    m.on('mouseover', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle({ radius: 8, fillOpacity: 1 });
    });
    m.on('mouseout', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle(landmarkDefaultStyle());
    });
  });
}

function landmarkDefaultStyle() {
  return { radius: 5, fillColor: MAP_COLORS.landmark, color: MAP_COLORS.landmarkBorder, weight: 1.2, opacity: 1, fillOpacity: 0.9 };
}

// ---- CLEANUP ----
function clearMarkers() {
  if (map) {
    activeLayers.forEach(l => { try { map.removeLayer(l); } catch (e) {} });
  }
  activeLayers = [];
  countryFeatures = [];
  cityMarkers = [];
  waterMarkers = [];
  landmarkMarkers = [];
}

// ---- QUESTIONS ----
function buildQuestions(type) {
  let pool = [];
  if (type === 'laender' || type === 'flaggen') {
    pool = countryFeatures.filter(c => c.name && c.name !== 'Unknown' && (type !== 'flaggen' || c.iso2));
  } else if (type === 'staedte') {
    pool = [...cityMarkers];
  } else if (type === 'wasser') {
    pool = [...waterMarkers];
  } else if (type === 'sehenswuerdigkeiten') {
    pool = [...landmarkMarkers];
  }
  quizState.questions = shuffle(pool);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextQuestion() {
  if (quizState.idx >= quizState.questions.length) {
    endQuiz();
    return;
  }
  resetHighlights();

  const q = quizState.questions[quizState.idx];
  quizState.current = q;

  document.getElementById('qNum').textContent = quizState.idx + 1;

  if (quizState.type === 'flaggen') {
    const url = `https://flagcdn.com/w160/${q.iso2}.png`;
    document.getElementById('promptFlag').src = url;
    document.getElementById('cursorTipFlag').src = url;
  } else {
    document.getElementById('promptText').textContent = q.name;
    document.getElementById('cursorTipText').textContent = q.name;
  }

  showCursorTip();
}

// ---- ANSWER ----
function handleClick(entry) {
  if (!quizState.active) return;
  const correct = entry === quizState.current;

  if (correct) {
    quizState.correctCount++;
    quizState.answeredCorrectly.add(entry);
    quizState.answeredWrongly.delete(entry);
    highlightCorrect(entry);
  } else {
    quizState.wrongCount++;
    if (!quizState.answeredCorrectly.has(entry)) {
      quizState.answeredWrongly.add(entry);
    }
    quizState.answeredCorrectly.add(quizState.current);
    quizState.answeredWrongly.delete(quizState.current);
    highlightWrong(entry);
    highlightCorrect(quizState.current);
  }

  quizState.idx++;
  hideCursorTip();
  setTimeout(() => { if (quizState.active) nextQuestion(); }, 600);
}

// ---- HIGHLIGHTS ----
function applyHighlight(target, fill, border) {
  if (!target || !target.setStyle) return;
  if (target instanceof L.CircleMarker) {
    target.setStyle({ fillColor: fill, color: border, fillOpacity: 0.95, weight: 1.4, radius: 5 });
  } else {
    target.setStyle({ fillColor: fill, color: border, fillOpacity: 0.85, weight: 0.9 });
  }
  target._isHighlighted = true;
}

function highlightCorrect(entry) {
  [entry.layer, entry.dotMarker, entry.marker].forEach(t => {
    if (t) applyHighlight(t, MAP_COLORS.correct, MAP_COLORS.correctBorder);
  });
}

function highlightWrong(entry) {
  [entry.layer, entry.dotMarker, entry.marker].forEach(t => {
    if (t) applyHighlight(t, MAP_COLORS.wrong, MAP_COLORS.wrongBorder);
  });
}

function resetHighlights() {
  const keepGreen = (entry) => quizState.showGuessed && quizState.answeredCorrectly.has(entry);
  const keepRed   = (entry) => quizState.showGuessed && quizState.answeredWrongly.has(entry);

  countryFeatures.forEach(c => {
    if (keepGreen(c)) {
      if (c.layer) applyHighlight(c.layer, MAP_COLORS.correct, MAP_COLORS.correctBorder);
      if (c.dotMarker) applyHighlight(c.dotMarker, MAP_COLORS.correct, MAP_COLORS.correctBorder);
    } else if (keepRed(c)) {
      if (c.layer) applyHighlight(c.layer, MAP_COLORS.wrong, MAP_COLORS.wrongBorder);
      if (c.dotMarker) applyHighlight(c.dotMarker, MAP_COLORS.wrong, MAP_COLORS.wrongBorder);
    } else {
      if (c.layer) { c.layer.setStyle(countryDefaultStyle()); c.layer._isHighlighted = false; }
      if (c.dotMarker) { c.dotMarker.setStyle(tinyDotStyle()); c.dotMarker._isHighlighted = false; }
    }
  });
  const resetMarkerPool = (pool, styleFn) => {
    pool.forEach(e => {
      if (keepGreen(e)) {
        if (e.marker) applyHighlight(e.marker, MAP_COLORS.correct, MAP_COLORS.correctBorder);
      } else if (keepRed(e)) {
        if (e.marker) applyHighlight(e.marker, MAP_COLORS.wrong, MAP_COLORS.wrongBorder);
      } else if (e.marker) {
        e.marker.setStyle(styleFn(e));
        e.marker._isHighlighted = false;
      }
    });
  };
  resetMarkerPool(cityMarkers, () => cityDefaultStyle());
  resetMarkerPool(waterMarkers, (w) => waterDefaultStyle(w.type));
  resetMarkerPool(landmarkMarkers, () => landmarkDefaultStyle());
}

// ---- END ----
function endQuiz() {
  quizState.active = false;
  hideCursorTip();

  const total = quizState.questions.length;
  const correct = quizState.correctCount;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  document.getElementById('resultPercent').textContent = pct + '%';
  document.getElementById('resultCorrect').textContent = correct;
  document.getElementById('resultTotal').textContent = total;

  let msg;
  if (pct >= 90) msg = 'Weltklasse! Du kennst die Welt wie deine Westentasche.';
  else if (pct >= 70) msg = 'Sehr gut — solides Wissen!';
  else if (pct >= 50) msg = 'Nicht schlecht — da geht noch was.';
  else msg = 'Üb noch ein bisschen und versuch es nochmal!';

  document.getElementById('resultMsg').textContent = msg;
  document.getElementById('resultOverlay').classList.remove('hidden');
}

// ---- CURSOR TIP ----
function showCursorTip() {
  if (IS_TOUCH) return;
  document.getElementById('cursorTip').classList.add('visible');
}

function hideCursorTip() {
  document.getElementById('cursorTip').classList.remove('visible');
}

document.addEventListener('mousemove', (e) => {
  const tip = document.getElementById('cursorTip');
  if (!tip.classList.contains('visible')) return;
  tip.style.left = e.clientX + 'px';
  tip.style.top = e.clientY + 'px';
});

// ---- CONTINENT LIST ----
function populateContinentList() {
  const list = document.getElementById('continentList');
  if (list.children.length > 0) return;

  Object.entries(CONTINENT_DE).forEach(([engName, deName]) => {
    const key = engName.toLowerCase().replace(' ', '');
    const row = document.createElement('div');
    row.className = 'continent-row';
    row.innerHTML = `
      <span class="cont-name">${deName}</span>
      <div class="cont-btns">
        <button class="cont-btn" data-mode="${key}_c">Länder</button>
        <button class="cont-btn" data-mode="${key}_t">+ Territorien</button>
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => startLaenderWith(btn.dataset.mode));
  });
}

// ---- SCROLL ANIMATIONS ----
function setupScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
      }
    });
  }, { threshold: 0.2, rootMargin: '-50px 0px -50px 0px' });

  document.querySelectorAll('.feature').forEach(s => observer.observe(s));
}

// ---- EVENT WIRING ----
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.feature-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.quiz;
      if (q === 'laender') chooseLaenderDifficulty();
      else openQuiz(q);
    });
  });

  document.querySelectorAll('#diffScreen .diff-card').forEach(card => {
    card.addEventListener('click', () => startLaenderWith(card.dataset.mode));
  });

  populateContinentList();
  setupScrollAnimations();

  const portfolioBtn = document.querySelector('.portfolio-fixed');
  if (portfolioBtn) portfolioBtn.classList.add('visible');
});

window.addEventListener('resize', () => {
  if (map && document.getElementById('quizScreen').classList.contains('active')) {
    setTimeout(() => {
      map.invalidateSize();
      if (quizState.modeBounds) map.fitBounds(quizState.modeBounds, { animate: false, ...FIT_PADDING });
    }, 50);
  }
});
