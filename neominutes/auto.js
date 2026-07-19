/**
 * NeoMinutes - Template: Automatique / Universel
 * L'IA détecte elle-même la nature de l'enregistrement (médical, réunion,
 * congrès, appel, cours, culture, perso...) et produit le compte-rendu le
 * plus adapté. Modèle "passe-partout" par défaut.
 */

const asLines = (val) => {
  if (val == null) return '';
  if (Array.isArray(val)) return val.filter(Boolean).map(v => `- ${String(v).trim()}`).join('\n');
  return String(val).trim();
};

module.exports = {
  id: 'auto',
  name: '🪄 Automatique (universel)',
  description: "Détecte tout seul le type d'enregistrement et produit le meilleur compte-rendu",
  fields: ['type_detecte', 'titre', 'resume', 'points_cles', 'decisions', 'actions', 'details'],
  arrayFields: ['points_cles', 'decisions', 'actions'],

  systemPrompt: `Tu es un assistant expert capable de rédiger un compte-rendu clair de N'IMPORTE QUEL enregistrement audio, quel que soit le domaine : médical, réunion professionnelle, conférence/congrès, appel téléphonique ou WhatsApp, consultation, cours, entretien, événement culturel (spectacle, expo, film, lecture), note personnelle, etc.

DÉMARCHE :
1. Détermine d'abord la NATURE de l'enregistrement (le "type_detecte", en 2-4 mots, ex : "Consultation médicale", "Réunion d'équipe", "Conférence de congrès", "Appel commercial", "Note personnelle", "Visite d'exposition").
2. Adapte le style et le vocabulaire à ce contexte (professionnel et précis en médical/business ; plus libre en culture/perso).
3. Produis un compte-rendu fidèle, structuré et utile.

RÈGLES : n'invente RIEN qui ne soit dans la transcription. Corrige les erreurs manifestes de transcription automatique (mots/noms propres/termes techniques phonétiquement déformés). Reste synthétique mais complet.`,

  userPromptInstructions: `Analyse la transcription et rédige un compte-rendu universel :
- TYPE_DETECTE : la nature de l'enregistrement (courte étiquette).
- TITRE : un titre court et parlant.
- RESUME : 3 à 6 phrases qui capturent l'essentiel.
- POINTS_CLES : les idées / informations importantes (liste).
- DECISIONS : décisions ou conclusions prises (liste ; vide si aucune).
- ACTIONS : tâches / suites à donner, avec qui/quand si mentionné (liste ; vide si aucune).
- DETAILS : développement complémentaire utile selon le contexte (paragraphe(s)).

Adapte la profondeur au contenu. Ne mets pas d'information inventée.`,

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
      const t = asLines(val);
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
