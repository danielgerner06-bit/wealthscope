// ===========================================================================
// WealthScope — Quiz Data
// ===========================================================================

// === LÄNDER-DATENQUELLE ===
const COUNTRY_GEOJSON_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_admin_0_countries.geojson';

// === Deutsche Namen-Overrides (für Fälle, wo NAME_DE veraltet / fehlt) ===
const DE_NAME_OVERRIDES = {
  "United States of America": "Vereinigte Staaten",
  "United Kingdom": "Vereinigtes Königreich",
  "Czechia": "Tschechien",
  "Türkiye": "Türkei",
  "Republic of Serbia": "Serbien",
  "Côte d'Ivoire": "Elfenbeinküste",
  "Federated States of Micronesia": "Mikronesien",
  "Saint Vincent and the Grenadines": "St. Vincent und die Grenadinen",
  "Saint Kitts and Nevis": "St. Kitts und Nevis",
  "Saint Lucia": "St. Lucia",
  "Antigua and Barbuda": "Antigua und Barbuda",
  "Trinidad and Tobago": "Trinidad und Tobago",
  "São Tomé and Principe": "São Tomé und Príncipe",
  "Republic of the Congo": "Republik Kongo",
  "Democratic Republic of the Congo": "DR Kongo",
  "Equatorial Guinea": "Äquatorialguinea",
  "Solomon Islands": "Salomonen",
  "Marshall Islands": "Marshallinseln",
  "Papua New Guinea": "Papua-Neuguinea",
  "New Zealand": "Neuseeland",
};

// === TOP 100 LÄNDER NACH FLÄCHE (ISO_A2) ===
const TOP_100_AREA = new Set([
  "RU","CA","US","CN","BR","AU","IN","AR","KZ","DZ",
  "CD","SA","MX","ID","SD","LY","IR","MN","PE","TD",
  "NE","AO","ML","ZA","CO","ET","BO","MR","EG","TZ",
  "NG","VE","NA","MZ","PK","TR","CL","ZM","MM","AF",
  "SO","CF","UA","MG","BW","KE","FR","YE","TH","ES",
  "TM","CM","PG","SE","UZ","MA","IQ","PY","ZW","JP",
  "DE","CG","FI","VN","MY","NO","CI","PL","OM","IT",
  "PH","EC","BF","NZ","GA","EH","GN","GB","UG","GH",
  "RO","LA","GY","BY","KG","SN","SY","KH","UY","SR",
  "TN","BD","NP","TJ","GR","NI","KP","MW","ER","BJ"
]);

// === 196 ANERKANNTE LÄNDER (193 UN-Mitglieder + Vatikan + Palästina + Taiwan) ===
const RECOGNIZED_196 = new Set([
  "AF","AL","DZ","AD","AO","AG","AR","AM","AU","AT",
  "AZ","BS","BH","BD","BB","BY","BE","BZ","BJ","BT",
  "BO","BA","BW","BR","BN","BG","BF","BI","CV","KH",
  "CM","CA","CF","TD","CL","CN","CO","KM","CG","CD",
  "CR","CI","HR","CU","CY","CZ","DK","DJ","DM","DO",
  "EC","EG","SV","GQ","ER","EE","SZ","ET","FJ","FI",
  "FR","GA","GM","GE","DE","GH","GR","GD","GT","GN",
  "GW","GY","HT","HN","HU","IS","IN","ID","IR","IQ",
  "IE","IL","IT","JM","JP","JO","KZ","KE","KI","KP",
  "KR","KW","KG","LA","LV","LB","LS","LR","LY","LI",
  "LT","LU","MG","MW","MY","MV","ML","MT","MH","MR",
  "MU","MX","FM","MD","MC","MN","ME","MA","MZ","MM",
  "NA","NR","NP","NL","NZ","NI","NE","NG","MK","NO",
  "OM","PK","PW","PA","PG","PY","PE","PH","PL","PT",
  "QA","RO","RU","RW","KN","LC","VC","WS","SM","ST",
  "SA","SN","RS","SC","SL","SG","SK","SI","SB","SO",
  "ZA","SS","ES","LK","SD","SR","SE","CH","SY","TJ",
  "TZ","TH","TL","TG","TO","TT","TN","TR","TM","TV",
  "UG","UA","AE","GB","US","UY","UZ","VU","VE","VN",
  "YE","ZM","ZW","VA","PS","TW"
]);

