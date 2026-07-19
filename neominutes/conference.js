/**
 * NeoMinutes - Template: Congrès / Conférence
 * Synthèse de l'intervention d'un orateur (congrès, symposium, webinaire).
 */

const asLines = (val) => {
  if (val == null) return '';
  if (Array.isArray(val)) return val.filter(Boolean).map(v => `- ${String(v).trim()}`).join('\n');
  return String(val).trim();
};

module.exports = {
  id: 'conference',
  name: '🎤 Congrès / Conférence',
  description: "Synthèse de l'intervention d'un orateur (congrès, symposium, webinaire)",
  fields: ['orateur', 'sujet', 'these', 'points_cles', 'donnees_chiffres', 'take_home', 'questions'],
  arrayFields: ['points_cles', 'donnees_chiffres', 'take_home', 'questions'],

  systemPrompt: `Tu es un rapporteur scientifique qui synthétise l'intervention d'un orateur lors d'un congrès ou d'une conférence, à partir de la transcription.

OBJECTIF : restituer clairement le propos de l'orateur pour quelqu'un qui n'était pas présent.
RÈGLES :
- Reste fidèle : n'ajoute aucune donnée absente de la transcription.
- Corrige les termes techniques, noms d'études, molécules ou auteurs mal transcrits.
- Distingue bien la thèse principale, les arguments/données, et les messages à retenir.
- Ton professionnel, synthétique, orienté "ce qu'il faut retenir".`,

  userPromptInstructions: `Synthétise l'intervention :
- ORATEUR : nom / fonction / affiliation si mentionnés (sinon vide).
- SUJET : le thème précis de l'intervention.
- THESE : le message central / la position défendue (2-4 phrases).
- POINTS_CLES : arguments et idées principales (liste).
- DONNEES_CHIFFRES : chiffres, études, résultats cités (liste ; vide si aucun).
- TAKE_HOME : messages à retenir / implications pratiques (liste).
- QUESTIONS : questions du public et réponses, ou points en débat (liste ; vide si aucun).

N'invente aucune donnée chiffrée ni référence.`,

  formatOutput: (summary) => {
    const line = '─────────────────────────────────────────────────────────\n';
    let output = '';
    output += '═══════════════════════════════════════════════════════════\n';
    output += '              SYNTHÈSE D\'INTERVENTION\n';
    output += '═══════════════════════════════════════════════════════════\n\n';

    if (summary.sujet && String(summary.sujet).trim()) {
      output += String(summary.sujet).trim() + '\n';
    }
    if (summary.orateur && String(summary.orateur).trim()) {
      output += 'Orateur : ' + String(summary.orateur).trim() + '\n';
    }
    output += '\n';

    const sec = (title, val) => {
      const t = asLines(val);
      if (!t) return;
      output += title + '\n' + line + t + '\n\n';
    };

    sec('THÈSE PRINCIPALE', summary.these);
    sec('POINTS CLÉS', summary.points_cles);
    sec('DONNÉES & CHIFFRES', summary.donnees_chiffres);
    sec('À RETENIR (TAKE-HOME)', summary.take_home);
    sec('QUESTIONS / DÉBAT', summary.questions);

    if (summary.keywords && summary.keywords.length > 0) {
      output += 'MOTS-CLÉS\n' + line + summary.keywords.join(', ') + '\n';
    }
    return output;
  }
};
