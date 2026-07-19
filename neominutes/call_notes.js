/**
 * NeoMinutes - Template: Appel / Concall / WhatsApp
 * Pour les échanges informels (appel tél, conf call, note vocale WhatsApp).
 */

const asLines = (val) => {
  if (val == null) return '';
  if (Array.isArray(val)) return val.filter(Boolean).map(v => `- ${String(v).trim()}`).join('\n');
  return String(val).trim();
};

module.exports = {
  id: 'call_notes',
  name: '💬 Appel / Concall / WhatsApp',
  description: "Résumé d'un appel téléphonique, d'une conf call ou d'une note vocale",
  fields: ['interlocuteurs', 'objet', 'points_cles', 'decisions', 'actions', 'a_recontacter'],
  arrayFields: ['points_cles', 'decisions', 'actions'],

  systemPrompt: `Tu es un assistant qui transforme un échange informel (appel téléphonique, conférence téléphonique, note vocale WhatsApp) en un résumé clair et actionnable, à partir de la transcription.

RÈGLES :
- Va à l'essentiel : les échanges parlés contiennent des digressions, garde ce qui compte.
- Identifie qui dit quoi quand c'est possible.
- Mets en avant ce qui doit être fait ensuite.
- N'invente rien. Ton naturel et direct.`,

  userPromptInstructions: `Résume l'échange :
- INTERLOCUTEURS : personnes impliquées (noms/rôles si connus).
- OBJET : de quoi il s'agit (1-2 phrases).
- POINTS_CLES : ce qui s'est dit d'important (liste).
- DECISIONS : ce qui a été décidé / convenu (liste ; vide si aucune).
- ACTIONS : ce que chacun doit faire, avec échéance si mentionnée (liste).
- A_RECONTACTER : personnes à rappeler / relances à prévoir (texte ; vide si aucune).

N'invente rien.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '                   NOTES D\'APPEL\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    if (summary.objet && String(summary.objet).trim()) {
      output += String(summary.objet).trim() + '\n';
    }
    if (summary.interlocuteurs && String(summary.interlocuteurs).trim()) {
      output += 'Interlocuteurs : ' + String(summary.interlocuteurs).trim() + '\n';
    }
    output += '\n';

    const sec = (title, val) => {
      const t = asLines(val);
      if (!t) return;
      output += title + '\n' + line + t + '\n\n';
    };

    sec('POINTS CLÉS', summary.points_cles);
    sec('DÉCISIONS', summary.decisions);
    sec('ACTIONS À MENER', summary.actions);
    sec('À RECONTACTER / RELANCES', summary.a_recontacter);

    if (summary.keywords && summary.keywords.length > 0) {
      output += 'MOTS-CLÉS\n' + line + summary.keywords.join(', ') + '\n';
    }
    return output;
  }
};