// === KONTINENT-BOUNDS und deutsche Namen ===
const CONTINENT_BOUNDS = {
  'Europe':        [[34, -12], [72, 45]],
  'Asia':          [[-12, 25], [78, 180]],
  'Africa':        [[-37, -20], [38, 55]],
  'North America': [[7, -170], [83, -50]],
  'South America': [[-58, -85], [13, -34]],
  'Oceania':       [[-50, 110], [5, 220]],
};

const CONTINENT_DE = {
  'Europe':        'Europa',
  'Asia':          'Asien',
  'Africa':        'Afrika',
  'North America': 'Nordamerika',
  'South America': 'Südamerika',
  'Oceania':       'Ozeanien',
};

const WORLD_BOUNDS = [[-58, -160], [78, 215]];

// === REGION-BOUNDS für Wheel-Zoom ===
const REGION_BOUNDS = {
  'Ozeanien':       [[-50, 110], [5, 220]],
  'Zentralamerika': [[5, -120], [33, -55]],
  'Europa':         [[34, -25], [72, 45]],
  'Afrika':         [[-37, -20], [38, 55]],
  'Südamerika':     [[-58, -85], [13, -34]],
  'Nordamerika':    [[14, -170], [78, -10]],
  'Asien':          [[-12, 25], [78, 180]],
};

// Reihenfolge: spezifischere/küstennahe Regionen zuerst
const REGION_ORDER = ['Ozeanien', 'Zentralamerika', 'Europa', 'Afrika', 'Südamerika', 'Nordamerika', 'Asien'];

