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

let pendingMode = null;
let hoverLatLng = null;
let wheelLock = false;

const quizState = {
  type: null,
  questions: [],
  idx: 0,
  correctCount: 0,
  wrongCount: 0,
  active: false,
  answering: false,
  current: null,
  modeFilter: null,
  modeBounds: null,
  showGuessed: true,
  correctKeys: new Set(),
  wrongKeys: new Set(),
};

function entryKey(entry) {
  return entry.iso2 || entry;
}

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

// Städte- und Sehenswürdigkeitenmodi: Welt + jeder Kontinent
const STAEDTE_MODES = {
  world:   { label: 'Welt — alle Städte', filter: () => true, bounds: WORLD_BOUNDS },
  world_h: { label: 'Welt — Hauptstädte', filter: (c) => c.isCapital, bounds: WORLD_BOUNDS },
};
const SEHENSWUERDIGKEITEN_MODES = {
  world: { label: 'Welt — alle Sehenswürdigkeiten', filter: () => true, bounds: WORLD_BOUNDS },
};
['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'].forEach(cont => {
  const k = cont.toLowerCase().replace(' ', '');
  STAEDTE_MODES[`${k}_c`] = {
    label: `${CONTINENT_DE[cont]} — Städte`,
    filter: (item) => item.continent === cont,
    bounds: CONTINENT_BOUNDS[cont],
  };
  STAEDTE_MODES[`${k}_h`] = {
    label: `${CONTINENT_DE[cont]} — Hauptstädte`,
    filter: (item) => item.continent === cont && item.isCapital,
    bounds: CONTINENT_BOUNDS[cont],
  };
  SEHENSWUERDIGKEITEN_MODES[`${k}_c`] = {
    label: `${CONTINENT_DE[cont]} — Sehenswürdigkeiten`,
    filter: (item) => item.continent === cont,
    bounds: CONTINENT_BOUNDS[cont],
  };
});

// Wasserquiz-Modi: Welt + nach Gewässertyp
const WASSER_MODES = {
  world:   { label: 'Welt — alle Gewässer', filter: () => true, bounds: WORLD_BOUNDS },
  ozeane:  { label: 'Ozeane & Meere', filter: (w) => w.type === 'ocean' || w.type === 'sea', bounds: WORLD_BOUNDS },
  seen:    { label: 'Seen', filter: (w) => w.type === 'lake', bounds: WORLD_BOUNDS },
  fluesse: { label: 'Flüsse', filter: (w) => w.type === 'river', bounds: WORLD_BOUNDS },
};

// Flaggenquiz nutzt die gleichen Modi wie Länderquiz (Filter sind ISO-basiert)
const QUIZ_MODES = {
  laender: LAENDER_MODES,
  flaggen: LAENDER_MODES,
  staedte: STAEDTE_MODES,
  wasser: WASSER_MODES,
  sehenswuerdigkeiten: SEHENSWUERDIGKEITEN_MODES,
};

let pendingQuizType = null;

// Heuristische Kontinent-Zuordnung anhand lat/lng (für Städte/Sehenswürdigkeiten).
function continentOf(lat, lng) {
  // Pazifik-Ozeanien (positiv > 110 oder negativ < -150)
  if ((lng > 110 || lng < -150) && lat < 16 && lat > -50) return 'Oceania';
  // Amerikas (west von -30)
  if (lng < -30) {
    if (lat < 13) return 'South America';
    return 'North America';
  }
  // Mittlerer Osten oberhalb Arabische Halbinsel
  if (lat >= 25 && lat < 50 && lng >= 35 && lng <= 60) return 'Asia';
  // Arabische Halbinsel
  if (lat >= 12 && lat < 30 && lng >= 43 && lng <= 60) return 'Asia';
  // Nordafrika (westlich vom Roten Meer)
  if (lat > -37 && lat < 38 && lng > -20 && lng < 33) return 'Africa';
  // Ostafrika (Horn etc.)
  if (lat > -10 && lat < 22 && lng >= 33 && lng < 52) return 'Africa';
  // Sub-Sahara / Südliches Afrika
  if (lat <= 0 && lat > -37 && lng >= -20 && lng <= 52) return 'Africa';
  // Europa (Russland west)
  if (lat > 35 && lat < 72 && lng > -25 && lng < 60) return 'Europe';
  // Asien Catch-all
  if (lat > -12 && lng > 25 && lat < 78) return 'Asia';
  return null;
}

