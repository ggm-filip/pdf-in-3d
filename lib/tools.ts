import type { Page, Route } from "./content";
import { QUOTE } from "./quote";
import type { BrochureText } from "@/components/BrochureViewer";
import type { PressText } from "@/components/PressAnimation";
import type { LampKind } from "@/components/lamp";

/* Interactive tools that are pages of their own: the foil viewer (tool/foil/<lang>) and the quote wizard (tool/offerte/<lang>). */

const SITE = "https://www.groepmatthys.com";

export type FoilText = {
  path: string;
  hreflang: string;
  title: string;
  kicker: string;
  seoTitle: string;
  description: string;
  intro: string;
  upload: string;
  uploadHint: string;
  demo: string;
  which: string;
  dark: string;
  light: string;
  pick: string;
  pickHint: string;
  tolerance: string;
  foil: string;
  foils: Record<string, string>;
  paper: string;
  papers: Record<string, string>;
  tiltHint: string;
  motion: string;
  save: string;
  privacy: string;
  ctaTitle: string;
  ctaText: string;
  ctaButton: string;
  ctaHref: string;
  more: string;
  moreHref: string;
};

export const FOIL: Record<string, FoilText> = {
  nl: {
    path: "/foil-viewer/", hreflang: "nl", title: "Zie je ontwerp glanzen", kicker: "Foil-viewer",
    seoTitle: "Foil-viewer: bekijk je ontwerp met koudfolie | Grafische Groep Matthys",
    description: "Laad je logo of etiket op en zie meteen hoe het eruitziet met goud-, zilver- of holografische koudfolie. Beweeg je muis of gsm en zie het licht spelen.",
    intro: "Laad je logo, etiket of verpakking op en kies welke delen in folie komen. Beweeg je muis over het ontwerp of kantel je gsm: zo vangt koudfolie het licht.",
    upload: "Ontwerp opladen", uploadHint: "PNG, JPG of SVG. Je bestand blijft op je eigen toestel.", demo: "Voorbeeld",
    which: "Wat komt in folie?", dark: "Donkere delen", light: "Lichte delen", pick: "Een kleur", pickHint: "Klik op een kleur in je ontwerp.", tolerance: "Gevoeligheid",
    foil: "Folie", foils: { gold: "Goud", silver: "Zilver", copper: "Koper", rose: "Rosé", blue: "Blauw", holo: "Holografisch" },
    paper: "Ondergrond", papers: { white: "Wit", cream: "Crème", kraft: "Kraft", black: "Zwart" },
    tiltHint: "Beweeg over het ontwerp", motion: "Kantel met je gsm", save: "Beeld bewaren",
    privacy: "We slaan niets op: alles gebeurt in je browser.",
    ctaTitle: "In het echt is het nog mooier", ctaText: "Een scherm kan het effect alleen benaderen. Vraag onze inspiratiebrochure aan en voel zelf wat koudfolie doet, of stuur je ontwerp en we bekijken samen de mogelijkheden.",
    ctaButton: "Inspiratiebrochure aanvragen", ctaHref: "/inspiratiebrochure/", more: "Stuur ons je ontwerp", moreHref: "/contact/",
  },
  en: {
    path: "/en/foil-viewer/", hreflang: "en", title: "See your design shine", kicker: "Foil viewer",
    seoTitle: "Foil viewer: see your design with cold foil | Grafische Groep Matthys",
    description: "Upload your logo or label and see right away how it looks in gold, silver or holographic cold foil. Move your mouse or phone and watch the light play.",
    intro: "Upload your logo, label or packaging and choose which parts get foil. Move your mouse over the design or tilt your phone: that is how cold foil catches the light.",
    upload: "Upload design", uploadHint: "PNG, JPG or SVG. Your file stays on your own device.", demo: "Example",
    which: "What gets foil?", dark: "Dark parts", light: "Light parts", pick: "One colour", pickHint: "Click a colour in your design.", tolerance: "Sensitivity",
    foil: "Foil", foils: { gold: "Gold", silver: "Silver", copper: "Copper", rose: "Rosé", blue: "Blue", holo: "Holographic" },
    paper: "Substrate", papers: { white: "White", cream: "Cream", kraft: "Kraft", black: "Black" },
    tiltHint: "Move over the design", motion: "Tilt with your phone", save: "Save image",
    privacy: "We store nothing: everything happens in your browser.",
    ctaTitle: "It is even better in real life", ctaText: "A screen can only come close. Request our inspiration brochure and feel what cold foil does, or send us your design and we will look at the possibilities together.",
    ctaButton: "Request the inspiration brochure", ctaHref: "/en/inspiration-brochure/", more: "Send us your design", moreHref: "/en/contact/",
  },
  fr: {
    path: "/fr/foil-viewer/", hreflang: "fr", title: "Voyez briller votre design", kicker: "Foil viewer",
    seoTitle: "Foil viewer : votre design en dorure à froid | Grafische Groep Matthys",
    description: "Chargez votre logo ou votre étiquette et voyez immédiatement le rendu en dorure à froid or, argent ou holographique. Bougez la souris ou le téléphone et regardez la lumière jouer.",
    intro: "Chargez votre logo, étiquette ou emballage et choisissez les parties en dorure. Survolez le design avec la souris ou inclinez votre téléphone : c’est ainsi que la dorure à froid capte la lumière.",
    upload: "Charger un design", uploadHint: "PNG, JPG ou SVG. Votre fichier reste sur votre appareil.", demo: "Exemple",
    which: "Qu’est-ce qui est doré ?", dark: "Parties foncées", light: "Parties claires", pick: "Une couleur", pickHint: "Cliquez sur une couleur de votre design.", tolerance: "Sensibilité",
    foil: "Dorure", foils: { gold: "Or", silver: "Argent", copper: "Cuivre", rose: "Rosé", blue: "Bleu", holo: "Holographique" },
    paper: "Support", papers: { white: "Blanc", cream: "Crème", kraft: "Kraft", black: "Noir" },
    tiltHint: "Survolez le design", motion: "Inclinez votre téléphone", save: "Enregistrer l’image",
    privacy: "Nous ne conservons rien : tout se passe dans votre navigateur.",
    ctaTitle: "En vrai, c’est encore plus beau", ctaText: "Un écran ne peut que s’en approcher. Envoyez-nous votre design et nous examinerons ensemble les possibilités.",
    ctaButton: "Envoyez-nous votre design", ctaHref: "/fr/contact/", more: "Voir l’inspiration", moreHref: "/fr/inspiration/",
  },
  de: {
    path: "/de/foil-viewer/", hreflang: "de", title: "Sehen Sie Ihr Design glänzen", kicker: "Foil-Viewer",
    seoTitle: "Foil-Viewer: Ihr Design mit Kaltfolie | Grafische Groep Matthys",
    description: "Laden Sie Ihr Logo oder Etikett hoch und sehen Sie sofort, wie es mit Gold-, Silber- oder holografischer Kaltfolie aussieht. Bewegen Sie Maus oder Handy und sehen Sie das Licht spielen.",
    intro: "Laden Sie Ihr Logo, Etikett oder Ihre Verpackung hoch und wählen Sie, welche Teile Folie bekommen. Bewegen Sie die Maus über das Design oder kippen Sie Ihr Handy: So fängt Kaltfolie das Licht.",
    upload: "Design hochladen", uploadHint: "PNG, JPG oder SVG. Ihre Datei bleibt auf Ihrem Gerät.", demo: "Beispiel",
    which: "Was bekommt Folie?", dark: "Dunkle Teile", light: "Helle Teile", pick: "Eine Farbe", pickHint: "Klicken Sie auf eine Farbe in Ihrem Design.", tolerance: "Empfindlichkeit",
    foil: "Folie", foils: { gold: "Gold", silver: "Silber", copper: "Kupfer", rose: "Rosé", blue: "Blau", holo: "Holografisch" },
    paper: "Untergrund", papers: { white: "Weiß", cream: "Creme", kraft: "Kraft", black: "Schwarz" },
    tiltHint: "Über das Design bewegen", motion: "Mit dem Handy kippen", save: "Bild speichern",
    privacy: "Wir speichern nichts: Alles passiert in Ihrem Browser.",
    ctaTitle: "In echt ist es noch schöner", ctaText: "Ein Bildschirm kann es nur annähern. Fordern Sie unsere Inspirationsbroschüre an und fühlen Sie, was Kaltfolie bewirkt, oder senden Sie uns Ihr Design.",
    ctaButton: "Inspirationsbroschüre anfordern", ctaHref: "/de/inspirationsbroschure/", more: "Design senden", moreHref: "/de/kontakt/",
  },
};

