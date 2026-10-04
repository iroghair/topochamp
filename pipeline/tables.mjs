// Hand-maintained tables that correct or complete the source data.

// Continent packs. `view` is the part of the world the map is fitted to (lon/lat bbox).
export const CONTINENTS = [
  { id: 'europe', ne: 'Europe', nl: 'Europa', en: 'Europe', view: [-25, 34, 48, 71.5] },
  { id: 'asia', ne: 'Asia', nl: 'Azië', en: 'Asia', view: [25, -11, 180, 78] },
  { id: 'africa', ne: 'Africa', nl: 'Afrika', en: 'Africa', view: [-26, -36, 64, 38] },
  { id: 'north-america', ne: 'North America', nl: 'Noord-Amerika', en: 'North America', view: [-170, 5, -50, 84] },
  { id: 'south-america', ne: 'South America', nl: 'Zuid-Amerika', en: 'South America', view: [-93, -57, -32, 14] },
  { id: 'oceania', ne: 'Oceania', nl: 'Oceanië', en: 'Oceania', view: [110, -50, 180, 0] },
];

export const WORLD = { id: 'world', nl: 'Wereld', en: 'World', view: [-180, -58, 180, 84] };

// Country map views that the automatic "main territory" detection gets wrong.
export const COUNTRY_VIEWS = {
  USA: [-125, 24, -66.5, 49.5], // contiguous states; Alaska and Hawaii would need insets
  NOR: [4.5, 57.9, 31.2, 71.2], // mainland, without Svalbard
  ESP: [-9.4, 35.95, 4.4, 43.85], // mainland and Balearic Islands, without the Canaries, Ceuta and Melilla
  RUS: [19, 41, 180, 78],
  NZL: [166, -47.5, 178.7, -34.3],
  FJI: [176.8, -19.3, 180, -16],
  KIR: [172.5, -1, 177, 3.5],
};

// Some Natural Earth countries list several capitals; the first one in the list is the
// "main" capital used for default lists.
export const PRIMARY_CAPITAL = {
  ZAF: 'Pretoria',
  CIV: 'Yamoussoukro',
  BOL: 'Sucre',
  MMR: 'Naypyidaw',
};

// Natural Earth areas that are merged into a country for school purposes.
export const COUNTRY_MERGES = {
  SOL: 'SOM', // Somaliland
  CYN: 'CYP', // Northern Cyprus
  CNM: 'CYP', // UN buffer zone
  ESB: 'CYP', // Dhekelia
  WSB: 'CYP', // Akrotiri
  KAB: 'KAZ', // Baikonur
  USG: 'CUB', // Guantanamo
};

// Extra alternative names accepted when matching a typed name or a pasted list.
export const EXTRA_ALIASES = {
  'c:GBR': ['Groot-Brittannië', 'Great Britain', 'UK'],
  'c:USA': ['Amerika', 'Verenigde Staten van Amerika', 'USA', 'VS'],
  'c:CZE': ['Tsjechische Republiek', 'Czech Republic'],
  'c:MKD': ['Macedonië', 'Macedonia'],
  'c:SWZ': ['Swaziland'],
  'c:CIV': ['Ivoorkust', 'Ivory Coast'],
  'c:NLD': ['Holland'],
  'c:BIH': ['Bosnië', 'Bosnia'],
  'c:COD': ['Congo-Kinshasa', 'DR Congo'],
  'c:COG': ['Congo-Brazzaville'],
  'c:TUR': ['Türkiye'],
};

// Natural Earth's Dutch names that are wrong, keyed by English name.
export const NAME_FIXES_NL = {
  'Tatra Mts.': 'Tatra',
  'Grampian Mts.': 'Grampian Mountains',
  APPENNINI: 'Apennijnen',
};

