// Knappe Start-Lagetexte für alle Sektoren & Regionen. Werden initial gesetzt,
// damit sofort überall etwas steht; Gemini überarbeitet sie dann rollierend.
// Bewusst allgemein gehalten (kein Datumsbezug), da sie nur Platzhalter sind.

export const SEED_SECTOR_NOTES = {
  software:   'Software & Cloud profitiert vom KI- und Digitalisierungsschub; hohe Bewertungen, aber starkes Wachstum bei Cloud- und Abo-Modellen.',
  ai_semi:    'KI & Halbleiter im Zentrum des Investitionszyklus: enorme Nachfrage nach Rechenleistung treibt die Kurse, zugleich hohe Schwankungen.',
  hardware:   'Hardware & Geräte hängt am Konsum- und Investitionszyklus; KI-Infrastruktur stützt, schwache Endkundennachfrage bremst.',
  comm:       'Kommunikation & Medien gemischt: Werbe- und Streaming-Erlöse erholen sich, Plattformregulierung bleibt ein Risiko.',
  health:     'Gesundheit & Pharma defensiv gefragt; Innovationen bei GLP-1 und Onkologie treiben, Preisdruck und Patentabläufe belasten.',
  finance:    'Finanzen & Banken reagieren stark auf die Zinsentwicklung; solide Margen, aber Vorsicht wegen Kreditrisiken und Konjunktur.',
  cons_cycl:  'Konsum zyklisch abhängig von Kaufkraft und Zinsen; hohe Zinsen dämpfen Anschaffungen, sinkende Inflation könnte stützen.',
  cons_def:   'Konsum defensiv als sicherer Hafen gefragt, wenn Unsicherheit steigt; stabile Erträge, aber begrenztes Wachstum.',
  industrial: 'Industrie profitiert von Infrastruktur- und Rüstungsausgaben sowie Reshoring; Konjunkturabhängigkeit bleibt das Hauptrisiko.',
  energy:     'Energie schwankt mit Öl- und Gaspreisen sowie geopolitischen Spannungen; hohe Cashflows, aber zyklisch und volatil.',
  materials:  'Rohstoffe hängen an der globalen Industrienachfrage und China; Energiewende stützt Metalle, Konjunkturflaute bremst.',
  utilities:  'Versorger zinssensibel und defensiv; stabile Dividenden, zusätzlicher Strombedarf durch KI-Rechenzentren als Wachstumstreiber.',
  realestate: 'Immobilien leiden unter hohen Finanzierungskosten; eine Zinswende nach unten wäre der wichtigste Erholungstreiber.',
};

export const SEED_REGION_NOTES = {
  usa:     'USA bleibt von Technologie und KI getrieben; robuste Wirtschaft, aber hohe Bewertungen und Abhängigkeit von wenigen Megacaps.',
  europe:  'Europa günstiger bewertet als die USA; Industrie und Banken stützen, schwaches Wachstum und Energiekosten bremsen.',
  germany: 'Deutschland exportabhängig und industriegeprägt; schwache Konjunktur, aber günstige Bewertungen und solide Mittelständler.',
  japan:   'Japan profitiert von Reformen und schwachem Yen; Unternehmensgewinne und Aktienrückkäufe stützen den Markt.',
  china:   'China zwischen Stimulus und Strukturproblemen; günstige Bewertungen, aber Immobilienkrise und Geopolitik als Belastung.',
  em:      'Schwellenländer profitieren von schwächerem Dollar und Rohstoffstärke; höheres Wachstum bei höherem Risiko.',
  apac:    'Asien-Pazifik breit getragen von Technologie und Binnennachfrage; Lieferketten und China-Abhängigkeit als Faktoren.',
  india:   'Indien mit starkem Strukturwachstum und junger Bevölkerung; hohe Bewertungen sind das Hauptrisiko.',
  latam:   'Lateinamerika rohstoff- und zinsgetrieben; hohe Renditen, aber politische und Währungsrisiken.',
  world:   'Der Weltmarkt insgesamt wird von US-Technologie dominiert; Streuung über Regionen mindert Klumpenrisiken.',
};