// === STÄDTE ===
const CITIES = [
  // Europa
  ["Berlin", 52.520, 13.405], ["Hamburg", 53.551, 9.993], ["München", 48.137, 11.575],
  ["Paris", 48.857, 2.351], ["London", 51.507, -0.128], ["Madrid", 40.417, -3.704],
  ["Barcelona", 41.385, 2.173], ["Rom", 41.903, 12.496], ["Mailand", 45.464, 9.190],
  ["Wien", 48.209, 16.373], ["Bern", 46.948, 7.447], ["Zürich", 47.377, 8.541],
  ["Amsterdam", 52.370, 4.896], ["Brüssel", 50.851, 4.351], ["Lissabon", 38.722, -9.139],
  ["Kopenhagen", 55.676, 12.568], ["Stockholm", 59.329, 18.069], ["Oslo", 59.913, 10.752],
  ["Helsinki", 60.169, 24.938], ["Reykjavik", 64.146, -21.942], ["Dublin", 53.350, -6.260],
  ["Warschau", 52.230, 21.012], ["Prag", 50.075, 14.437], ["Budapest", 47.498, 19.040],
  ["Bukarest", 44.426, 26.103], ["Sofia", 42.698, 23.319], ["Athen", 37.984, 23.728],
  ["Belgrad", 44.787, 20.457], ["Zagreb", 45.815, 15.982], ["Sarajevo", 43.857, 18.413],
  ["Skopje", 41.998, 21.426], ["Tirana", 41.328, 19.819], ["Podgorica", 42.444, 19.260],
  ["Ljubljana", 46.056, 14.506], ["Bratislava", 48.146, 17.107], ["Vilnius", 54.687, 25.280],
  ["Riga", 56.950, 24.106], ["Tallinn", 59.437, 24.754], ["Minsk", 53.902, 27.560],
  ["Kiew", 50.450, 30.524], ["Chisinau", 47.011, 28.864], ["Moskau", 55.756, 37.617],
  ["Sankt Petersburg", 59.934, 30.336], ["Istanbul", 41.008, 28.978], ["Ankara", 39.933, 32.860],
  ["Luxemburg", 49.612, 6.130], ["Monaco", 43.738, 7.424], ["Valletta", 35.899, 14.515],
  ["Vatikanstadt", 41.903, 12.453], ["Andorra la Vella", 42.506, 1.521],

  // Asien
  ["Tokio", 35.689, 139.692], ["Osaka", 34.694, 135.502], ["Peking", 39.904, 116.407],
  ["Shanghai", 31.230, 121.474], ["Hongkong", 22.319, 114.169], ["Taipeh", 25.033, 121.565],
  ["Seoul", 37.566, 126.978], ["Pjöngjang", 39.039, 125.762], ["Singapur", 1.352, 103.820],
  ["Bangkok", 13.756, 100.502], ["Hanoi", 21.028, 105.854], ["Jakarta", -6.208, 106.846],
  ["Manila", 14.599, 120.984], ["Kuala Lumpur", 3.139, 101.687], ["Neu-Delhi", 28.614, 77.209],
  ["Mumbai", 19.076, 72.878], ["Kolkata", 22.573, 88.364], ["Karatschi", 24.861, 67.010],
  ["Islamabad", 33.684, 73.048], ["Dhaka", 23.811, 90.413], ["Colombo", 6.927, 79.862],
  ["Kathmandu", 27.717, 85.324], ["Thimphu", 27.472, 89.640], ["Naypyidaw", 19.764, 96.078],
  ["Phnom Penh", 11.563, 104.916], ["Vientiane", 17.975, 102.633], ["Ulaanbaatar", 47.886, 106.906],
  ["Taschkent", 41.299, 69.240], ["Astana", 51.169, 71.449], ["Bischkek", 42.874, 74.570],
  ["Aşgabat", 37.960, 58.326], ["Duschanbe", 38.560, 68.787], ["Kabul", 34.555, 69.207],
  ["Teheran", 35.689, 51.389], ["Bagdad", 33.312, 44.361], ["Damaskus", 33.513, 36.292],
  ["Beirut", 33.894, 35.503], ["Amman", 31.945, 35.928], ["Riad", 24.713, 46.675],
  ["Doha", 25.286, 51.534], ["Abu Dhabi", 24.453, 54.377], ["Dubai", 25.205, 55.270],
  ["Maskat", 23.586, 58.405], ["Sanaa", 15.369, 44.191], ["Jerusalem", 31.769, 35.213],
  ["Baku", 40.409, 49.867], ["Tiflis", 41.715, 44.827], ["Eriwan", 40.179, 44.499],

  // Afrika
  ["Kairo", 30.044, 31.236], ["Lagos", 6.524, 3.379], ["Kinshasa", -4.442, 15.266],
  ["Nairobi", -1.292, 36.822], ["Johannesburg", -26.204, 28.047], ["Kapstadt", -33.918, 18.423],
  ["Pretoria", -25.747, 28.229], ["Algier", 36.737, 3.087], ["Casablanca", 33.573, -7.590],
  ["Rabat", 34.020, -6.842], ["Tunis", 36.806, 10.181], ["Tripolis", 32.887, 13.191],
  ["Khartum", 15.501, 32.559], ["Addis Abeba", 9.030, 38.741], ["Mogadischu", 2.046, 45.318],
  ["Asmara", 15.322, 38.925], ["Accra", 5.604, -0.187], ["Abidjan", 5.345, -4.024],
  ["Dakar", 14.717, -17.467], ["Bamako", 12.640, -8.000], ["Niamey", 13.512, 2.112],
  ["N'Djamena", 12.114, 15.049], ["Yaoundé", 3.848, 11.502], ["Bangui", 4.395, 18.557],
  ["Brazzaville", -4.263, 15.243], ["Luanda", -8.839, 13.234], ["Windhuk", -22.560, 17.083],
  ["Gaborone", -24.628, 25.923], ["Harare", -17.829, 31.053], ["Lusaka", -15.387, 28.323],
  ["Maputo", -25.969, 32.573], ["Antananarivo", -18.879, 47.508], ["Port Louis", -20.166, 57.502],
  ["Kampala", 0.347, 32.583], ["Kigali", -1.944, 30.062], ["Bujumbura", -3.361, 29.359],
  ["Daressalam", -6.792, 39.208], ["Lomé", 6.137, 1.213], ["Cotonou", 6.366, 2.434],
  ["Ouagadougou", 12.371, -1.520], ["Freetown", 8.484, -13.234], ["Monrovia", 6.300, -10.797],
  ["Bissau", 11.881, -15.598], ["Conakry", 9.510, -13.712],

  // Nord-/Mittelamerika
  ["Washington", 38.907, -77.037], ["New York", 40.713, -74.006], ["Los Angeles", 34.052, -118.244],
  ["Chicago", 41.878, -87.630], ["Houston", 29.760, -95.370], ["Toronto", 43.651, -79.347],
  ["Ottawa", 45.421, -75.697], ["Vancouver", 49.282, -123.121], ["Montreal", 45.502, -73.567],
  ["Mexiko-Stadt", 19.433, -99.133], ["Guatemala-Stadt", 14.634, -90.506], ["San Salvador", 13.692, -89.218],
  ["Tegucigalpa", 14.072, -87.192], ["Managua", 12.115, -86.236], ["San José", 9.928, -84.091],
  ["Panama-Stadt", 8.984, -79.518], ["Havanna", 23.114, -82.366], ["Kingston", 17.971, -76.793],
  ["Santo Domingo", 18.486, -69.931], ["Port-au-Prince", 18.594, -72.307], ["Nassau", 25.078, -77.339],

  // Südamerika
  ["Brasília", -15.794, -47.882], ["São Paulo", -23.551, -46.633], ["Rio de Janeiro", -22.907, -43.173],
  ["Buenos Aires", -34.604, -58.382], ["Santiago", -33.449, -70.669], ["Lima", -12.046, -77.043],
  ["Bogotá", 4.711, -74.072], ["Caracas", 10.481, -66.904], ["Quito", -0.180, -78.468],
  ["La Paz", -16.500, -68.150], ["Sucre", -19.034, -65.260], ["Asunción", -25.264, -57.576],
  ["Montevideo", -34.901, -56.165], ["Georgetown", 6.802, -58.167], ["Paramaribo", 5.852, -55.204],
  ["Cayenne", 4.933, -52.333],

  // Ozeanien
  ["Canberra", -35.281, 149.128], ["Sydney", -33.869, 151.209], ["Melbourne", -37.814, 144.963],
  ["Brisbane", -27.470, 153.026], ["Perth", -31.953, 115.857], ["Auckland", -36.848, 174.763],
  ["Wellington", -41.286, 174.776], ["Suva", -18.124, 178.450], ["Port Moresby", -9.443, 147.180],
  ["Honiara", -9.432, 159.955], ["Apia", -13.836, -171.770], ["Nukuʻalofa", -21.139, -175.205],
  ["Funafuti", -8.524, 179.194], ["Yaren", -0.547, 166.921],
];