const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const FIT_PADDING_DEFAULT = { paddingTopLeft: [40, 50], paddingBottomRight: [40, 20] };
// Länder mit klar erkennbarer Hauptinsel/-fläche, die keinen extra Dot brauchen.
const NO_DOT_ISO = new Set(['AU', 'PG', 'NZ', 'FJ', 'NC']);

function getModePadding() {
  const mode = pendingMode || '';
  if (mode.startsWith('northamerica_')) {
    return { paddingTopLeft: [40, 30], paddingBottomRight: [40, 50] };
  }
  if (mode.startsWith('oceania_')) {
    return { paddingTopLeft: [40, 100], paddingBottomRight: [40, 25] };
  }
  return FIT_PADDING_DEFAULT;
}

function getRegionPadding(region) {
  if (region === 'Karibik')     return { paddingTopLeft: [40, 80], paddingBottomRight: [40, 80] };
  if (region === 'Ozeanien')    return { paddingTopLeft: [40, 100], paddingBottomRight: [40, 25] };
  if (region === 'Nordamerika') return { paddingTopLeft: [40, 30], paddingBottomRight: [40, 50] };
  return FIT_PADDING_DEFAULT;
}

// ---- SCREEN NAV ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // homeScreen (Scroll-Landing) und hubScreen brauchen Scroll
  const scrollable = id === 'homeScreen' || id === 'hubScreen';
  document.body.classList.toggle('locked', !scrollable);

  const hubBack = document.querySelector('.hub-back');
  if (hubBack) hubBack.classList.toggle('visible', id === 'homeScreen');
}

function chooseQuizDifficulty(quizType) {
  populateDiffScreen(quizType);
  showScreen('diffScreen');
}

function startWithMode(mode) {
  pendingMode = mode;
  openQuiz(pendingQuizType);
}

