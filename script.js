// ===========================================================================
// WealthScope — Quiz Engine
// ===========================================================================

// ---- STATE ----
let map = null;
let insetMap = null;
let geoCountriesData = null;
let activeLayers = [];
let activeInsetLayers = [];
let countryFeatures = [];
let cityMarkers = [];
let waterMarkers = [];
let landmarkMarkers = [];

let pendingLaenderMode = null;

const quizState = {
  type: null,
  questions: [],
  idx: 0,
  score: 0,
  wrong: 0,
  active: false,
  current: null,
  modeFilter: null,
  modeBounds: null,
};

// ---- CONFIG ----
const QUIZ_CONFIG = {
  laender: { title: "Länderquiz", description: "Klicke das gefragte Land. 20 Fragen.", promptLabel: "Klicke das Land:", count: 20 },
  flaggen: { title: "Flaggenquiz", description: "Klicke das Land zur angezeigten Flagge.", promptLabel: "Klicke das Land:", count: 20 },
  staedte: { title: "Städtequiz", description: "Klicke die gefragte Stadt auf der Karte.", promptLabel: "Klicke die Stadt:", count: 20 },
  wasser:  { title: "Wasserquiz", description: "Klicke das gefragte Gewässer.", promptLabel: "Klicke das Gewässer:", count: 20 },
  sehenswuerdigkeiten: { title: "Sehenswürdigkeiten", description: "Klicke die gefragte Sehenswürdigkeit auf der Karte.", promptLabel: "Klicke:", count: 20 },
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

// ---- SCREEN NAV ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.body.classList.toggle('locked', id !== 'homeScreen');
  
  // Show portfolio button only on home screen
  const portfolioBtn = document.querySelector('.portfolio-fixed');
  if (portfolioBtn) {
    if (id === 'homeScreen') {
      portfolioBtn.classList.add('visible');
    } else {
      portfolioBtn.classList.remove('visible');
    }
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
  document.getElementById('qTotal').textContent = cfg.count;
  document.getElementById('scoreVal').textContent = 0;
  document.getElementById('qNum').textContent = 0;

  document.getElementById('startOverlay').classList.remove('hidden');
  document.getElementById('resultOverlay').classList.add('hidden');
  document.getElementById('loadingOverlay').classList.add('hidden');

  showScreen('quizScreen');
  setTimeout(initMap, 50);
}

function exitQuiz() {
  quizState.active = false;
  hideCursorTip();
  hideInset();
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
  });
  map.setView([20, 0], 2);
}

function initInsetMap() {
  if (insetMap) {
    insetMap.invalidateSize();
    return;
  }
  insetMap = L.map('insetCaribbeanMap', {
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
  });
}

function showInset() {
  document.getElementById('insetCaribbean').classList.remove('hidden');
  setTimeout(() => insetMap && insetMap.invalidateSize(), 100);
}

function hideInset() {
  document.getElementById('insetCaribbean').classList.add('hidden');
}