/* 3D brochure (NL only), in the menu under Inspiratie and linked from the brochure request page (requestPath) */
export const BROCHURE: Record<string, BrochureText & { path: string; title: string; kicker: string; seoTitle: string; description: string; requestPath: string; promo: string; promoButton: string }> = {
  nl: {
    path: "/brochure-3d/", title: "Blader door onze brochure", kicker: "Brochure in 3D",
    seoTitle: "Brochure in 3D | Grafische Groep Matthys",
    description: "Blader door onze brochure en zie de koudfolie en SpotUV glanzen.",
    prev: "Vorige pagina", next: "Volgende pagina", page: "Pagina",
    hint: "Sleep een hoek om te bladeren, of klik links of rechts. Beweeg je muis of kantel je gsm om de folie te zien glanzen.",
    tilt: "Kantel je gsm", loading: "Brochure laden…", noWebgl: "Je browser kan deze 3D-weergave niet tonen.",
    requestPath: "/inspiratiebrochure/", promo: "Benieuwd? Blader nu al door de brochure in 3D.", promoButton: "Bekijk de brochure in 3D",
  },
};

/* Our press in motion (NL only), in the menu under Koudfolie. Draft texts, to be approved by the owner. */
export const PRESS: Record<string, PressText & { path: string; title: string; kicker: string; seoTitle: string; description: string }> = {
  nl: {
    path: "/onze-drukpers/", title: "Zo loopt een vel door onze pers", kicker: "Onze drukpers",
    seoTitle: "Onze drukpers in beweging | Grafische Groep Matthys",
    description: "Volg een vel door onze pers: lijm, koudfolie, zwart, twee Pantones, cyaan, magenta, geel en lak.",
    intro: "Volg het blauw gemarkeerde vel. Eerst komt er lijm op de plaatsen die moeten glanzen, dan de folie, dan de kleuren en als laatste de lak.",
    direction: "Het papier loopt van rechts naar links door de pers.",
    play: "Afspelen", pause: "Pauzeren", sheet: "Het vel van bovenaf gezien", waiting: "Het vel komt eraan", done: "Klaar",
    doneText: "Het vel ligt op de stapel aan het einde van de pers. Alles in één doorgang.",
    steps: [
      { name: "Lijm", text: "De eerste toren zet lijm op het papier, enkel op de plaatsen die straks moeten glanzen." },
      { name: "Folie", text: "De folie rolt over het papier. Waar lijm zit, blijft de folie kleven. De rest gaat terug op de rol." },
      { name: "Zwart", text: "De zwarte toren." },
      { name: "Pantone 1", text: "Een eerste Pantone-kleur." },
      { name: "Cyaan", text: "Cyaan. Gedrukt op de folie wordt de kleur metallic." },
      { name: "Magenta", text: "Magenta. Gedrukt op de folie wordt de kleur metallic." },
      { name: "Geel", text: "Geel. Op zilverfolie wordt geel goud." },
      { name: "Pantone 2", text: "Een tweede Pantone-kleur." },
      { name: "Lak", text: "De laatste toren zet een lak: om te beschermen of voor een speciaal effect." },
    ],
  },
};