function openQuiz(quizType) {
  if (QUIZ_MODES[quizType] && !pendingMode) {
    chooseQuizDifficulty(quizType);
    return;
  }

  quizState.type = quizType;
  const cfg = QUIZ_CONFIG[quizType];

  let title = cfg.title;
  let desc = cfg.description;
  const modes = QUIZ_MODES[quizType];
  if (modes && pendingMode && modes[pendingMode]) {
    const modeLabel = modes[pendingMode].label;
    title = cfg.title + ' — ' + modeLabel.replace(/^.*— /, '');
    desc = `Modus: ${modeLabel}`;
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
  quizState.answering = false;
  hideCursorTip();
  clearMarkers();
  const type = quizState.type;
  const needsModeAuswahl = QUIZ_MODES[type] !== undefined;
  pendingMode = null;
  if (needsModeAuswahl) {
    populateDiffScreen(type);
    showScreen('diffScreen');
  } else {
    showScreen('homeScreen');
  }
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

function getAllowedRegions() {
  const allAll = ['Karibik', 'Nordamerika', 'Südamerika', 'Zentralamerika', 'Europa', 'Afrika', 'Asien', 'Ozeanien'];
  const mode = pendingMode || '';
  // Welt-Modus (oder kein Modus — z.B. Wasserquiz): alle Regionen
  if (!mode || mode === 'world' || mode.startsWith('world_')) return allAll;
  // Kontinent-Modi: nur Nordamerika → Karibik erlaubt
  if (mode.startsWith('northamerica_')) return ['Karibik'];
  return [];
}

function setupMapInteractions() {
  if (!map || map._interactionsSetup) return;
  map._interactionsSetup = true;

  map.on('mousemove', (e) => { hoverLatLng = e.latlng; });

  const container = map.getContainer();
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (wheelLock) return;

    if (e.deltaY < 0) {
      const allowed = getAllowedRegions();
      if (allowed.length === 0) return;
      const region = findRegionAt(hoverLatLng);
      if (region && allowed.includes(region) && REGION_BOUNDS[region]) {
        wheelLock = true;
        setTimeout(() => { wheelLock = false; }, 350);
        map.fitBounds(REGION_BOUNDS[region], { animate: false, ...getRegionPadding(region) });
      }
    } else {
      wheelLock = true;
      setTimeout(() => { wheelLock = false; }, 350);
      map.fitBounds(quizState.modeBounds || WORLD_BOUNDS, { animate: false, ...getModePadding() });
    }
  }, { passive: false });

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
      // For Oceania always east-shift (keeps Kiribati Phoenix/Line Islands together with Gilbert)
      const eastShift = continent === 'Oceania' || eastCount >= westCount;
      if (eastShift) {
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
  quizState.correctKeys = new Set();
  quizState.wrongKeys = new Set();
  quizState.correctCount = 0;
  quizState.wrongCount = 0;
  quizState.answering = false;

  clearMarkers();
  initMap();

  const type = quizState.type;
  const modes = QUIZ_MODES[type];
  if (modes && pendingMode && modes[pendingMode]) {
    const mode = modes[pendingMode];
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
  map.fitBounds(quizState.modeBounds, { animate: false, ...getModePadding() });

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
      if (!iso2 || !nameEn || nameEn === 'Unknown') return false;
      if (!quizState.modeFilter) return true;
      return quizState.modeFilter(props, iso2);
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

      const entry = { name: nameDe, nameEn, iso2, layer: lyr, dotMarkers: [], hitMarkers: [], props };
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
      entry.dotMarkers = [];
      entry.hitMarkers = [];
      try {
        const iso = (entry.iso2 || '').toUpperCase();
        // Diese Länder haben mindestens eine klar grosse Hauptinsel —
        // brauchen keinen extra Klick-Punkt: Australien, PNG, NZ, Fidschi, Neukaledonien.
        if (NO_DOT_ISO.has(iso)) return;
        const geom = entry.layer.feature && entry.layer.feature.geometry;
        const maxPolyDim = maxPolygonDim(geom);
        // Polygon-Schwelle 3°: deckt alle kleinen Inselstaaten ab — Kap Verde,
        // Falkland, Bahamas, Komoren, Malediven, Marshall, Kiribati, FSM, Tonga,
        // Tuvalu, Französisch-Polynesien usw. — und schliesst grössere Inseln
        // (Madagaskar, Sri Lanka, Island, Britannien) aus.
        if (maxPolyDim < 3) {
          const bounds = entry.layer.getBounds();
          const isOceania = entry.props && entry.props.CONTINENT === 'Oceania';
          addCountryDot(entry, bounds.getCenter(), isOceania ? 18 : 12);
        }
      } catch (e) { /* skip */ }
    });
  }
}


function maxPolygonDim(geometry) {
  if (!geometry || !geometry.coordinates) return Infinity;
  let max = 0;
  const check = (poly) => {
    if (!poly || !poly[0]) return;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    poly[0].forEach(([lng, lat]) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });
    const d = Math.max(maxLng - minLng, maxLat - minLat);
    if (d > max) max = d;
  };
  if (geometry.type === 'Polygon') check(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(check);
  return max;
}

