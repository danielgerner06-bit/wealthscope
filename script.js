// === QUIZ CONFIGURATION ===
const quizConfig = {
  laender:  { title: "Länderquiz",  icon: "🌍", description: "Klicke auf die Länder, die gefragt werden." },
  flaggen:  { title: "Flaggenquiz", icon: "🚩", description: "Ordne Flaggen den richtigen Ländern zu." },
  staedte:  { title: "Städtequiz",  icon: "🏙️", description: "Finde die gefragten Städte auf der Karte." },
  wasser:   { title: "Wasserquiz",  icon: "💧", description: "Erkenne Meere, Flüsse und Seen weltweit." },
};

let currentQuiz = null;
let map = null;

// === SCREEN NAVIGATION ===
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  window.scrollTo(0, 0);
}

function openQuiz(quizKey) {
  currentQuiz = quizKey;
  const config = quizConfig[quizKey];

  document.getElementById('quizTitle').textContent = config.title;
  document.getElementById('overlayIcon').textContent = config.icon;
  document.getElementById('overlayTitle').textContent = config.title;
  document.getElementById('overlayText').textContent = config.description;

  // Reset overlay visibility
  document.getElementById('mapOverlay').classList.remove('hidden');
  document.getElementById('quizPanel').style.display = 'none';

  showScreen('quizScreen');

  // Initialize or refresh map after screen shows
  setTimeout(initMap, 100);
}

function goHome() {
  showScreen('homeScreen');
  currentQuiz = null;
}

function startQuiz() {
  document.getElementById('mapOverlay').classList.add('hidden');
  // Quiz logic will be added later per quiz type
  document.getElementById('quizPanel').style.display = 'block';
}

// === MAP INIT ===
function initMap() {
  if (map) {
    map.invalidateSize();
    map.setView([20, 10], 2);
    return;
  }

  map = L.map('map', {
    center: [20, 10],
    zoom: 2,
    minZoom: 2,
    maxZoom: 6,
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true,
  });

  // Dark-themed tile layer (CartoDB Dark Matter — free, no API key needed)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);
}

// === EVENT LISTENERS ===
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.quiz-card').forEach(card => {
    card.addEventListener('click', () => {
      const quizKey = card.dataset.quiz;
      openQuiz(quizKey);
    });
  });
});