/* PDF in 3D (internal, NL only, not in the menu, kept out of search engines): upload a PDF and see it in 3D */
export type Pdf3dText = {
  drop: string; choose: string; privacy: string; names: string; reading: string; page: string; of: string;
  notPdf: string; failed: string; tooMany: string; other: string; modeFold: string; modeBook: string;
  finish: string; finishAuto: string; finishes: Record<string, string>; found: string; nothing: string; license: string; source: string; sourceUrl: string;
  fold: { fold: string; flat: string; folded: string; play: string; drag: string; loading: string; noWebgl: string };
  lamp: { label: string; power: string; kinds: Record<LampKind, string> };
};
export const PDF3D: Record<string, Pdf3dText & { path: string; title: string; kicker: string; seoTitle: string; description: string }> = {
  nl: {
    path: "/pdf-in-3d/", title: "Jouw PDF in 3D", kicker: "PDF in 3D",
    seoTitle: "PDF in 3D | Grafische Groep Matthys",
    description: "Laad een PDF op en bekijk hem in 3D, met koudfolie, SpotUV en afwerking.",
    drop: "Sleep een PDF hierheen", choose: "of kies een bestand",
    privacy: "De PDF wordt alleen in je browser verwerkt. Hij wordt niet opgeslagen en niet verstuurd.",
    names: "Folie, SpotUV, kapvorm en rillijnen worden herkend aan de naam van de steunkleur, bv. Silverfoil, Goldfoil, SpotUV, CAD_cut, CAD_crease, Kapvorm, Rillijn of Dieline.",
    reading: "PDF lezen…", page: "Pagina", of: "van",
    notPdf: "Dit is geen PDF.", failed: "Deze PDF kon niet gelezen worden.", tooMany: "Alleen de eerste {n} pagina's worden getoond.",
    other: "Andere PDF", modeFold: "Vouwen", modeBook: "Bladeren",
    finish: "Afwerking", finishAuto: "Zoals in de PDF",
    finishes: { none: "Geen", "gloss-varnish": "Glanslak", "matt-varnish": "Matlak", "gloss-laminated": "Glanslaminaat", "matt-laminated": "Matlaminaat" },
    found: "Gevonden", nothing: "Geen folie, SpotUV of kapvorm gevonden: de PDF wordt als gewone bedrukking getoond.",
    license: "Gemaakt met MuPDF (AGPL-licentie).",
    source: "Broncode",
    sourceUrl: "https://github.com/ggm-filip/pdf-in-3d",
    fold: {
      fold: "Vouwen", flat: "Plat leggen", folded: "Vouwen", play: "Afspelen",
      drag: "Sleep om te draaien. Beweeg je muis om de folie te zien glanzen.",
      loading: "Laden…", noWebgl: "Je browser kan deze 3D-weergave niet tonen.",
    },
    lamp: {
      label: "Lamp", power: "Sterkte",
      kinds: { off: "Uit", spot: "Halogeenspot", day: "Daglicht", led: "Koele LED", candle: "Kaarslicht", rainbow: "Regenboog" },
    },
  },
};