function addCountryDot(entry, center, hitRadius) {
  const hit = L.circleMarker(center, {
    radius: hitRadius,
    fillColor: MAP_COLORS.dot,
    color: 'transparent',
    fillOpacity: 0.001,
    opacity: 0,
    weight: 0,
  }).addTo(map);

  const dot = L.circleMarker(center, { ...tinyDotStyle(), interactive: false }).addTo(map);

  hit.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    handleClick(entry);
  });
  hit.on('mouseover', () => {
    if (!quizState.active || dot._isHighlighted) return;
    dot.setStyle({ radius: 5 });
  });
  hit.on('mouseout', () => {
    if (!quizState.active || dot._isHighlighted) return;
    dot.setStyle(tinyDotStyle());
  });

  entry.dotMarkers.push(dot);
  entry.hitMarkers.push(hit);
  activeLayers.push(dot);
  activeLayers.push(hit);
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
    const continent = continentOf(lat, lng);
    const isCapital = !NON_CAPITAL_CITIES.has(name);
    const m = L.circleMarker([lat, lng], cityDefaultStyle()).addTo(map);
    const entry = { name, lat, lng, continent, isCapital, marker: m };
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
  return { radius: 4, fillColor: MAP_COLORS.dot, color: MAP_COLORS.dotBorder, weight: 1.2, opacity: 1, fillOpacity: 0.95 };
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
  const sizes = { ocean: 10, sea: 8, lake: 6, river: 5 };
  return {
    radius: sizes[type] || 5,
    fillColor: MAP_COLORS.dot,
    color: MAP_COLORS.dotBorder, weight: 1.2, opacity: 1, fillOpacity: 0.95,
  };
}

