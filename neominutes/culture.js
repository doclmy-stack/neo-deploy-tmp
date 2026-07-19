/**
 * NeoMinutes - Template: Culture / Loisir / Art
 * Pour une visite d'expo, un spectacle, un film, une lecture, un podcast, etc.
 */

const asLines = (val) => {
  if (val == null) return '';
  if (Array.isArray(val)) return val.filter(Boolean).map(v => `- ${String(v).trim()}`).join('\n');
  return String(val).trim();
};

module.exports = {
  id: 'culture',
  name: '🎨 Culture / Loisir / Art',
  description: 'Notes sur une expo, un spectacle, un film, une lecture, un podcast…',
  fields: ['oeuvre', 'contexte', 'resume', 'moments_forts', 'reflexions', 'a_retenir'],
  arrayFields: ['moments_forts', 'a_retenir'],

  systemPrompt: `Tu es un chroniqueur culturel qui met en forme des notes personnelles prises à propos d'une expérience culturelle ou de loisir (exposition, spectacle, concert, film, livre, podcast, visite, voyage...), à partir de la transcription.

RÈGLES :
- Restitue fidèlement le ressenti et les observations exprimés.
- Ton vivant et personnel, sans jargon.
- N'invente pas de faits (dates, noms d'auteurs/artistes) non mentionnés ; corrige ceux qui sont manifestement mal transcrits.`,

  userPromptInstructions: `Mets en forme ces notes :
- OEUVRE : ce dont il s'agit (titre, artiste, lieu si mentionnés).
- CONTEXTE : cadre de l'expérience (quand, avec qui, où — si mentionné).
- RESUME : de quoi ça parle / ce qui a été vu ou entendu (quelques phrases).
- MOMENTS_FORTS : ce qui a marqué (liste).
- REFLEXIONS : impressions, analyse, ressenti personnel (paragraphe).
- A_RETENIR : idées, citations, envies (ex : à revoir, à lire, à approfondir) (liste).

Reste fidèle aux propos.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '                  NOTES CULTURE & LOISIR\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    if (summary.oeuvre && String(summary.oeuvre).trim()) {
      output += String(summary.oeuvre).trim() + '\n';
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

    sec('RÉSUMÉ', summary.resume);
    sec('MOMENTS FORTS', summary.moments_forts);
    sec('RÉFLEXIONS', summary.reflexions);
    sec('À RETENIR', summary.a_retenir);

    if (summary.keywords && summary.keywords.length > 0) {
      output += 'MOTS-CLÉS\n' + line + summary.keywords.join(', ') + '\n';
    }
    return output;
  }
};