// Dutch names for rivers. The global Natural Earth river layer has English names only.
export const RIVER_NAMES_NL = {
  Rhine: 'Rijn',
  Meuse: 'Maas',
  Scheldt: 'Schelde',
  Danube: 'Donau',
  Vistula: 'Wisła',
  Thames: 'Theems',
  Tagus: 'Taag',
  Tiber: 'Tiber',
  Dnieper: 'Dnjepr',
  Dniester: 'Dnjestr',
  Volga: 'Wolga',
  Ural: 'Oeral',
  Nile: 'Nijl',
  'White Nile': 'Witte Nijl',
  'Blue Nile': 'Blauwe Nijl',
  Congo: 'Kongo',
  Orange: 'Oranjerivier',
  Amazon: 'Amazone',
  Amazonas: 'Amazone',
  'St. Lawrence': 'Saint Lawrence',
  'Saint Lawrence': 'Saint Lawrence',
  Yangtze: 'Jangtsekiang',
  'Chang Jiang': 'Jangtsekiang',
  'Huang He': 'Gele Rivier',
  'Yellow': 'Gele Rivier',
  Yenisey: 'Jenisej',
  Euphrates: 'Eufraat',
  Moselle: 'Moezel',
  Mosel: 'Moezel',
  Ems: 'Eems',
  Dvina: 'Dwina',
  'Northern Dvina': 'Noordelijke Dwina',
  'Western Dvina': 'Westelijke Dwina',
  Pechora: 'Petsjora',
};

// Countries whose Natural Earth provinces are smaller than the regions schools use: the
// provinces are merged by this field into regions.
export const PROVINCE_GROUPING = {
  FRA: 'region',
  ITA: 'region',
  ESP: 'region',
  GBR: 'geonunit',
  SVN: 'region',
  LVA: 'region',
  UGA: 'region',
  PHL: 'region',
};

// Merged regions that are parts of a country ("landsdeel") rather than provinces.
export const GROUP_TYPE = { GBR: 'part' };

// Parts of countries that schools ask on continent maps (and on the country's own map when
// its provinces are not already merged this way): provinces merged by this field.
export const COUNTRY_PARTS = {
  BEL: 'region',
  GBR: 'geonunit',
};

// Dutch and English names of those regions: local name → [nl, en].
export const REGION_NAMES = {
  // Belgium
  Flemish: ['Vlaanderen', 'Flanders'],
  Walloon: ['Wallonië', 'Wallonia'],
  'Capital Region': ['Brussels Hoofdstedelijk Gewest', 'Brussels-Capital Region'],
  // France
  'Bourgogne-Franche-Comté': ['Bourgondië-Franche-Comté', 'Bourgogne-Franche-Comté'],
  Bretagne: ['Bretagne', 'Brittany'],
  Normandie: ['Normandië', 'Normandy'],
  Corse: ['Corsica', 'Corsica'],
  // Italy
  "Valle d'Aosta": ["Valle d'Aosta", 'Aosta Valley'],
  Piemonte: ['Piëmont', 'Piedmont'],
  Lombardia: ['Lombardije', 'Lombardy'],
  'Trentino-Alto Adige': ['Trentino-Zuid-Tirol', 'Trentino-South Tyrol'],
  Liguria: ['Ligurië', 'Liguria'],
  Abruzzo: ['Abruzzen', 'Abruzzo'],
  Apulia: ['Apulië', 'Apulia'],
  Calabria: ['Calabrië', 'Calabria'],
  Campania: ['Campanië', 'Campania'],
  Toscana: ['Toscane', 'Tuscany'],
  Sicily: ['Sicilië', 'Sicily'],
  Sardegna: ['Sardinië', 'Sardinia'],
  Umbria: ['Umbrië', 'Umbria'],
  // Spain
  'Foral de Navarra': ['Navarra', 'Navarre'],
  'País Vasco': ['Baskenland', 'Basque Country'],
  Cataluña: ['Catalonië', 'Catalonia'],
  Andalucía: ['Andalusië', 'Andalusia'],
  Galicia: ['Galicië', 'Galicia'],
  'Castilla y León': ['Castilië en León', 'Castile and León'],
  Valenciana: ['Valencia', 'Valencian Community'],
  Asturias: ['Asturië', 'Asturias'],
  Cantabria: ['Cantabrië', 'Cantabria'],
  'Canary Is.': ['Canarische Eilanden', 'Canary Islands'],
  'Islas Baleares': ['Balearen', 'Balearic Islands'],
  'Castilla-La Mancha': ['Castilië-La Mancha', 'Castilla-La Mancha'],
  // United Kingdom
  England: ['Engeland', 'England'],
  Scotland: ['Schotland', 'Scotland'],
  'Northern Ireland': ['Noord-Ierland', 'Northern Ireland'],
};