// ---- LANDMARKS ----
function renderLandmarks() {
  landmarkMarkers = [];
  LANDMARKS.forEach(([name, lat, lng]) => {
    const continent = continentOf(lat, lng);
    const m = L.circleMarker([lat, lng], landmarkDefaultStyle()).addTo(map);
    const entry = { name, lat, lng, continent, marker: m };
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
  return { radius: 5, fillColor: MAP_COLORS.dot, color: MAP_COLORS.dotBorder, weight: 1.2, opacity: 1, fillOpacity: 0.95 };
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
    const seen = new Set();
    pool = countryFeatures.filter(c => {
      if (!c.name || c.name === 'Unknown') return false;
      if (type === 'flaggen' && !c.iso2) return false;
      const key = c.iso2 || c.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } else if (type === 'staedte') {
    pool = cityMarkers.filter(c => !quizState.modeFilter || quizState.modeFilter(c));
  } else if (type === 'wasser') {
    pool = waterMarkers.filter(w => !quizState.modeFilter || quizState.modeFilter(w));
  } else if (type === 'sehenswuerdigkeiten') {
    pool = landmarkMarkers.filter(l => !quizState.modeFilter || quizState.modeFilter(l));
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
  if (!quizState.active || quizState.answering) return;
  const cur = quizState.current;
  if (!cur) return;

  const correct = (entry.iso2 && cur.iso2)
    ? entry.iso2 === cur.iso2
    : entry === cur;

  quizState.answering = true;

  if (correct) {
    quizState.correctCount++;
    quizState.correctKeys.add(entryKey(cur));
    quizState.wrongKeys.delete(entryKey(cur));
    highlightCorrect(cur);
  } else {
    quizState.wrongCount++;
    // Das verfehlte korrekte Land → bleibt rot (in Anzeigemodus)
    quizState.wrongKeys.add(entryKey(cur));
    quizState.correctKeys.delete(entryKey(cur));
    // Kurz rot auf fälschlich geklicktem Land (nicht persistent)
    highlightWrong(entry);
    // Korrektes Land hervorheben (rot — wird persistent via wrongKeys)
    highlightWrong(cur);
  }

  quizState.idx++;
  hideCursorTip();
  setTimeout(() => {
    quizState.answering = false;
    if (quizState.active) nextQuestion();
  }, 600);
}

// ---- HIGHLIGHTS ----
function applyHighlight(target, fill, border) {
  if (!target || !target.setStyle) return;
  if (target instanceof L.CircleMarker) {
    target.setStyle({ fillColor: fill, color: border, fillOpacity: 0.95, weight: 1.1 });
  } else {
    target.setStyle({ fillColor: fill, color: border, fillOpacity: 0.85, weight: 0.7 });
  }
  target._isHighlighted = true;
}

function entriesMatching(entry) {
  if (entry.iso2) return countryFeatures.filter(e => e.iso2 === entry.iso2);
  return [entry];
}

function highlightCorrect(entry) {
  entriesMatching(entry).forEach(e => {
    if (e.layer) applyHighlight(e.layer, MAP_COLORS.correct, MAP_COLORS.correctBorder);
    (e.dotMarkers || []).forEach(d => applyHighlight(d, MAP_COLORS.correct, MAP_COLORS.correctBorder));
    if (e.marker) applyHighlight(e.marker, MAP_COLORS.correct, MAP_COLORS.correctBorder);
  });
}

function highlightWrong(entry) {
  entriesMatching(entry).forEach(e => {
    if (e.layer) applyHighlight(e.layer, MAP_COLORS.wrong, MAP_COLORS.wrongBorder);
    (e.dotMarkers || []).forEach(d => applyHighlight(d, MAP_COLORS.wrong, MAP_COLORS.wrongBorder));
    if (e.marker) applyHighlight(e.marker, MAP_COLORS.wrong, MAP_COLORS.wrongBorder);
  });
}

function resetHighlights() {
  const keepGreen = (e) => quizState.showGuessed && quizState.correctKeys.has(entryKey(e));
  const keepRed   = (e) => quizState.showGuessed && quizState.wrongKeys.has(entryKey(e));

  countryFeatures.forEach(c => {
    if (keepGreen(c)) {
      if (c.layer) applyHighlight(c.layer, MAP_COLORS.correct, MAP_COLORS.correctBorder);
      (c.dotMarkers || []).forEach(d => applyHighlight(d, MAP_COLORS.correct, MAP_COLORS.correctBorder));
    } else if (keepRed(c)) {
      if (c.layer) applyHighlight(c.layer, MAP_COLORS.wrong, MAP_COLORS.wrongBorder);
      (c.dotMarkers || []).forEach(d => applyHighlight(d, MAP_COLORS.wrong, MAP_COLORS.wrongBorder));
    } else {
      if (c.layer) { c.layer.setStyle(countryDefaultStyle()); c.layer._isHighlighted = false; }
      (c.dotMarkers || []).forEach(d => { d.setStyle(tinyDotStyle()); d._isHighlighted = false; });
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

// ---- DIFF SCREEN ----
function populateDiffScreen(quizType) {
  pendingQuizType = quizType;
  document.getElementById('diffTitle').textContent = QUIZ_CONFIG[quizType].title;

  const worldCards = document.getElementById('worldModeCards');
  const continentList = document.getElementById('continentList');
  const continentSection = document.getElementById('continentSection');

  worldCards.innerHTML = '';
  continentList.innerHTML = '';

  if (quizType === 'laender' || quizType === 'flaggen') {
    worldCards.innerHTML = `
      <button class="diff-card" data-mode="world_easy">
        <div class="diff-badge diff-easy">Leicht</div>
        <h3>100 größte</h3>
        <p>Die größten Länder der Erde</p>
      </button>
      <button class="diff-card" data-mode="world_medium">
        <div class="diff-badge diff-medium">Mittel</div>
        <h3>196 anerkannte</h3>
        <p>UN-anerkannte Staaten</p>
      </button>
      <button class="diff-card" data-mode="world_hard">
        <div class="diff-badge diff-hard">Schwer</div>
        <h3>Alle Länder</h3>
        <p>Souveräne Staaten</p>
      </button>
      <button class="diff-card" data-mode="world_expert">
        <div class="diff-badge diff-expert">Sehr schwer</div>
        <h3>Alle 258</h3>
        <p>Länder + Territorien</p>
      </button>
    `;
    continentSection.style.display = '';
    populateContinentRows(continentList, 'laender');
  } else if (quizType === 'wasser') {
    worldCards.innerHTML = `
      <button class="diff-card" data-mode="world">
        <div class="diff-badge diff-medium">Welt</div>
        <h3>Alle Gewässer</h3>
        <p>Alle ${WATERS.length} Gewässer</p>
      </button>
      <button class="diff-card" data-mode="ozeane">
        <div class="diff-badge diff-easy">Ozeane</div>
        <h3>Ozeane & Meere</h3>
        <p>Die großen Gewässer</p>
      </button>
      <button class="diff-card" data-mode="seen">
        <div class="diff-badge diff-medium">Seen</div>
        <h3>Seen</h3>
        <p>Binnengewässer</p>
      </button>
      <button class="diff-card" data-mode="fluesse">
        <div class="diff-badge diff-hard">Flüsse</div>
        <h3>Flüsse</h3>
        <p>Die großen Ströme</p>
      </button>
    `;
    continentSection.style.display = 'none';
  } else if (quizType === 'staedte') {
    worldCards.innerHTML = `
      <button class="diff-card" data-mode="world">
        <div class="diff-badge diff-medium">Welt</div>
        <h3>Alle Städte</h3>
        <p>Alle ${CITIES.length} Städte</p>
      </button>
      <button class="diff-card" data-mode="world_h">
        <div class="diff-badge diff-easy">Hauptstädte</div>
        <h3>Hauptstädte</h3>
        <p>Nur Landeshauptstädte</p>
      </button>
    `;
    continentSection.style.display = '';
    populateContinentRows(continentList, 'staedte');
  } else {
    // sehenswuerdigkeiten
    worldCards.innerHTML = `
      <button class="diff-card" data-mode="world">
        <div class="diff-badge diff-medium">Welt</div>
        <h3>Alle Sehenswürdigkeiten</h3>
        <p>Alle ${LANDMARKS.length} Einträge</p>
      </button>
    `;
    continentSection.style.display = '';
    populateContinentRows(continentList, 'sehenswuerdigkeiten');
  }

  document.querySelectorAll('#diffScreen [data-mode]').forEach(btn => {
    btn.addEventListener('click', () => startWithMode(btn.dataset.mode));
  });
}

function populateContinentRows(continentList, kind) {
  Object.entries(CONTINENT_DE).forEach(([engName, deName]) => {
    const key = engName.toLowerCase().replace(' ', '');
    let btns;
    if (kind === 'laender') {
      btns = `<button class="cont-btn" data-mode="${key}_c">Länder</button>
              <button class="cont-btn" data-mode="${key}_t">+ Territorien</button>`;
    } else if (kind === 'staedte') {
      btns = `<button class="cont-btn" data-mode="${key}_c">Städte</button>
              <button class="cont-btn" data-mode="${key}_h">Hauptstädte</button>`;
    } else {
      btns = `<button class="cont-btn" data-mode="${key}_c">Spielen</button>`;
    }
    const row = document.createElement('div');
    row.className = 'continent-row';
    row.innerHTML = `
      <span class="cont-name">${deName}</span>
      <div class="cont-btns">${btns}</div>
    `;
    continentList.appendChild(row);
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
      openQuiz(btn.dataset.quiz);
    });
  });

  // Hub-Karten
  document.querySelectorAll('[data-go]').forEach(el => {
    el.addEventListener('click', () => {
      const go = el.dataset.go;
      if (go === 'geo') {
        showScreen('homeScreen');
      } else if (go === 'sektor') {
        showScreen('sektorScreen');
        if (typeof initSektor === 'function') initSektor();
      }
    });
  });

  setupScrollAnimations();
});

window.addEventListener('resize', () => {
  if (map && document.getElementById('quizScreen').classList.contains('active')) {
    setTimeout(() => {
      map.invalidateSize();
      if (quizState.modeBounds) map.fitBounds(quizState.modeBounds, { animate: false, ...getModePadding() });
    }, 50);
  }
});