export const toolRoutes = (): Route[] => [
  ...Object.entries(PDF3D).map(([lang, t]) => ({ path: t.path, key: `tool/pdf3d/${lang}`, lang, kind: "tool" as const })),
  ...Object.entries(PRESS).map(([lang, t]) => ({ path: t.path, key: `tool/press/${lang}`, lang, kind: "tool" as const })),
  ...Object.entries(BROCHURE).map(([lang, t]) => ({ path: t.path, key: `tool/brochure/${lang}`, lang, kind: "tool" as const })),
  ...Object.entries(FOIL).map(([lang, t]) => ({ path: t.path, key: `tool/foil/${lang}`, lang, kind: "tool" as const })),
  ...Object.entries(QUOTE).map(([lang, t]) => ({ path: t.path, key: `tool/offerte/${lang}`, lang, kind: "tool" as const })),
  { path: "/packshots-test/", key: "tool/packshots/nl", lang: "nl", kind: "tool" as const },
];

/* test page for the 3D packshots (not in the menu, not indexed) */
function packshotsPage(key: string, lang: string): Page {
  return {
    kind: "tool",
    key,
    lang,
    meta: { path: "/packshots-test/", lang: "nl-NL", title: "Packshots in 3D (test)", description: "", canonical: SITE + "/packshots-test/", alternates: [], robots: "noindex, nofollow", jsonLd: [] },
    hero: { title: "Packshots in 3D", kicker: "Testpagina", subtitle: "", image: null },
    sections: [],
  };
}

