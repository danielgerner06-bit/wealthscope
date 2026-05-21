// ===========================================================================
// WealthScope — Quiz Engine
// ===========================================================================

// ---- STATE ----
let map = null;
let geoCountriesData = null;
let activeLayers = [];        // Layer references for cleanup
let countryFeatures = [];     // [{name, nameEn, iso2, layer, dotMarker}]
let cityMarkers = [];         // [{name, lat, lng, marker}]
let waterMarkers = [];        // [{name, type, lat, lng, marker}]

const quizState = {
  type: null,
  questions: [],
  idx: 0,
  score: 0,
  wrong: 0,
  active: false,
  current: null,
};

// ---- CONFIG ----
const QUIZ_CONFIG = {
  laender: {
    title: "Länderquiz",
    description: "Klicke das Land, das oben angezeigt wird. 20 zufällige Länder.",
    promptLabel: "Klicke das Land:",
    count: 20,
  },
  flaggen: {
    title: "Flaggenquiz",
    description: "Klicke das Land zur angezeigten Flagge. 20 Fragen.",
    promptLabel: "Klicke das Land:",
    count: 20,
  },
  staedte: {
    title: "Städtequiz",
    description: "Klicke die gefragte Stadt auf der Karte. 20 Städte.",
    promptLabel: "Klicke die Stadt:",
    count: 20,
  },
  wasser: {
    title: "Wasserquiz",
    description: "Klicke das gefragte Gewässer. 20 Meere, Seen und Flüsse.",
    promptLabel: "Klicke das Gewässer:",
    count: 20,
  },
};

const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ---- SCREEN NAV ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function openQuiz(quizType) {
  quizState.type = quizType;
  const cfg = QUIZ_CONFIG[quizType];

  document.getElementById('startTitle').textContent = cfg.title;
  document.getElementById('startDesc').textContent = cfg.description;
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
  clearMarkers();
  showScreen('homeScreen');
}

// ---- MAP ----
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
    maxZoom: 8,
    worldCopyJump: false,
  });
  map.setView([20, 0], 2);
  fitWorldBounds();
}

function fitWorldBounds() {
  if (!map) return;
  map.fitBounds([[-58, -170], [78, 180]], { animate: false, padding: [10, 10] });
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

  try {
    if (type === 'laender' || type === 'flaggen') {
      await renderCountries();
    } else if (type === 'staedte') {
      renderCities();
    } else if (type === 'wasser') {
      renderWaters();
    }
  } catch (e) {
    return;
  }

  fitWorldBounds();
  buildQuestions(type);

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

// ---- RENDER: COUNTRIES ----
async function renderCountries() {
  const data = await ensureCountriesLoaded();
  countryFeatures = [];

  const layer = L.geoJSON(data, {
    style: () => countryDefaultStyle(),
    onEachFeature: (feature, lyr) => {
      const props = feature.properties || {};
      const nameEn = props.NAME_LONG || props.NAME || 'Unknown';
      const nameDe = DE_NAME_OVERRIDES[nameEn] || props.NAME_DE || nameEn;

      const iso2raw = props.ISO_A2_EH || props.ISO_A2 || '';
      const iso2 = (iso2raw && iso2raw !== '-99' && iso2raw.length === 2) ? iso2raw.toLowerCase() : '';

      const entry = { name: nameDe, nameEn, iso2, layer: lyr, dotMarker: null };
      countryFeatures.push(entry);

      lyr.on('click', () => handleClick(entry));
      lyr.on('mouseover', () => {
        if (!quizState.active || lyr._isHighlighted) return;
        lyr.setStyle({ fillColor: '#3a4364', fillOpacity: 0.7 });
      });
      lyr.on('mouseout', () => {
        if (!quizState.active || lyr._isHighlighted) return;
        lyr.setStyle(countryDefaultStyle());
      });
    },
  });
  layer.addTo(map);
  activeLayers.push(layer);

  // Add dots for tiny countries (Vatican, Monaco, Singapore, etc.)
  countryFeatures.forEach(entry => {
    try {
      const bounds = entry.layer.getBounds();
      const w = bounds.getEast() - bounds.getWest();
      const h = bounds.getNorth() - bounds.getSouth();
      if (Math.max(w, h) < 1.2) {
        const center = bounds.getCenter();
        const dot = L.circleMarker(center, {
          radius: 5,
          fillColor: '#818cf8',
          color: '#fff',
          weight: 2,
          opacity: 0.95,
          fillOpacity: 0.9,
        }).addTo(map);
        dot.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          handleClick(entry);
        });
        dot.on('mouseover', () => {
          if (!quizState.active) return;
          dot.setStyle({ radius: 7 });
        });
        dot.on('mouseout', () => {
          if (!quizState.active || dot._isHighlighted) return;
          dot.setStyle({ radius: 5 });
        });
        entry.dotMarker = dot;
        activeLayers.push(dot);
      }
    } catch (e) { /* skip */ }
  });
}

