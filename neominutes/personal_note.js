/**
 * NeoMinutes - Template: Note personnelle / Brainstorm
 * Capture d'idées en vrac (mémo vocal, réflexion, journal) → structuré.
 */

const asLines = (val) => {
  if (val == null) return '';
  if (Array.isArray(val)) return val.filter(Boolean).map(v => `- ${String(v).trim()}`).join('\n');
  return String(val).trim();
};

module.exports = {
  id: 'personal_note',
  name: '📝 Note perso / Brainstorm',
  description: "Met de l'ordre dans un mémo vocal ou une réflexion en vrac",
  fields: ['sujet', 'idees', 'a_faire', 'a_approfondir', 'synthese'],
  arrayFields: ['idees', 'a_faire', 'a_approfondir'],

  systemPrompt: `Tu es un assistant personnel qui met de l'ordre dans les idées dictées en vrac (mémo vocal, brainstorm, journal, réflexion à voix haute), à partir de la transcription.

RÈGLES :
- Clarifie et regroupe les idées sans en perdre.
- Respecte l'intention et le ton de la personne (c'est SA pensée).
- N'ajoute pas d'idées qui ne sont pas là. Corrige seulement la forme.
- Transforme les intentions en tâches concrètes quand c'est pertinent.`,

  userPromptInstructions: `Structure ces notes :
- SUJET : de quoi ça parle (1 phrase).
- IDEES : les idées exprimées, regroupées et clarifiées (liste).
- A_FAIRE : les actions/intentions concrètes (liste ; vide si aucune).
- A_APPROFONDIR : questions ouvertes, pistes à explorer (liste ; vide si aucune).
- SYNTHESE : un court paragraphe qui remet tout au clair.

N'ajoute rien qui ne soit pas dans les propos.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '                     NOTE PERSONNELLE\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    if (summary.sujet && String(summary.sujet).trim()) {
      output += String(summary.sujet).trim() + '\n\n';
    }

    const sec = (title, val) => {
      const t = asLines(val);
      if (!t) return;
      output += title + '\n' + line + t + '\n\n';
    };

    sec('IDÉES', summary.idees);
    sec('À FAIRE', summary.a_faire);
    sec('À APPROFONDIR', summary.a_approfondir);
    sec('SYNTHÈSE', summary.synthese);

    if (summary.keywords && summary.keywords.length > 0) {
      output += 'MOTS-CLÉS\n' + line + summary.keywords.join(', ') + '\n';
    }
    return output;
  }
};