const LOCALE: Record<string, string> = { nl: "nl-NL", en: "en-GB", fr: "fr-FR", de: "de-DE" };

function quotePage(key: string, lang: string): Page | null {
  const t = QUOTE[lang];
  if (!t) return null;
  return {
    kind: "tool",
    key,
    lang,
    meta: {
      path: t.path,
      lang: LOCALE[lang] ?? lang,
      title: t.seoTitle,
      description: t.description,
      canonical: SITE + t.path,
      alternates: Object.entries(QUOTE).map(([l, x]) => ({ hreflang: l, href: SITE + x.path })),
      robots: "index, follow",
      jsonLd: [JSON.stringify({ "@context": "https://schema.org", "@type": "ContactPage", name: t.title, description: t.description, url: SITE + t.path, about: { "@type": "Service", name: "Koudfoliedruk", provider: { "@type": "Organization", name: "Grafische Groep Matthys" } } })],
    },
    hero: { title: t.title, kicker: t.kicker, subtitle: "", image: null },
    sections: [],
  };
}

function brochurePage(key: string, lang: string): Page | null {
  const t = BROCHURE[lang];
  if (!t) return null;
  return {
    kind: "tool",
    key,
    lang,
    meta: { path: t.path, lang: LOCALE[lang] ?? lang, title: t.seoTitle, description: t.description, canonical: SITE + t.path, alternates: [], robots: "index, follow", jsonLd: [] },
    hero: { title: t.title, kicker: t.kicker, subtitle: "", image: null },
    sections: [],
  };
}

function pressPage(key: string, lang: string): Page | null {
  const t = PRESS[lang];
  if (!t) return null;
  return {
    kind: "tool",
    key,
    lang,
    meta: { path: t.path, lang: LOCALE[lang] ?? lang, title: t.seoTitle, description: t.description, canonical: SITE + t.path, alternates: [], robots: "index, follow", jsonLd: [] },
    hero: { title: t.title, kicker: t.kicker, subtitle: "", image: null },
    sections: [],
  };
}

function pdf3dPage(key: string, lang: string): Page | null {
  const t = PDF3D[lang];
  if (!t) return null;
  return {
    kind: "tool",
    key,
    lang,
    meta: { path: t.path, lang: LOCALE[lang] ?? lang, title: t.seoTitle, description: t.description, canonical: SITE + t.path, alternates: [], robots: "noindex, nofollow", jsonLd: [] },
    hero: { title: t.title, kicker: t.kicker, subtitle: "", image: null },
    sections: [],
  };
}

export function toolPage(key: string): Page | null {
  const [, tool, lang] = key.split("/");
  if (tool === "pdf3d") return pdf3dPage(key, lang);
  if (tool === "press") return pressPage(key, lang);
  if (tool === "offerte") return quotePage(key, lang);
  if (tool === "brochure") return brochurePage(key, lang);
  if (tool === "packshots") return packshotsPage(key, lang);
  const t = FOIL[lang];
  if (!t) return null;
  return {
    kind: "tool",
    key,
    lang,
    meta: {
      path: t.path,
      lang: LOCALE[lang] ?? lang,
      title: t.seoTitle,
      description: t.description,
      canonical: SITE + t.path,
      alternates: Object.values(FOIL).map((x) => ({ hreflang: x.hreflang, href: SITE + x.path })),
      robots: "index, follow, max-image-preview:large",
      jsonLd: [JSON.stringify({ "@context": "https://schema.org", "@type": "WebApplication", name: t.kicker, description: t.description, url: SITE + t.path, applicationCategory: "DesignApplication", operatingSystem: "Any", offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" }, provider: { "@type": "Organization", name: "Grafische Groep Matthys" } })],
    },
    hero: { title: t.title, kicker: t.kicker, subtitle: "", image: null },
    sections: [],
  };
}