function countryDefaultStyle() {
  return {
    fillColor: '#1c2238',
    color: '#3a4364',
    weight: 0.6,
    fillOpacity: 0.95,
  };
}

// ---- RENDER: CITIES ----
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
      m.setStyle({ radius: 8, fillOpacity: 1 });
    });
    m.on('mouseout', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle(cityDefaultStyle());
    });
  });
}

function cityDefaultStyle() {
  return {
    radius: 5,
    fillColor: '#cbd5e1',
    color: '#fff',
    weight: 1.5,
    opacity: 0.85,
    fillOpacity: 0.75,
  };
}

// ---- RENDER: WATERS ----
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
      m.setStyle({ ...s, radius: s.radius + 3, fillOpacity: 0.9 });
    });
    m.on('mouseout', () => {
      if (!quizState.active || m._isHighlighted) return;
      m.setStyle(waterDefaultStyle(type));
    });
  });
}

function waterDefaultStyle(type) {
  const colors = { ocean: '#0ea5e9', sea: '#22d3ee', lake: '#06b6d4', river: '#0891b2' };
  const sizes  = { ocean: 11, sea: 9, lake: 7, river: 6 };
  return {
    radius: sizes[type],
    fillColor: colors[type],
    color: '#fff',
    weight: 1.5,
    opacity: 0.85,
    fillOpacity: 0.65,
  };
}

// ---- CLEANUP ----
function clearMarkers() {
  if (!map) return;
  activeLayers.forEach(l => {
    try { map.removeLayer(l); } catch (e) { /* ignore */ }
  });
  activeLayers = [];
  countryFeatures = [];
  cityMarkers = [];
  waterMarkers = [];
}

// ---- QUESTIONS ----
function buildQuestions(type) {
  let pool = [];
  if (type === 'laender') {
    pool = countryFeatures.filter(c => c.name && c.name !== 'Unknown');
  } else if (type === 'flaggen') {
    pool = countryFeatures.filter(c => c.iso2 && c.name && c.name !== 'Unknown');
  } else if (type === 'staedte') {
    pool = [...cityMarkers];
  } else if (type === 'wasser') {
    pool = [...waterMarkers];
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
  setTimeout(() => {
    if (quizState.active) nextQuestion();
  }, 1100);
}

// ---- HIGHLIGHTS ----
function highlightCorrect(entry) {
  if (entry.layer) {
    entry.layer.setStyle({ fillColor: '#10b981', fillOpacity: 0.8, color: '#34d399', weight: 1.5 });
    entry.layer._isHighlighted = true;
  }
  if (entry.dotMarker) {
    entry.dotMarker.setStyle({ fillColor: '#10b981', color: '#34d399', radius: 7 });
    entry.dotMarker._isHighlighted = true;
  }
  if (entry.marker) {
    entry.marker.setStyle({ fillColor: '#10b981', color: '#34d399', radius: 10, fillOpacity: 0.95 });
    entry.marker._isHighlighted = true;
  }
}

function highlightWrong(entry) {
  if (entry.layer) {
    entry.layer.setStyle({ fillColor: '#ef4444', fillOpacity: 0.8, color: '#f87171', weight: 1.5 });
    entry.layer._isHighlighted = true;
  }
  if (entry.dotMarker) {
    entry.dotMarker.setStyle({ fillColor: '#ef4444', color: '#f87171', radius: 7 });
    entry.dotMarker._isHighlighted = true;
  }
  if (entry.marker) {
    entry.marker.setStyle({ fillColor: '#ef4444', color: '#f87171', radius: 10, fillOpacity: 0.95 });
    entry.marker._isHighlighted = true;
  }
}

function resetHighlights() {
  countryFeatures.forEach(c => {
    if (c.layer) {
      c.layer.setStyle(countryDefaultStyle());
      c.layer._isHighlighted = false;
    }
    if (c.dotMarker) {
      c.dotMarker.setStyle({ radius: 5, fillColor: '#818cf8', color: '#fff', weight: 2, fillOpacity: 0.9 });
      c.dotMarker._isHighlighted = false;
    }
  });
  cityMarkers.forEach(c => {
    c.marker.setStyle(cityDefaultStyle());
    c.marker._isHighlighted = false;
  });
  waterMarkers.forEach(w => {
    w.marker.setStyle(waterDefaultStyle(w.type));
    w.marker._isHighlighted = false;
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

// ---- EVENT WIRING ----
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => openQuiz(card.dataset.quiz));
  });
});

window.addEventListener('resize', () => {
  if (map && document.getElementById('quizScreen').classList.contains('active')) {
    setTimeout(() => {
      map.invalidateSize();
      fitWorldBounds();
    }, 50);
  }
});
