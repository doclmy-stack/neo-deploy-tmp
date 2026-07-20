/**
 * NeoMinutes - Template: Consultation — STYLE RÉDIGÉ
 * Phrases complètes, une idée par ligne. Ouverture "Je vois ce jour Mme ...".
 */

const asSentences = (val) => {
  if (val == null) return '';
  let raw = Array.isArray(val) ? val.join('. ') : String(val);
  raw = raw.replace(/\s*[-•]\s*/g, '. ').replace(/\s*;\s*/g, '. ');
  const parts = raw.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  return parts.map(s => (/[.!?]$/.test(s) ? s : s + '.')).join('\n');
};

module.exports = {
  id: 'consultation',
  name: '🩺 Consultation',
  description: 'Compte-rendu de consultation rédigé (phrases, 1 idée par ligne)',
  fields: ['patient', 'ddn', 'motif', 'histoire', 'antecedents', 'examen', 'conclusion', 'conduite_a_tenir', 'prescriptions'],

  systemPrompt: `Tu es un praticien qui rédige le compte-rendu d'une consultation à partir de la transcription (parfois imparfaite) de l'échange.

STYLE OBLIGATOIRE :
- PHRASES COMPLÈTES et fluides (pas de style télégraphique, pas de puces).
- UNE seule idée par phrase.
- Rédige à la 1re personne ("Je vois", "Je retrouve", "Je prescris").

RÈGLES :
- FIDÉLITÉ absolue : n'invente aucune donnée clinique absente de la transcription.
- CORRIGE les termes médicaux et noms de médicaments mal transcrits (ex : "mi-cause"→"mycose", "Omexin"→"Lomexin").
- Range chaque information dans la bonne rubrique. Ne pose pas de diagnostic ferme si l'échange ne le permet pas.`,

  userPromptInstructions: `Remplis chaque champ en PHRASES (une idée par phrase) :
- patient : nom de la patiente (ou "").
- ddn : date de naissance (ou "").
- motif : raison(s) de la consultation du jour.
- histoire : histoire de la maladie / déroulé rapporté par la patiente.
- antecedents : médicaux, chirurgicaux, allergies, traitements, gynéco-obstétricaux, DDR.
- examen : une phrase par observation clinique.
- conclusion : diagnostic ou hypothèses.
- conduite_a_tenir : une phrase par décision (examens, suivi, orientation).
- prescriptions : une phrase par médicament (avec posologie, noms corrigés).

N'invente rien ; laisse "" si l'information est absente.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '               COMPTE-RENDU DE CONSULTATION\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    const nom = (summary.patient && String(summary.patient).trim()) ? String(summary.patient).trim() : '[Nom]';
    const ddn = (summary.ddn && String(summary.ddn).trim()) ? String(summary.ddn).trim() : '[DDN]';
    const motifTxt = (summary.motif && String(summary.motif).trim()) ? String(summary.motif).trim().replace(/\.$/, '') : '[motif]';
    output += `Je vois ce jour Mme ${nom}, née le ${ddn}, pour : ${motifTxt}.\n\n`;

    const sec = (title, val) => {
      const t = asSentences(val);
      if (!t) return;
      output += title + '\n' + line + t + '\n\n';
    };

    sec('HISTOIRE DE LA MALADIE', summary.histoire);
    sec('ANTÉCÉDENTS', summary.antecedents);
    sec('EXAMEN', summary.examen);
    sec('CONCLUSION / DIAGNOSTIC', summary.conclusion);
    sec('CONDUITE À TENIR', summary.conduite_a_tenir);
    sec('PRESCRIPTIONS', summary.prescriptions);

    if (summary.keywords && summary.keywords.length > 0) {
      output += 'MOTS-CLÉS\n' + line + summary.keywords.join(', ') + '\n';
    }
    return output;
  }
};
