// === NAVIGATION ===
function toggleMenu() {
  const menu = document.getElementById('mobileMenu');
  menu.classList.toggle('open');
}

// === QUIZ DATA ===
const allCountries = [
  { flag: "🇩🇪", name: "Deutschland", capital: "Berlin", options: ["München", "Hamburg", "Frankfurt", "Berlin"] },
  { flag: "🇫🇷", name: "Frankreich", capital: "Paris", options: ["Lyon", "Marseille", "Bordeaux", "Paris"] },
  { flag: "🇪🇸", name: "Spanien", capital: "Madrid", options: ["Barcelona", "Sevilla", "Valencia", "Madrid"] },
  { flag: "🇮🇹", name: "Italien", capital: "Rom", options: ["Mailand", "Neapel", "Turin", "Rom"] },
  { flag: "🇵🇹", name: "Portugal", capital: "Lissabon", options: ["Porto", "Braga", "Faro", "Lissabon"] },
  { flag: "🇳🇱", name: "Niederlande", capital: "Amsterdam", options: ["Rotterdam", "Den Haag", "Utrecht", "Amsterdam"] },
  { flag: "🇧🇪", name: "Belgien", capital: "Brüssel", options: ["Antwerpen", "Gent", "Brügge", "Brüssel"] },
  { flag: "🇨🇭", name: "Schweiz", capital: "Bern", options: ["Zürich", "Genf", "Basel", "Bern"] },
  { flag: "🇦🇹", name: "Österreich", capital: "Wien", options: ["Graz", "Salzburg", "Innsbruck", "Wien"] },
  { flag: "🇸🇪", name: "Schweden", capital: "Stockholm", options: ["Göteborg", "Malmö", "Uppsala", "Stockholm"] },
  { flag: "🇳🇴", name: "Norwegen", capital: "Oslo", options: ["Bergen", "Trondheim", "Stavanger", "Oslo"] },
  { flag: "🇩🇰", name: "Dänemark", capital: "Kopenhagen", options: ["Aarhus", "Odense", "Aalborg", "Kopenhagen"] },
  { flag: "🇫🇮", name: "Finnland", capital: "Helsinki", options: ["Tampere", "Turku", "Espoo", "Helsinki"] },
  { flag: "🇵🇱", name: "Polen", capital: "Warschau", options: ["Krakau", "Łódź", "Breslau", "Warschau"] },
  { flag: "🇨🇿", name: "Tschechien", capital: "Prag", options: ["Brünn", "Ostrava", "Pilsen", "Prag"] },
  { flag: "🇭🇺", name: "Ungarn", capital: "Budapest", options: ["Debrecen", "Miskolc", "Pécs", "Budapest"] },
  { flag: "🇬🇷", name: "Griechenland", capital: "Athen", options: ["Thessaloniki", "Patras", "Heraklion", "Athen"] },
  { flag: "🇷🇴", name: "Rumänien", capital: "Bukarest", options: ["Cluj-Napoca", "Timișoara", "Iași", "Bukarest"] },
  { flag: "🇧🇬", name: "Bulgarien", capital: "Sofia", options: ["Plovdiv", "Varna", "Burgas", "Sofia"] },
  { flag: "🇺🇸", name: "USA", capital: "Washington D.C.", options: ["New York", "Los Angeles", "Chicago", "Washington D.C."] },
  { flag: "🇨🇦", name: "Kanada", capital: "Ottawa", options: ["Toronto", "Vancouver", "Montreal", "Ottawa"] },
  { flag: "🇲🇽", name: "Mexiko", capital: "Mexiko-Stadt", options: ["Guadalajara", "Monterrey", "Puebla", "Mexiko-Stadt"] },
  { flag: "🇧🇷", name: "Brasilien", capital: "Brasília", options: ["São Paulo", "Rio de Janeiro", "Salvador", "Brasília"] },
  { flag: "🇦🇷", name: "Argentinien", capital: "Buenos Aires", options: ["Córdoba", "Rosario", "Mendoza", "Buenos Aires"] },
  { flag: "🇯🇵", name: "Japan", capital: "Tokio", options: ["Osaka", "Kyoto", "Hiroshima", "Tokio"] },
  { flag: "🇨🇳", name: "China", capital: "Peking", options: ["Shanghai", "Guangzhou", "Chengdu", "Peking"] },
  { flag: "🇰🇷", name: "Südkorea", capital: "Seoul", options: ["Busan", "Incheon", "Daegu", "Seoul"] },
  { flag: "🇮🇳", name: "Indien", capital: "Neu-Delhi", options: ["Mumbai", "Kolkata", "Bangalore", "Neu-Delhi"] },
  { flag: "🇦🇺", name: "Australien", capital: "Canberra", options: ["Sydney", "Melbourne", "Brisbane", "Canberra"] },
  { flag: "🇿🇦", name: "Südafrika", capital: "Pretoria", options: ["Johannesburg", "Kapstadt", "Durban", "Pretoria"] },
  { flag: "🇪🇬", name: "Ägypten", capital: "Kairo", options: ["Alexandria", "Gizeh", "Luxor", "Kairo"] },
  { flag: "🇳🇬", name: "Nigeria", capital: "Abuja", options: ["Lagos", "Kano", "Ibadan", "Abuja"] },
  { flag: "🇹🇷", name: "Türkei", capital: "Ankara", options: ["Istanbul", "Izmir", "Bursa", "Ankara"] },
  { flag: "🇸🇦", name: "Saudi-Arabien", capital: "Riad", options: ["Dschidda", "Mekka", "Medina", "Riad"] },
  { flag: "🇷🇺", name: "Russland", capital: "Moskau", options: ["Sankt Petersburg", "Nowosibirsk", "Jekaterinburg", "Moskau"] },
];

