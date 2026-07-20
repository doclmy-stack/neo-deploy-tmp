/**
 * NeoMinutes - Template: Compte-rendu médical (consultation)
 * Version renforcée : définitions STRICTES des rubriques + exemple, pour éviter
 * la confusion motif / antécédents / examen (fréquente avec les petits modèles).
 * asLines() normalise les listes en vraies puces "• " (même si l'IA renvoie
 * une seule chaîne "- A, - B" ou un tableau).
 */

const asLines = (val) => {
  if (val == null) return '';
  let items = [];
  if (Array.isArray(val)) {
    items = val.map(v => String(v));
  } else {
    // Chaîne : on découpe sur " - ", "; ", " • " ou retours à la ligne
    const s = String(val).trim();
    if (/(^|\s)[-•]\s|;\s|\n/.test(s)) {
      items = s.split(/\s*[-•]\s+|\s*;\s+|\n+/);
    } else {
      items = [s];
    }
  }
  items = items.map(x => x.replace(/^[-•\s]+/, '').trim()).filter(Boolean);
  if (items.length <= 1) return items.join('');           // texte simple : pas de puce
  return items.map(x => `•  ${x}`).join('\n');            // liste : une puce par élément
};

module.exports = {
  id: 'medical_cr',
  name: 'Compte-rendu médical',
  description: 'Compte-rendu de consultation (motif, antécédents, examen, conclusion, CAT, prescriptions)',
  fields: ['motif', 'antecedents', 'examen', 'conclusion', 'conduite_a_tenir', 'prescriptions'],
  arrayFields: ['examen', 'prescriptions'],

  systemPrompt: `Tu es un médecin qui rédige un compte-rendu de consultation à partir de la transcription (parfois imparfaite) d'un échange médical.

DÉFINITION STRICTE DE CHAQUE RUBRIQUE (ne JAMAIS les confondre) :
- MOTIF = UNIQUEMENT la ou les raison(s) pour lesquelles la patiente consulte AUJOURD'HUI (le symptôme/la demande du jour, ex : "démangeaisons depuis 2 semaines", "suivi annuel"). RIEN d'autre.
- ANTÉCÉDENTS = le PASSÉ et le contexte permanent : gestité/parité (G/P), âge, contraception en cours, tabac/alcool, sport, poids/taille, dernières règles (DDR), bilans antérieurs, maladies/chirurgies passées, allergies. JAMAIS le symptôme du jour ici.
- EXAMEN = ce qui est CONSTATÉ pendant la consultation : symptômes rapportés + observations cliniques (spéculum, palpation, échographie, frottis…).
- CONCLUSION = le diagnostic ou les hypothèses diagnostiques.
- CONDUITE À TENIR = décisions : examens complémentaires, suivi, orientation, renouvellements.
- PRESCRIPTIONS = médicaments avec posologie (noms corrigés).

RÈGLES :
- Sois FIDÈLE : n'invente RIEN qui ne soit dans la transcription.
- CORRIGE les termes médicaux et noms de médicaments mal transcrits (ex : "mi-cause"→"mycose", "Omexin"→"Lomexin", "Pévisonne"→"Pévisone", "Eurofluco/Oroflucos"→"Fluconazole").
- Pour EXAMEN et PRESCRIPTIONS : renvoie un TABLEAU JSON, un élément par item (ex : ["item1","item2"]). Ne mets pas plusieurs items dans une même chaîne.

EXEMPLE de bon classement (patiente qui consulte pour démangeaisons, G3P2 sous pilule) :
- motif : "Démangeaisons vulvaires depuis 2 semaines ; suivi annuel."
- antecedents : "36 ans, G3P2, contraception par pilule, non-fumeuse, non-buveuse, DDR le 12/07/2026, cholestérol limite au dernier bilan."
- examen : ["Leucorrhées avec inflammation vulvaire externe évoquant une mycose, lésions de grattage", "Spéculum : col normal, frottis réalisé", "Palpation mammaire normale", "Échographie pelvienne normale"]
- conclusion : "Mycose vulvo-vaginale."
Note bien : la contraception et G3P2 vont dans ANTÉCÉDENTS, pas dans le motif.`,

  userPromptInstructions: `Rédige le compte-rendu en classant CHAQUE information dans la bonne rubrique selon les définitions strictes ci-dessus :
- MOTIF : seulement la raison de la consultation du jour.
- ANTÉCÉDENTS : G/P, âge, contraception, tabac/alcool, DDR, bilans/poids, histoire médicale.
- EXAMEN : symptômes + observations cliniques (TABLEAU, un élément par observation).
- CONCLUSION : diagnostic ou hypothèses.
- CONDUITE À TENIR : examens complémentaires, suivi, renouvellements.
- PRESCRIPTIONS : médicaments + posologie (TABLEAU, un élément par médicament, noms corrigés).

Vérifie AVANT de répondre que rien du "motif" ne se retrouve dans "antécédents" et inversement. N'invente rien.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '                   COMPTE-RENDU MÉDICAL\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    const sec = (title, val) => {
      const t = asLines(val);
      if (!t) return;
      output += title + '\n' + line + t + '\n\n';
    };

    sec('MOTIF DE CONSULTATION', summary.motif);
    sec('ANTÉCÉDENTS', summary.antecedents);
    sec('EXAMEN CLINIQUE', summary.examen);
    sec('CONCLUSION / DIAGNOSTIC', summary.conclusion);
    sec('CONDUITE À TENIR', summary.conduite_a_tenir);
    sec('PRESCRIPTIONS', summary.prescriptions);

    if (summary.keywords && summary.keywords.length > 0) {
      output += 'MOTS-CLÉS\n' + line + summary.keywords.join(', ') + '\n';
    }
    return output;
  }
};
