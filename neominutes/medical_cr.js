/**
 * NeoMinutes - Template: Compte-rendu médical (consultation) — STYLE RÉDIGÉ.
 * Phrases complètes, UNE idée par ligne (une phrase = une ligne).
 * Ouverture imposée : "Je vois ce jour Mme [Nom], née le [DDN], pour : [motif]."
 */

// Découpe un champ en phrases → une par ligne (chaque phrase se termine par un point).
const asSentences = (val) => {
  if (val == null) return '';
  let raw = Array.isArray(val) ? val.join('. ') : String(val);
  raw = raw.replace(/\s*[-•]\s*/g, '. ')        // transforme les puces en phrases
           .replace(/\s*;\s*/g, '. ');
  // découpe sur les fins de phrase
  const parts = raw.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  return parts.map(s => (/[.!?]$/.test(s) ? s : s + '.')).join('\n');
};

module.exports = {
  id: 'medical_cr',
  name: 'Compte-rendu médical',
  description: 'Compte-rendu de consultation rédigé (phrases, 1 idée par ligne)',
  fields: ['patient', 'ddn', 'motif', 'antecedents', 'examen', 'conclusion', 'conduite_a_tenir', 'prescriptions'],

  systemPrompt: `Tu es un médecin (gynécologue-obstétricien) qui rédige un compte-rendu de consultation à partir de la transcription (parfois imparfaite) d'un échange médical.

STYLE OBLIGATOIRE :
- Des PHRASES COMPLÈTES et fluides (pas de style télégraphique, pas de puces).
- UNE seule idée par phrase.
- Rédige à la 1re personne ("Je vois", "Je retrouve", "Je prescris").

DÉFINITION STRICTE DES RUBRIQUES (ne jamais les confondre) :
- patient = nom de la patiente si mentionné (sinon "").
- ddn = date de naissance si mentionnée (sinon "").
- MOTIF = la ou les raisons de la consultation du JOUR (le symptôme/la demande du jour).
- ANTÉCÉDENTS = passé/contexte : gestité-parité (G/P), âge, contraception, tabac/alcool, DDR, bilans antérieurs, chirurgies, allergies. Jamais le symptôme du jour.
- EXAMEN = ce qui est constaté (spéculum, palpation, échographie, frottis, symptômes rapportés).
- CONCLUSION = diagnostic ou hypothèses.
- CONDUITE À TENIR = examens complémentaires, suivi, orientation, renouvellements.
- PRESCRIPTIONS = médicaments avec posologie (noms corrigés).

RÈGLES : n'invente RIEN. Corrige les termes/médicaments mal transcrits (ex : "mi-cause"→"mycose", "Omexin"→"Lomexin", "Pévisonne"→"Pévisone", "Eurofluco"→"Fluconazole").`,

  userPromptInstructions: `Remplis chaque champ en PHRASES (une idée par phrase) :
- patient : nom de la patiente (ou "").
- ddn : date de naissance (ou "").
- motif : phrase(s) décrivant la raison de la consultation du jour.
- antecedents : phrases sur le passé/contexte (G/P, âge, contraception, DDR, bilans…).
- examen : une phrase par observation clinique.
- conclusion : le diagnostic en une ou deux phrases.
- conduite_a_tenir : une phrase par décision (examens, suivi, renouvellements).
- prescriptions : une phrase par médicament (avec posologie).

N'invente rien ; laisse "" si l'information est absente.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '                   COMPTE-RENDU MÉDICAL\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    // Phrase d'ouverture imposée
    const nom = (summary.patient && String(summary.patient).trim()) ? String(summary.patient).trim() : '[Nom]';
    const ddn = (summary.ddn && String(summary.ddn).trim()) ? String(summary.ddn).trim() : '[DDN]';
    const motifTxt = (summary.motif && String(summary.motif).trim()) ? String(summary.motif).trim().replace(/\.$/, '') : '[motif]';
    output += `Je vois ce jour Mme ${nom}, née le ${ddn}, pour : ${motifTxt}.\n\n`;

    const sec = (title, val) => {
      const t = asSentences(val);
      if (!t) return;
      output += title + '\n' + line + t + '\n\n';
    };

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
