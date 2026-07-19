/**
 * NeoMinutes - Template: Entretien / Interview
 * Recrutement RH, entretien journalistique, interview métier.
 */

const asLines = (val) => {
  if (val == null) return '';
  if (Array.isArray(val)) return val.filter(Boolean).map(v => `- ${String(v).trim()}`).join('\n');
  return String(val).trim();
};

module.exports = {
  id: 'interview',
  name: '🎙️ Entretien / Interview',
  description: 'Entretien de recrutement, interview journalistique ou métier',
  fields: ['interviewe', 'contexte', 'themes', 'citations', 'points_forts', 'points_vigilance', 'conclusion'],
  arrayFields: ['themes', 'citations', 'points_forts', 'points_vigilance'],

  systemPrompt: `Tu es un assistant qui rédige la synthèse d'un entretien (recrutement, journalistique ou métier) à partir de la transcription.

RÈGLES :
- Restitue fidèlement les propos de la personne interviewée.
- Distingue les faits, les opinions et les citations mot-à-mot.
- Reste neutre et factuel. N'invente rien.
- Pour un recrutement : fais ressortir points forts et points de vigilance sans jugement excessif.`,

  userPromptInstructions: `Synthétise l'entretien :
- INTERVIEWE : personne interviewée (nom/rôle si connus).
- CONTEXTE : cadre de l'entretien (poste visé, sujet de l'interview…).
- THEMES : sujets abordés (liste).
- CITATIONS : phrases marquantes rapportées mot-à-mot (liste ; vide si aucune).
- POINTS_FORTS : atouts / éléments positifs (liste).
- POINTS_VIGILANCE : réserves / questions en suspens (liste ; vide si aucune).
- CONCLUSION : impression générale / recommandation / suite (paragraphe).

Reste fidèle et neutre.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '                 SYNTHÈSE D\'ENTRETIEN\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    if (summary.interviewe && String(summary.interviewe).trim()) {
      output += String(summary.interviewe).trim() + '\n';
    }
    if (summary.contexte && String(summary.contexte).trim()) {
      output += String(summary.contexte).trim() + '\n';
    }
    output += '\n';

    const sec = (title, val) => {
      const t = asLines(val);
      if (!t) return;
      output += title + '\n' + line + t + '\n\n';
    };

    sec('THÈMES ABORDÉS', summary.themes);
    sec('CITATIONS', summary.citations);
    sec('POINTS FORTS', summary.points_forts);
    sec('POINTS DE VIGILANCE', summary.points_vigilance);
    sec('CONCLUSION', summary.conclusion);

    if (summary.keywords && summary.keywords.length > 0) {
      output += 'MOTS-CLÉS\n' + line + summary.keywords.join(', ') + '\n';
    }
    return output;
  }
};