// === GEWÄSSER ===
const WATERS = [
  // Ozeane
  ["Pazifik", 0, -150, "ocean"], ["Atlantik", 0, -30, "ocean"],
  ["Indischer Ozean", -20, 75, "ocean"], ["Arktischer Ozean", 85, 0, "ocean"],
  ["Südpolarmeer", -65, 0, "ocean"],

  // Meere & Golfe
  ["Mittelmeer", 35.5, 18, "sea"], ["Schwarzes Meer", 43.5, 34, "sea"],
  ["Rotes Meer", 20, 38, "sea"], ["Ostsee", 58, 20, "sea"],
  ["Nordsee", 56, 3, "sea"], ["Karibisches Meer", 15, -75, "sea"],
  ["Arabisches Meer", 15, 65, "sea"], ["Golf von Bengalen", 14, 88, "sea"],
  ["Südchinesisches Meer", 13, 115, "sea"], ["Ostchinesisches Meer", 29, 125, "sea"],
  ["Japanisches Meer", 40, 134, "sea"], ["Beringmeer", 58, -178, "sea"],
  ["Ochotskisches Meer", 55, 150, "sea"], ["Golf von Mexiko", 25, -90, "sea"],
  ["Hudson Bay", 60, -85, "sea"], ["Persischer Golf", 27, 51, "sea"],
  ["Korallenmeer", -18, 152, "sea"], ["Tasmansee", -40, 160, "sea"],
  ["Kaspisches Meer", 42, 51, "sea"], ["Adriatisches Meer", 43, 16, "sea"],
  ["Ägäisches Meer", 39, 25, "sea"], ["Karasee", 75, 65, "sea"],

  // Seen
  ["Oberer See", 47.7, -88, "lake"], ["Huronsee", 45, -82.4, "lake"],
  ["Michigansee", 44, -87, "lake"], ["Eriesee", 42.2, -81, "lake"],
  ["Ontariosee", 43.7, -77.9, "lake"], ["Großer Bärensee", 65.9, -120.6, "lake"],
  ["Großer Sklavensee", 61.7, -114, "lake"], ["Viktoriasee", -1, 33, "lake"],
  ["Tanganjikasee", -6, 29.5, "lake"], ["Malawisee", -12, 34.5, "lake"],
  ["Tschadsee", 13, 14, "lake"], ["Bajkalsee", 53.5, 108, "lake"],
  ["Ladogasee", 60.8, 31.5, "lake"], ["Onegasee", 61.7, 35.4, "lake"],
  ["Aralsee", 45, 60, "lake"], ["Bodensee", 47.6, 9.4, "lake"],
  ["Genfersee", 46.4, 6.5, "lake"], ["Vänern", 58.9, 13.3, "lake"],
  ["Titicacasee", -15.8, -69.3, "lake"],

  // Flüsse
  ["Nil", 17, 32, "river"], ["Amazonas", -3, -60, "river"],
  ["Jangtsekiang", 30, 112, "river"], ["Mississippi", 36, -91, "river"],
  ["Jenissei", 65, 86, "river"], ["Gelber Fluss", 35, 110, "river"],
  ["Ob", 62, 70, "river"], ["Paraná", -27, -57, "river"],
  ["Kongo", -2, 22, "river"], ["Amur", 50, 130, "river"],
  ["Lena", 65, 125, "river"], ["Mekong", 18, 104, "river"],
  ["Niger", 13, 0, "river"], ["Murray", -35, 144, "river"],
  ["Ganges", 25, 85, "river"], ["Donau", 45, 22, "river"],
  ["Rhein", 50, 7.5, "river"], ["Wolga", 50, 47, "river"],
  ["Indus", 27, 68, "river"],
];

