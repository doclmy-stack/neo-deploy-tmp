/**
 * NeoMinutes - Template: Consultation
 * CR de consultation orienté patient (médical/paramédical). Proche de
 * medical_cr mais centré sur le déroulé d'une consultation individuelle.
 */

const asLines = (val) => {
  if (val == null) return '';
  if (Array.isArray(val)) return val.filter(Boolean).map(v => `- ${String(v).trim()}`).join('\n');
  return String(val).trim();
};

module.exports = {
  id: 'consultation',
  name: '🩺 Consultation',
  description: 'Compte-rendu de consultation (motif, examen, conduite à tenir)',
  fields: ['motif', 'histoire', 'antecedents', 'examen', 'conclusion', 'conduite_a_tenir', 'prescriptions'],
  arrayFields: ['examen', 'prescriptions'],

  systemPrompt: `Tu es un praticien qui rédige le compte-rendu d'une consultation à partir de la transcription (parfois imparfaite) de l'échange.

RÈGLES :
- FIDÉLITÉ absolue : n'invente aucune donnée clinique absente de la transcription.
- CORRIGE les termes médicaux et noms de médicaments mal transcrits (ex. "mi-cause"→"mycose", "Omexin"→"Lomexin").
- Range chaque information dans la bonne rubrique.
- Langage professionnel, clair. Utilise des puces quand il y a plusieurs éléments.
- Ne pose pas de diagnostic ferme si l'échange ne le permet pas : formule des hypothèses.`,

  userPromptInstructions: `Rédige le compte-rendu de consultation :
- MOTIF : raison(s) de la consultation.
- HISTOIRE : histoire de la maladie / déroulé rapporté par le patient.
- ANTECEDENTS : médicaux, chirurgicaux, allergies, traitements en cours (gynéco/obstétricaux et DDR si pertinent).
- EXAMEN : symptômes + observations cliniques (liste).
- CONCLUSION : diagnostic ou hypothèses.
- CONDUITE_A_TENIR : examens complémentaires, suivi, orientation.
- PRESCRIPTIONS : médicaments et posologies si mentionnés (liste, noms corrigés).

N'invente rien.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '               COMPTE-RENDU DE CONSULTATION\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    const sec = (title, val) => {
      const t = asLines(val);
      if (!t) return;
      output += title + '\n' + line + t + '\n\n';
    };

    sec('MOTIF', summary.motif);
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