// ---- DATA LOADING ----
async function ensureCountriesLoaded() {
  if (geoCountriesData) return geoCountriesData;
  document.getElementById('loadingOverlay').classList.remove('hidden');
  try {
    const res = await fetch(COUNTRY_GEOJSON_URL);
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    geoCountriesData = await res.json();
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

  try {
    if (type === 'laender' || type === 'flaggen') {
      await renderCountries(true);
    } else if (type === 'staedte') {
      await renderCountries(false);
      renderCities();
    } else if (type === 'wasser') {
      await renderCountries(false);
      renderWaters();
    } else if (type === 'sehenswuerdigkeiten') {
      await renderCountries(false);
      renderLandmarks();
    }
  } catch (e) {
    return;
  }

  buildQuestions(type);
  setupCaribbeanInset(type);

  map.invalidateSize();
  map.fitBounds(quizState.modeBounds, { animate: false, padding: [10, 10] });

  quizState.idx = 0;
  quizState.score = 0;
  quizState.wrong = 0;
  quizState.active = true;

  const hudPrompt = document.querySelector('.hud-prompt');
  hudPrompt.classList.toggle('flag-mode', type === 'flaggen');
  document.getElementById('cursorTip').classList.toggle('flag-mode', type === 'flaggen');

  document.getElementById('promptLabel').textContent = QUIZ_CONFIG[type].promptLabel;
  document.getElementById('scoreVal').textContent = 0;
  document.getElementById('qTotal').textContent = quizState.questions.length;

  nextQuestion();
}

// ---- COUNTRIES ----
async function renderCountries(interactive) {
  const data = await ensureCountriesLoaded();
  countryFeatures = [];

  const layer = L.geoJSON(data, {
    style: () => countryDefaultStyle(),
    interactive: interactive,
    onEachFeature: (feature, lyr) => {
      const props = feature.properties || {};
      const nameEn = props.NAME_LONG || props.NAME || 'Unknown';
      const nameDe = DE_NAME_OVERRIDES[nameEn] || props.NAME_DE || nameEn;
      const iso2raw = props.ISO_A2_EH || props.ISO_A2 || '';
      const iso2 = (iso2raw && iso2raw !== '-99' && iso2raw.length === 2) ? iso2raw.toLowerCase() : '';

      const entry = { name: nameDe, nameEn, iso2, layer: lyr, dotMarker: null, insetLayer: null, props };
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
            dot.setStyle({ radius: 7 });
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

function tinyDotStyle() {
  return { radius: 5, fillColor: MAP_COLORS.dot, color: MAP_COLORS.dotBorder, weight: 2, opacity: 0.95, fillOpacity: 0.95 };
}

// ---- CITIES ----
function renderCities() {
  cityMarkers = [];
  CITIES.forEach(([name, lat, lng]) => {
    const m = L.circleMarker([lat, lng], cityDefaultStyle()).addTo(map);
    const entry = { name, lat, lng, marker: m, insetMarker: null };
    cityMarkers.push(entry);
    activeLayers.push(m);
    m.on('click', () => handleClick(entry));
    m.on('mouseover', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle({ radius: 8, fillOpacity: 1 });
    });
    m.on('mouseout', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle(cityDefaultStyle());
    });
  });
}

function cityDefaultStyle() {
  return { radius: 5, fillColor: MAP_COLORS.city, color: MAP_COLORS.cityBorder, weight: 1.5, opacity: 1, fillOpacity: 0.9 };
}

// ---- WATERS ----
function renderWaters() {
  waterMarkers = [];
  WATERS.forEach(([name, lat, lng, type]) => {
    const m = L.circleMarker([lat, lng], waterDefaultStyle(type)).addTo(map);
    const entry = { name, lat, lng, type, marker: m, insetMarker: null };
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
  const sizes  = { ocean: 11, sea: 9, lake: 7, river: 6 };
  return {
    radius: sizes[type] || 6,
    fillColor: colors[type] || MAP_COLORS.sea,
    color: '#fff', weight: 1.5, opacity: 1, fillOpacity: 0.85,
  };
}

// ---- LANDMARKS ----
function renderLandmarks() {
  landmarkMarkers = [];
  LANDMARKS.forEach(([name, lat, lng]) => {
    const m = L.circleMarker([lat, lng], landmarkDefaultStyle()).addTo(map);
    const entry = { name, lat, lng, marker: m, insetMarker: null };
    landmarkMarkers.push(entry);
    activeLayers.push(m);
    m.on('click', () => handleClick(entry));
    m.on('mouseover', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle({ radius: 9, fillOpacity: 1 });
    });
    m.on('mouseout', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle(landmarkDefaultStyle());
    });
  });
}

function landmarkDefaultStyle() {
  return { radius: 6, fillColor: MAP_COLORS.landmark, color: MAP_COLORS.landmarkBorder, weight: 1.5, opacity: 1, fillOpacity: 0.9 };
}

// ---- INSET (Karibik) ----
function setupCaribbeanInset(quizType) {
  const pool = quizState.questions;
  const shouldShow = pool.some(q => {
    if (quizType === 'laender' || quizType === 'flaggen') {
      return CARIBBEAN_ISO_HINT.has((q.iso2 || '').toUpperCase());
    }
    if (typeof q.lat === 'number' && typeof q.lng === 'number') {
      return isInBounds([q.lat, q.lng], CARIBBEAN_BOUNDS);
    }
    return false;
  });

  if (!shouldShow) {
    hideInset();
    return;
  }

  initInsetMap();
  clearInsetLayers();

  const interactive = (quizType === 'laender' || quizType === 'flaggen');
  renderInsetCountries(interactive);
  if (quizType === 'staedte') renderInsetCities();
  if (quizType === 'wasser') renderInsetWaters();
  if (quizType === 'sehenswuerdigkeiten') renderInsetLandmarks();

  showInset();
  setTimeout(() => {
    if (!insetMap) return;
    insetMap.invalidateSize();
    insetMap.fitBounds(CARIBBEAN_BOUNDS, { padding: [4, 4], animate: false });
  }, 60);
}

function renderInsetCountries(interactive) {
  if (!geoCountriesData) return;
  const features = geoCountriesData.features.filter(f => {
    const b = computeFeatureBounds(f);
    return boundsIntersect(b, CARIBBEAN_BOUNDS);
  });
  const layer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: () => countryDefaultStyle(),
    interactive: interactive,
    onEachFeature: (feature, lyr) => {
      const entry = countryFeatures.find(e => e.props === feature.properties);
      if (!entry) return;
      entry.insetLayer = lyr;
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
  }).addTo(insetMap);
  activeInsetLayers.push(layer);
}

function renderInsetCities() {
  cityMarkers.forEach(entry => {
    if (!isInBounds([entry.lat, entry.lng], CARIBBEAN_BOUNDS)) return;
    const m = L.circleMarker([entry.lat, entry.lng], cityDefaultStyle()).addTo(insetMap);
    entry.insetMarker = m;
    activeInsetLayers.push(m);
    m.on('click', () => handleClick(entry));
    m.on('mouseover', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle({ radius: 8, fillOpacity: 1 });
    });
    m.on('mouseout', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle(cityDefaultStyle());
    });
  });
}

