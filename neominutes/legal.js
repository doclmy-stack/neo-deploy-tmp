/**
 * NeoMinutes - Template: Juridique / Administratif
 * Rendez-vous notaire, avocat, banque, assurance, administration.
 */

const asLines = (val) => {
  if (val == null) return '';
  if (Array.isArray(val)) return val.filter(Boolean).map(v => `- ${String(v).trim()}`).join('\n');
  return String(val).trim();
};

module.exports = {
  id: 'legal',
  name: '⚖️ Juridique / Administratif',
  description: 'RDV notaire, avocat, banque, assurance, administration',
  fields: ['objet', 'parties', 'points_abordes', 'engagements', 'documents', 'echeances', 'prochaines_etapes'],
  arrayFields: ['points_abordes', 'engagements', 'documents', 'echeances'],

  systemPrompt: `Tu es un assistant qui rédige le compte-rendu d'un rendez-vous juridique ou administratif (notaire, avocat, banque, assurance, administration), à partir de la transcription.

RÈGLES :
- Grande PRÉCISION : montants, dates, noms, références de dossier doivent être restitués exactement (corrige seulement les erreurs manifestes de transcription, sans jamais inventer un chiffre).
- Mets en évidence les engagements de chaque partie et les échéances.
- Ne donne PAS de conseil juridique : tu restitues ce qui a été dit.
- Ton factuel et rigoureux.`,

  userPromptInstructions: `Rédige le compte-rendu :
- OBJET : nature du rendez-vous / dossier.
- PARTIES : personnes/organismes présents (noms, rôles).
- POINTS_ABORDES : sujets traités (liste).
- ENGAGEMENTS : ce que chaque partie s'engage à faire (liste).
- DOCUMENTS : documents évoqués, remis ou à fournir (liste).
- ECHEANCES : dates et délais importants (liste).
- PROCHAINES_ETAPES : suite du dossier (paragraphe).

Restitue exactement montants, dates et références. N'invente rien.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '            COMPTE-RENDU JURIDIQUE / ADMINISTRATIF\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    if (summary.objet && String(summary.objet).trim()) {
      output += String(summary.objet).trim() + '\n';
    }
    if (summary.parties && String(summary.parties).trim()) {
      output += 'Parties : ' + String(summary.parties).trim() + '\n';
    }
    output += '\n';

    const sec = (title, val) => {
      const t = asLines(val);
      if (!t) return;
      output += title + '\n' + line + t + '\n\n';
    };

    sec('POINTS ABORDÉS', summary.points_abordes);
    sec('ENGAGEMENTS', summary.engagements);
    sec('DOCUMENTS', summary.documents);
    sec('ÉCHÉANCES', summary.echeances);
    sec('PROCHAINES ÉTAPES', summary.prochaines_etapes);

    if (summary.keywords && summary.keywords.length > 0) {
      output += 'MOTS-CLÉS\n' + line + summary.keywords.join(', ') + '\n';
    }
    return output;
  }
};
