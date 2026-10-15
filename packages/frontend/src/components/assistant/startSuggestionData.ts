import {
  Activity,
  Atom,
  BarChart3,
  Brain,
  Briefcase,
  Calculator,
  CalendarClock,
  Coins,
  Dumbbell,
  Gauge,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Laptop,
  Leaf,
  Lightbulb,
  Link2,
  ListChecks,
  Mail,
  Megaphone,
  MessageSquareWarning,
  Moon,
  PartyPopper,
  PenLine,
  Percent,
  Plane,
  Scale,
  ShoppingCart,
  Smartphone,
  TrendingUp,
  Truck,
  Tv,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type StartSketch = 'growth' | 'dashboard' | 'compare' | 'write' | 'plan' | 'explain';

export interface StartSuggestion {
  key: string;
  sketch: StartSketch;
  title: string;
  hint: string;
  prompt: string;
  icon: LucideIcon;
}

/** 36 starters, six per sketch; the start page shows one of each. Mirrored in Android `AssistantStartSuggestions.kt`. */
export const START_SUGGESTIONS: StartSuggestion[] = [
  {
    key: 'savings',
    sketch: 'growth',
    title: 'Sparplan durchrechnen',
    hint: 'Rechner mit Reglern und Verlauf',
    prompt:
      'Wie viel Kapital habe ich nach 15 Jahren, wenn ich monatlich 300 CHF zu 4 % anlege? Zeig mir einen Rechner, mit dem ich die Werte ändern kann.',
    icon: TrendingUp,
  },
  {
    key: 'mortgage',
    sketch: 'growth',
    title: 'Eigenheim tragbar?',
    hint: 'Hypothek, Zins und Einkommen',
    prompt:
      "Kann ich mir eine Wohnung für 850'000 CHF leisten? Ich verdiene 140'000 CHF im Jahr und habe 200'000 CHF Eigenkapital. Zeig mir einen Tragbarkeitsrechner.",
    icon: Home,
  },
  {
    key: 'pillar3a',
    sketch: 'growth',
    title: 'Säule 3a planen',
    hint: 'Steuern sparen und vorsorgen',
    prompt:
      'Wie viel bringt mir die Säule 3a bis zur Pension, wenn ich jedes Jahr den Maximalbetrag einzahle? Zeig einen Rechner mit Rendite, Laufzeit und Steuerersparnis.',
    icon: Landmark,
  },
  {
    key: 'loan',
    sketch: 'growth',
    title: 'Kredit oder Leasing',
    hint: 'Monatsrate und Gesamtkosten',
    prompt:
      "Ich möchte ein Auto für 32'000 CHF finanzieren. Vergleiche Kredit und Leasing über 4 Jahre mit einem Rechner für Rate, Zins und Gesamtkosten.",
    icon: Calculator,
  },
  {
    key: 'power',
    sketch: 'growth',
    title: 'Stromkosten prüfen',
    hint: 'Was ein Gerät im Jahr kostet',
    prompt:
      'Was kostet mich mein Gaming-PC im Jahr an Strom, wenn er 4 Stunden täglich mit 450 Watt läuft? Zeig einen Rechner mit Strompreis und Nutzungsdauer.',
    icon: Zap,
  },
  {
    key: 'salary',
    sketch: 'growth',
    title: 'Lohnerhöhung verhandeln',
    hint: 'Was die Prozente wirklich bringen',
    prompt:
      "Ich verdiene 92'000 CHF brutto. Zeig mir einen Rechner, was 3, 5 oder 8 % Lohnerhöhung netto pro Monat und über 10 Jahre ausmachen.",
    icon: Percent,
  },
  {
    key: 'budget',
    sketch: 'dashboard',
    title: 'Budget als Dashboard',
    hint: 'Kennzahlen und Diagramm',
    prompt:
      'Hilf mir, mein Monatsbudget von 5200 CHF auf Miete, Essen, Mobilität, Freizeit und Sparen aufzuteilen. Zeig es als interaktives Dashboard.',
    icon: BarChart3,
  },
  {
    key: 'running',
    sketch: 'dashboard',
    title: 'Lauftraining auswerten',
    hint: 'Kilometer, Tempo, Verlauf',
    prompt:
      'Erstelle ein Beispiel-Dashboard für 8 Wochen Lauftraining mit Kilometern, Tempo und Puls pro Woche, damit ich meine Fortschritte sehe.',
    icon: Activity,
  },
  {
    key: 'sleep',
    sketch: 'dashboard',
    title: 'Schlaf im Blick',
    hint: 'Muster über zwei Wochen',
    prompt:
      'Zeig mir ein Dashboard, wie ich meinen Schlaf über zwei Wochen auswerten kann: Dauer, Einschlafzeit und Wochentag im Vergleich.',
    icon: Moon,
  },
  {
    key: 'groceries',
    sketch: 'dashboard',
    title: 'Haushaltskosten',
    hint: 'Wohin das Geld fliesst',
    prompt:
      'Wir sind ein Haushalt mit zwei Personen. Erstelle ein Dashboard mit typischen Monatsausgaben nach Kategorie und zeig, wo man am meisten sparen kann.',
    icon: ShoppingCart,
  },
  {
    key: 'project',
    sketch: 'dashboard',
    title: 'Projektstatus',
    hint: 'Aufgaben, Fortschritt, Risiken',
    prompt:
      'Erstelle ein Projekt-Dashboard für eine Website-Neugestaltung mit Aufgaben pro Phase, Fortschritt in Prozent und offenen Risiken.',
    icon: ListChecks,
  },
  {
    key: 'energy',
    sketch: 'dashboard',
    title: 'Energieverbrauch',
    hint: 'Monate und Jahresvergleich',
    prompt:
      'Zeig mir ein Dashboard für den Stromverbrauch einer 4-Zimmer-Wohnung über ein Jahr, nach Monat, mit Vergleich zum Vorjahr.',
    icon: Gauge,
  },
  {
    key: 'ebike',
    sketch: 'compare',
    title: 'Optionen vergleichen',
    hint: 'Nebeneinander mit Auswahl',
    prompt:
      'Vergleiche drei E-Bikes für einen täglichen Arbeitsweg von 12 km in einer Vergleichsansicht und empfiehl mir eines.',
    icon: Scale,
  },
  {
    key: 'phone',
    sketch: 'compare',
    title: 'Neues Smartphone',
    hint: 'Drei Modelle im Vergleich',
    prompt:
      'Ich brauche ein neues Smartphone bis 800 CHF mit guter Kamera und langem Akku. Vergleiche drei Modelle in einer Vergleichsansicht.',
    icon: Smartphone,
  },
  {
    key: 'health',
    sketch: 'compare',
    title: 'Franchise wählen',
    hint: 'Welche lohnt sich für mich?',
    prompt:
      'Vergleiche die Krankenkassen-Franchisen 300, 1500 und 2500 CHF für jemanden mit etwa 1200 CHF Gesundheitskosten pro Jahr. Mit Vergleichsansicht und Empfehlung.',
    icon: HeartPulse,
  },
  {
    key: 'travel',
    sketch: 'compare',
    title: 'Ferienziel finden',
    hint: 'Wetter, Kosten, Anreise',
    prompt:
      'Vergleiche Lissabon, Kreta und Teneriffa für eine Woche Ferien im März: Wetter, Kosten und Anreise aus Zürich, in einer Vergleichsansicht.',
    icon: Plane,
  },
  {
    key: 'laptop',
    sketch: 'compare',
    title: 'Laptop fürs Studium',
    hint: 'Leicht, ausdauernd, bezahlbar',
    prompt:
      'Vergleiche drei Laptops fürs Studium bis 1300 CHF nach Gewicht, Akku und Leistung in einer Vergleichsansicht.',
    icon: Laptop,
  },
  {
    key: 'streaming',
    sketch: 'compare',
    title: 'Streamingdienste',
    hint: 'Preis und Angebot',
    prompt:
      'Welche Streamingdienste lohnen sich in der Schweiz? Vergleiche Preis, Angebot und Bildqualität in einer Vergleichsansicht.',
    icon: Tv,
  },
  {
    key: 'text',
    sketch: 'write',
    title: 'Text schreiben',
    hint: 'Mail, Brief oder Beitrag',
    prompt: 'Hilf mir, einen Text zu schreiben: ',
    icon: PenLine,
  },
  {
    key: 'application',
    sketch: 'write',
    title: 'Bewerbung schreiben',
    hint: 'Anschreiben, das auffällt',
    prompt: 'Hilf mir, ein überzeugendes Bewerbungsschreiben zu verfassen. Die Stelle: ',
    icon: Briefcase,
  },
  {
    key: 'decline',
    sketch: 'write',
    title: 'Freundlich absagen',
    hint: 'Klar, aber herzlich',
    prompt: 'Hilf mir, freundlich und klar abzusagen. Worum es geht: ',
    icon: Mail,
  },
  {
    key: 'greeting',
    sketch: 'write',
    title: 'Persönlicher Glückwunsch',
    hint: 'Geburtstag, Hochzeit, Jubiläum',
    prompt: 'Schreib mir einen persönlichen Glückwunsch. Für wen und was ich mag an der Person: ',
    icon: Gift,
  },
  {
    key: 'post',
    sketch: 'write',
    title: 'Beitrag für LinkedIn',
    hint: 'Erfolg teilen, ohne zu prahlen',
    prompt:
      'Hilf mir, einen LinkedIn-Beitrag zu schreiben, der natürlich klingt. Das möchte ich teilen: ',
    icon: Megaphone,
  },
  {
    key: 'complaint',
    sketch: 'write',
    title: 'Reklamation formulieren',
    hint: 'Sachlich und wirksam',
    prompt: 'Hilf mir, eine sachliche und wirksame Reklamation zu schreiben. Das ist passiert: ',
    icon: MessageSquareWarning,
  },
  {
    key: 'day',
    sketch: 'plan',
    title: 'Tag planen',
    hint: 'Termine, Pausen, Fokuszeit',
    prompt: 'Plane mit mir meinen Tag. Das steht heute an: ',
    icon: CalendarClock,
  },
  {
    key: 'menu',
    sketch: 'plan',
    title: 'Wochenmenü',
    hint: 'Gesund, einfach, mit Einkaufsliste',
    prompt:
      'Erstelle mir ein einfaches, gesundes Wochenmenü für zwei Personen mit Einkaufsliste. Besonderheiten: ',
    icon: UtensilsCrossed,
  },
  {
    key: 'move',
    sketch: 'plan',
    title: 'Umzug planen',
    hint: 'Zeitplan und Checkliste',
    prompt:
      'Hilf mir, meinen Umzug zu planen, mit Zeitplan und Checkliste. Umzugsdatum und Situation: ',
    icon: Truck,
  },
  {
    key: 'exam',
    sketch: 'plan',
    title: 'Lernplan erstellen',
    hint: 'Bis zur Prüfung im Takt',
    prompt: 'Erstelle mir einen Lernplan bis zu meiner Prüfung. Fach, Datum und Stoff: ',
    icon: GraduationCap,
  },
  {
    key: 'workout',
    sketch: 'plan',
    title: 'Trainingsplan',
    hint: 'Drei Einheiten pro Woche',
    prompt:
      'Erstelle mir einen Trainingsplan mit drei Einheiten pro Woche. Mein Ziel und meine Ausgangslage: ',
    icon: Dumbbell,
  },
  {
    key: 'party',
    sketch: 'plan',
    title: 'Fest organisieren',
    hint: 'Ablauf, Essen, Aufgaben',
    prompt:
      'Hilf mir, ein Fest zu organisieren: Ablauf, Essen und Aufgabenverteilung. Anlass und Anzahl Gäste: ',
    icon: PartyPopper,
  },
  {
    key: 'topic',
    sketch: 'explain',
    title: 'Thema verstehen',
    hint: 'Schritt für Schritt erklärt',
    prompt: 'Erkläre mir verständlich und mit einem Beispiel: ',
    icon: Lightbulb,
  },
  {
    key: 'ai',
    sketch: 'explain',
    title: 'Wie denkt eine KI?',
    hint: 'Sprachmodelle einfach erklärt',
    prompt:
      'Erkläre mir einfach, wie ein Sprachmodell wie du Antworten erzeugt, mit einem anschaulichen Beispiel.',
    icon: Brain,
  },
  {
    key: 'inflation',
    sketch: 'explain',
    title: 'Inflation erklärt',
    hint: 'Warum alles teurer wird',
    prompt:
      'Erkläre mir verständlich, was Inflation ist, warum sie entsteht und was sie für mein Erspartes bedeutet.',
    icon: Coins,
  },
  {
    key: 'quantum',
    sketch: 'explain',
    title: 'Quantencomputer',
    hint: 'Ohne Formeln erklärt',
    prompt:
      'Erkläre mir ohne Formeln, was ein Quantencomputer anders macht als ein normaler Computer und wofür er gut ist.',
    icon: Atom,
  },
  {
    key: 'nature',
    sketch: 'explain',
    title: 'Wie Natur funktioniert',
    hint: 'Photosynthese und mehr',
    prompt:
      'Erkläre mir anschaulich, wie Photosynthese funktioniert und warum sie für uns so wichtig ist.',
    icon: Leaf,
  },
  {
    key: 'blockchain',
    sketch: 'explain',
    title: 'Blockchain verstehen',
    hint: 'Was dahinter steckt',
    prompt:
      'Erkläre mir einfach, was eine Blockchain ist, wie sie funktioniert und wo sie wirklich Sinn ergibt.',
    icon: Link2,
  },
];