function renderInsetWaters() {
  waterMarkers.forEach(entry => {
    if (!isInBounds([entry.lat, entry.lng], CARIBBEAN_BOUNDS)) return;
    const m = L.circleMarker([entry.lat, entry.lng], waterDefaultStyle(entry.type)).addTo(insetMap);
    entry.insetMarker = m;
    activeInsetLayers.push(m);
    m.on('click', () => handleClick(entry));
    m.on('mouseover', () => {
      if (!quizState.active || m._isHighlighted) return;
      const s = waterDefaultStyle(entry.type);
      m.setStyle({ ...s, radius: s.radius + 3 });
    });
    m.on('mouseout', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle(waterDefaultStyle(entry.type));
    });
  });
}

function renderInsetLandmarks() {
  landmarkMarkers.forEach(entry => {
    if (!isInBounds([entry.lat, entry.lng], CARIBBEAN_BOUNDS)) return;
    const m = L.circleMarker([entry.lat, entry.lng], landmarkDefaultStyle()).addTo(insetMap);
    entry.insetMarker = m;
    activeInsetLayers.push(m);
    m.on('click', () => handleClick(entry));
    m.on('mouseover', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle({ radius: 9, fillOpacity: 1 });
    });
    m.on('mouseout', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle(landmarkDefaultStyle());
    });
  });
}

// ---- GEOMETRY HELPERS ----
function computeFeatureBounds(feature) {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    } else {
      coords.forEach(visit);
    }
  };
  try { visit(feature.geometry.coordinates); }
  catch (e) { return [[0, 0], [0, 0]]; }
  return [[minLat, minLng], [maxLat, maxLng]];
}

function boundsIntersect(a, b) {
  const [[s1, w1], [n1, e1]] = a;
  const [[s2, w2], [n2, e2]] = b;
  return !(n1 < s2 || s1 > n2 || e1 < w2 || w1 > e2);
}

function isInBounds([lat, lng], [[s, w], [n, e]]) {
  return lat >= s && lat <= n && lng >= w && lng <= e;
}

// ---- CLEANUP ----
function clearMarkers() {
  if (map) {
    activeLayers.forEach(l => { try { map.removeLayer(l); } catch (e) {} });
  }
  if (insetMap) {
    activeInsetLayers.forEach(l => { try { insetMap.removeLayer(l); } catch (e) {} });
  }
  activeLayers = [];
  activeInsetLayers = [];
  countryFeatures = [];
  cityMarkers = [];
  waterMarkers = [];
  landmarkMarkers = [];
}

function clearInsetLayers() {
  if (insetMap) {
    activeInsetLayers.forEach(l => { try { insetMap.removeLayer(l); } catch (e) {} });
  }
  activeInsetLayers = [];
  countryFeatures.forEach(c => c.insetLayer = null);
  cityMarkers.forEach(c => c.insetMarker = null);
  waterMarkers.forEach(w => w.insetMarker = null);
  landmarkMarkers.forEach(l => l.insetMarker = null);
}

// ---- QUESTIONS ----
function buildQuestions(type) {
  let pool = [];
  if (type === 'laender') {
    pool = countryFeatures.filter(c => {
      if (!c.name || c.name === 'Unknown') return false;
      if (!quizState.modeFilter) return true;
      return quizState.modeFilter(c.props, c.iso2);
    });
  } else if (type === 'flaggen') {
    pool = countryFeatures.filter(c => c.iso2 && c.name && c.name !== 'Unknown');
  } else if (type === 'staedte') {
    pool = [...cityMarkers];
  } else if (type === 'wasser') {
    pool = [...waterMarkers];
  } else if (type === 'sehenswuerdigkeiten') {
    pool = [...landmarkMarkers];
  }
  const cfg = QUIZ_CONFIG[type];
  quizState.questions = shuffle(pool).slice(0, Math.min(cfg.count, pool.length));
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
    quizState.score++;
    highlightCorrect(entry);
    flashFeedback(entry, true);
  } else {
    quizState.wrong++;
    highlightWrong(entry);
    highlightCorrect(quizState.current);
    flashFeedback(entry, false);
  }
  document.getElementById('scoreVal').textContent = quizState.score;

  quizState.idx++;
  hideCursorTip();
  setTimeout(() => { if (quizState.active) nextQuestion(); }, 1100);
}

