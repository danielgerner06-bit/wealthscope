// Sektor-/Regionen-ETFs (Kopie aus scripts/sectors.mjs, nur die Listen).
export const SECTORS = [
  { id: 'software',   name: 'Software & Cloud',       color: '#6366f1', etf: 'IGV'  },
  { id: 'ai_semi',    name: 'KI & Halbleiter',        color: '#a855f7', etf: 'SOXX' },
  { id: 'hardware',   name: 'Hardware & Geräte',      color: '#8b5cf6', etf: 'XLK'  },
  { id: 'comm',       name: 'Kommunikation & Medien', color: '#ec4899', etf: 'XLC'  },
  { id: 'health',     name: 'Gesundheit & Pharma',    color: '#22c55e', etf: 'XLV'  },
  { id: 'finance',    name: 'Finanzen & Banken',      color: '#0ea5e9', etf: 'XLF'  },
  { id: 'cons_cycl',  name: 'Konsum zyklisch',        color: '#f59e0b', etf: 'XLY'  },
  { id: 'cons_def',   name: 'Konsum defensiv',        color: '#84cc16', etf: 'XLP'  },
  { id: 'industrial', name: 'Industrie',              color: '#64748b', etf: 'XLI'  },
  { id: 'energy',     name: 'Energie',                color: '#ef4444', etf: 'XLE'  },
  { id: 'materials',  name: 'Rohstoffe',              color: '#d97706', etf: 'XLB'  },
  { id: 'utilities',  name: 'Versorger',              color: '#14b8a6', etf: 'XLU'  },
  { id: 'realestate', name: 'Immobilien',             color: '#a16207', etf: 'XLRE' },
];
export const REGIONS = [
  { id: 'usa',      name: 'USA',             color: '#6366f1', etf: 'SPY'  },
  { id: 'europe',   name: 'Europa',          color: '#0ea5e9', etf: 'VGK'  },
  { id: 'germany',  name: 'Deutschland',     color: '#f59e0b', etf: 'EWG'  },
  { id: 'japan',    name: 'Japan',           color: '#ec4899', etf: 'EWJ'  },
  { id: 'china',    name: 'China',           color: '#ef4444', etf: 'MCHI' },
  { id: 'em',       name: 'Schwellenländer', color: '#22c55e', etf: 'EEM'  },
  { id: 'apac',     name: 'Asien-Pazifik',   color: '#14b8a6', etf: 'VPL'  },
  { id: 'india',    name: 'Indien',          color: '#a855f7', etf: 'INDA' },
  { id: 'latam',    name: 'Lateinamerika',   color: '#d97706', etf: 'ILF'  },
  { id: 'world',    name: 'Welt gesamt',     color: '#94a3b8', etf: 'URTH' },
];