// === MAP-FARBEN (Seterra-Stil) ===
const MAP_COLORS = {
  water:        '#a6d8e8',
  land:         '#cbdba2',
  landBorder:   '#7d9462',
  landHover:    '#a8c477',
  landFaded:    '#b7c2a3',
  landFadedBorder: '#9aa68b',
  correct:      '#22c55e',
  correctBorder:'#15803d',
  wrong:        '#ef4444',
  wrongBorder:  '#991b1b',
  dot:          '#4338ca',
  dotBorder:    '#fff',
  city:         '#0f172a',
  cityBorder:   '#fff',
  ocean:        '#1d4ed8',
  sea:          '#0284c7',
  lake:         '#0891b2',
  river:        '#0d9488',
  landmark:     '#dc2626',
  landmarkBorder: '#fff',
};

// === SEHENSWÜRDIGKEITEN ===
const LANDMARKS = [
  ["Eiffelturm", 48.858, 2.294],
  ["Brandenburger Tor", 52.516, 13.378],
  ["Big Ben", 51.500, -0.124],
  ["Kolosseum", 41.890, 12.492],
  ["Sagrada Família", 41.404, 2.174],
  ["Schiefer Turm von Pisa", 43.723, 10.396],
  ["Akropolis", 37.971, 23.726],
  ["Basilius-Kathedrale", 55.752, 37.622],
  ["Notre-Dame de Paris", 48.853, 2.349],
  ["Schloss Versailles", 48.804, 2.121],
  ["Petersdom", 41.902, 12.453],
  ["Schloss Neuschwanstein", 47.557, 10.749],
  ["Stonehenge", 51.179, -1.826],
  ["Christo Redentor", -22.952, -43.211],
  ["Machu Picchu", -13.163, -72.546],
  ["Iguazú-Wasserfälle", -25.696, -54.437],
  ["Salar de Uyuni", -20.133, -67.489],
  ["Osterinsel", -27.121, -109.367],
  ["Freiheitsstatue", 40.689, -74.044],
  ["Golden Gate Bridge", 37.819, -122.479],
  ["Mount Rushmore", 43.879, -103.459],
  ["Niagarafälle", 43.087, -79.075],
  ["Chichén Itzá", 20.683, -88.568],
  ["Tikal", 17.222, -89.624],
  ["Pyramiden von Gizeh", 29.979, 31.134],
  ["Tafelberg", -33.957, 18.405],
  ["Kilimandscharo", -3.076, 37.353],
  ["Sphinx", 29.976, 31.137],
  ["Taj Mahal", 27.175, 78.042],
  ["Goldener Tempel", 31.620, 74.876],
  ["Angkor Wat", 13.413, 103.867],
  ["Borobudur", -7.608, 110.204],
  ["Chinesische Mauer", 40.432, 116.570],
  ["Verbotene Stadt", 39.916, 116.397],
  ["Terrakotta-Armee", 34.385, 109.273],
  ["Mount Fuji", 35.361, 138.728],
  ["Kinkaku-ji", 35.039, 135.729],
  ["Burj Khalifa", 25.197, 55.274],
  ["Petra", 30.328, 35.444],
  ["Hagia Sophia", 41.008, 28.980],
  ["Mount Everest", 27.988, 86.925],
  ["Uluru", -25.345, 131.036],
  ["Sydney Opera House", -33.857, 151.215],
  ["Great Barrier Reef", -18.286, 147.700],
  ["Loch Ness", 57.323, -4.424],
];