// ---- HIGHLIGHTS ----
function applyHighlight(target, fill, border) {
  if (!target || !target.setStyle) return;
  if (target instanceof L.CircleMarker) {
    target.setStyle({ fillColor: fill, color: border, fillOpacity: 0.95, weight: 2, radius: 9 });
  } else {
    target.setStyle({ fillColor: fill, color: border, fillOpacity: 0.85, weight: 1.8 });
  }
  target._isHighlighted = true;
}

function highlightCorrect(entry) {
  [entry.layer, entry.insetLayer, entry.dotMarker, entry.marker, entry.insetMarker].forEach(t => {
    if (t) applyHighlight(t, MAP_COLORS.correct, MAP_COLORS.correctBorder);
  });
}

function highlightWrong(entry) {
  [entry.layer, entry.insetLayer, entry.dotMarker, entry.marker, entry.insetMarker].forEach(t => {
    if (t) applyHighlight(t, MAP_COLORS.wrong, MAP_COLORS.wrongBorder);
  });
}

function resetHighlights() {
  countryFeatures.forEach(c => {
    [c.layer, c.insetLayer].forEach(l => {
      if (l) { l.setStyle(countryDefaultStyle()); l._isHighlighted = false; }
    });
    if (c.dotMarker) { c.dotMarker.setStyle(tinyDotStyle()); c.dotMarker._isHighlighted = false; }
  });
  cityMarkers.forEach(c => {
    [c.marker, c.insetMarker].forEach(m => {
      if (m) { m.setStyle(cityDefaultStyle()); m._isHighlighted = false; }
    });
  });
  waterMarkers.forEach(w => {
    [w.marker, w.insetMarker].forEach(m => {
      if (m) { m.setStyle(waterDefaultStyle(w.type)); m._isHighlighted = false; }
    });
  });
  landmarkMarkers.forEach(l => {
    [l.marker, l.insetMarker].forEach(m => {
      if (m) { m.setStyle(landmarkDefaultStyle()); m._isHighlighted = false; }
    });
  });
}

function flashFeedback(entry, correct) {
  let latlng;
  if (entry.layer) latlng = entry.layer.getBounds().getCenter();
  else if (entry.marker) latlng = entry.marker.getLatLng();
  else if (entry.dotMarker) latlng = entry.dotMarker.getLatLng();
  else return;

  const pt = map.latLngToContainerPoint(latlng);
  const pop = document.createElement('div');
  pop.className = 'feedback-pop ' + (correct ? 'ok' : 'bad');
  pop.textContent = correct ? '+1' : '✕';
  pop.style.left = pt.x + 'px';
  pop.style.top = pt.y + 'px';
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 900);
}

// ---- END ----
function endQuiz() {
  quizState.active = false;
  hideCursorTip();

  const total = quizState.questions.length;
  const correct = quizState.score;
  const wrong = quizState.wrong;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  document.getElementById('resultScore').textContent = `${correct} / ${total}`;
  document.getElementById('resultCorrect').textContent = correct;
  document.getElementById('resultWrong').textContent = wrong;
  document.getElementById('resultPercent').textContent = pct + '%';

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
  // Quiz buttons on the landing page
  document.querySelectorAll('.feature-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.quiz;
      if (q === 'laender') chooseLaenderDifficulty();
      else openQuiz(q);
    });
  });

  // Difficulty cards
  document.querySelectorAll('#diffScreen .diff-card').forEach(card => {
    card.addEventListener('click', () => startLaenderWith(card.dataset.mode));
  });

  populateContinentList();
  setupScrollAnimations();
  
  // Show portfolio button on initial load (home screen is active)
  const portfolioBtn = document.querySelector('.portfolio-fixed');
  if (portfolioBtn) {
    portfolioBtn.classList.add('visible');
  }
});

window.addEventListener('resize', () => {
  if (map && document.getElementById('quizScreen').classList.contains('active')) {
    setTimeout(() => {
      map.invalidateSize();
      if (quizState.modeBounds) map.fitBounds(quizState.modeBounds, { animate: false, padding: [10, 10] });
      if (insetMap && !document.getElementById('insetCaribbean').classList.contains('hidden')) {
        insetMap.invalidateSize();
        insetMap.fitBounds(CARIBBEAN_BOUNDS, { padding: [4, 4], animate: false });
      }
    }, 50);
  }
});