// === QUIZ STATE ===
let questions = [];
let currentIndex = 0;
let score = 0;
let correctAnswers = 0;
let answered = false;

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function startQuiz() {
  questions = shuffle(allCountries).slice(0, 20);
  currentIndex = 0;
  score = 0;
  correctAnswers = 0;

  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('questionScreen').classList.remove('hidden');

  showQuestion();
}

function showQuestion() {
  answered = false;
  const q = questions[currentIndex];
  const progress = ((currentIndex) / 20) * 100;

  document.getElementById('currentQ').textContent = currentIndex + 1;
  document.getElementById('progressFill').style.width = progress + '%';
  document.getElementById('scoreDisplay').textContent = score;
  document.getElementById('flagDisplay').textContent = q.flag;
  document.getElementById('questionText').textContent = `Was ist die Hauptstadt von ${q.name}?`;

  const shuffledOptions = shuffle(q.options);
  const grid = document.getElementById('optionsGrid');
  grid.innerHTML = '';

  shuffledOptions.forEach(option => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = option;
    btn.onclick = () => selectAnswer(btn, option, q.capital);
    grid.appendChild(btn);
  });
}

function selectAnswer(btn, selected, correct) {
  if (answered) return;
  answered = true;

  const allBtns = document.querySelectorAll('.option-btn');
  allBtns.forEach(b => b.disabled = true);

  if (selected === correct) {
    btn.classList.add('correct');
    score++;
    correctAnswers++;
  } else {
    btn.classList.add('wrong');
    allBtns.forEach(b => {
      if (b.textContent === correct) b.classList.add('correct');
    });
  }

  document.getElementById('scoreDisplay').textContent = score;

  setTimeout(() => {
    currentIndex++;
    if (currentIndex < 20) {
      showQuestion();
    } else {
      showResult();
    }
  }, 1200);
}

function showResult() {
  document.getElementById('questionScreen').classList.add('hidden');
  document.getElementById('resultScreen').classList.remove('hidden');

  const percent = Math.round((correctAnswers / 20) * 100);
  document.getElementById('finalScore').textContent = score;
  document.getElementById('correctCount').textContent = correctAnswers;
  document.getElementById('wrongCount').textContent = 20 - correctAnswers;
  document.getElementById('accuracyDisplay').textContent = percent + '%';
  document.getElementById('progressFill').style.width = '100%';

  let icon, title, message;
  if (percent >= 90) {
    icon = '🏆'; title = 'Weltklasse!'; message = 'Beeindruckend — du kennst die Welt wie deine Westentasche!';
  } else if (percent >= 70) {
    icon = '🌟'; title = 'Sehr gut!'; message = 'Du kennst dich super aus. Nur noch ein paar Details!';
  } else if (percent >= 50) {
    icon = '👍'; title = 'Gut gemacht!'; message = 'Solides Ergebnis! Mit etwas Übung wird\'s noch besser.';
  } else {
    icon = '📚'; title = 'Weiter üben!'; message = 'Kein Problem — das Wissen kommt mit der Zeit. Probier es nochmal!';
  }

  document.getElementById('resultIcon').textContent = icon;
  document.getElementById('resultTitle').textContent = title;
  document.getElementById('resultMessage').textContent = message;
}

function restartQuiz() {
  document.getElementById('resultScreen').classList.add('hidden');
  document.getElementById('startScreen').classList.remove('hidden');
}
