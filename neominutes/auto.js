/**
 * NeoMinutes - Template: Automatique / Universel — STYLE RÉDIGÉ
 * L'IA détecte la nature de l'enregistrement et produit un compte-rendu
 * en phrases complètes, une idée par ligne.
 */

// Découpe en phrases → une par ligne (chaque phrase terminée par un point).
const asSentences = (val) => {
  if (val == null) return '';
  let raw = Array.isArray(val) ? val.join('. ') : String(val);
  raw = raw.replace(/\s*[-•]\s*/g, '. ').replace(/\s*;\s*/g, '. ');
  const parts = raw.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  return parts.map(s => (/[.!?]$/.test(s) ? s : s + '.')).join('\n');
};

module.exports = {
  id: 'auto',
  name: '🪄 Automatique (universel)',
  description: "Détecte tout seul le type d'enregistrement et produit le meilleur compte-rendu",
  fields: ['type_detecte', 'titre', 'resume', 'points_cles', 'decisions', 'actions', 'details'],

  systemPrompt: `Tu es un assistant expert capable de rédiger un compte-rendu clair de N'IMPORTE QUEL enregistrement audio, quel que soit le domaine : médical, réunion professionnelle, conférence/congrès, appel téléphonique ou WhatsApp, consultation, cours, entretien, événement culturel (spectacle, expo, film, lecture), note personnelle, etc.

STYLE OBLIGATOIRE : des PHRASES COMPLÈTES et fluides, UNE seule idée par phrase (pas de style télégraphique, pas de puces).

DÉMARCHE :
1. Détermine d'abord la NATURE de l'enregistrement (le "type_detecte", en 2-4 mots, ex : "Consultation médicale", "Réunion d'équipe", "Conférence de congrès", "Appel commercial", "Note personnelle").
2. Adapte le style et le vocabulaire à ce contexte.
3. Produis un compte-rendu fidèle et utile.

RÈGLES : n'invente RIEN qui ne soit dans la transcription. Corrige les erreurs manifestes de transcription (mots/noms propres/termes techniques déformés).`,

  userPromptInstructions: `Analyse la transcription et rédige un compte-rendu universel EN PHRASES (une idée par phrase) :
- TYPE_DETECTE : la nature de l'enregistrement (courte étiquette).
- TITRE : un titre court et parlant.
- RESUME : 3 à 6 phrases qui capturent l'essentiel.
- POINTS_CLES : les idées importantes, une phrase complète par idée.
- DECISIONS : décisions/conclusions, une phrase chacune (ou "" si aucune).
- ACTIONS : tâches/suites à donner, une phrase chacune (qui/quand si mentionné ; "" si aucune).
- DETAILS : développement complémentaire en phrases.

Ne mets pas d'information inventée.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '                     COMPTE-RENDU\n';
    if (summary.type_detecte && String(summary.type_detecte).trim()) {
      output += '        (' + String(summary.type_detecte).trim() + ')\n';
    }
    output += '═══════════════════════════════════════════════════════════\n\n';

    if (summary.titre && String(summary.titre).trim()) {
      output += String(summary.titre).trim() + '\n\n';
    }

    const sec = (title, val) => {
      const t = asSentences(val);
      if (!t) return;
      output += title + '\n' + line + t + '\n\n';
    };

    sec('RÉSUMÉ', summary.resume);
    sec('POINTS CLÉS', summary.points_cles);
    sec('DÉCISIONS', summary.decisions);
    sec('ACTIONS À MENER', summary.actions);
    sec('DÉTAILS', summary.details);

    if (summary.keywords && summary.keywords.length > 0) {
      output += 'MOTS-CLÉS\n' + line + summary.keywords.join(', ') + '\n';
    }
    return output;
  }
};
