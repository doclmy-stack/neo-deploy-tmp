/**
 * NeoMinutes - Templates de résumé
 * Chaque template définit la structure et le prompt pour générer un résumé
 */

const path = require('path');

// Importer tous les templates
const templates = {
  // 🪄 Mode universel (détection auto) — placé en premier = choix par défaut logique
  auto: require('../templates/auto'),
  // Médical
  medical_cr: require('../templates/medical_cr'),
  consultation: require('../templates/consultation'),
  rcp: require('../templates/rcp'),
  // Professionnel / business
  meeting_pv: require('../templates/meeting_pv'),
  conference: require('../templates/conference'),
  call_notes: require('../templates/call_notes'),
  interview: require('../templates/interview'),
  client_brief: require('../templates/client_brief'),
  sales_call: require('../templates/sales_call'),
  legal: require('../templates/legal'),
  // Formation
  course_notes: require('../templates/course_notes'),
  // Perso / culture
  culture: require('../templates/culture'),
  personal_note: require('../templates/personal_note')
};

function getTemplate(id) {
  return templates[id] || null;
}

function getAllTemplates() {
  return Object.entries(templates).map(([id, template]) => ({
    id,
    name: template.name,
    description: template.description,
    fields: template.fields,
    isCustom: template.isCustom || false
  }));
}

function getSystemPrompt(templateId, language = 'fr') {
  const template = getTemplate(templateId);
  if (!template) {
    return getGenericPrompt(language);
  }
  let prompt = template.systemPrompt || '';
  if (language === 'fr') {
    prompt += '\n\nTu répondras entièrement en français.';
  } else if (language === 'en') {
    prompt += '\n\nYou will respond entirely in English.';
  }
  return prompt;
}

function getUserPrompt(transcript, templateId, length = 'standard') {
  const template = getTemplate(templateId);
  const lengthInstructions = getLengthInstructions(length);

  let prompt = `Voici la transcription d'un enregistrement audio:\n\n`;
  prompt += `=== TRANSCRIPTION ===\n${transcript}\n=== FIN ===\n\n`;
  prompt += lengthInstructions + '\n\n';

  if (template && template.userPromptInstructions) {
    prompt += template.userPromptInstructions + '\n\n';
  }

  // Directive JSON stricte basée sur les champs du template (indispensable pour le parsing).
  const fields = (template && Array.isArray(template.fields) && template.fields.length)
    ? template.fields
    : ['executive', 'decisions', 'actions', 'openQuestions'];
  // Certains champs sont des LISTES (rendus en puces) : le template peut les déclarer via arrayFields.
  const arrayFields = (template && Array.isArray(template.arrayFields)) ? template.arrayFields : ['decisions', 'actions'];
  const schemaParts = fields.map(f => arrayFields.includes(f)
    ? `"${f}": ["élément1", "élément2"]`
    : `"${f}": "texte"`);
  const schema = '{ ' + schemaParts.join(', ') + ', "keywords": ["mot1", "mot2"] }';
  prompt += `\nRÉPONDS UNIQUEMENT avec un objet JSON valide (aucun texte avant ou après), avec EXACTEMENT ces clés :\n`;
  prompt += schema + '\n';
  prompt += `Les champs entre crochets [] sont des tableaux (listes) ; les autres sont des chaînes de texte. "keywords" est un tableau. Rédige en français. Mets "" ou [] si l'information est absente. N'invente rien.`;

  return prompt;
}

function getLengthInstructions(length) {
  switch (length) {
    case 'brief':
      return `Génère un résumé TRÈS CONCIS (2-3 phrases max) qui capture l'essentiel.`;
    case 'detailed':
      return `Génère un résumé DÉTAILLÉ avec toutes les informations importantes, tous les noms, dates et décisions mentionnées. Sois exhaustif.`;
    case 'standard':
    default:
      return `Génère un résumé structuré qui capture les points essentiels, les décisions et les actions à mener.`;
  }
}

function formatSummary(templateId, summaryData) {
  const template = getTemplate(templateId);
  if (template && template.formatOutput) {
    return template.formatOutput(summaryData);
  }
  return formatGenericSummary(summaryData);
}

function formatGenericSummary(data) {
  let output = '';
  if (data.executive) output += `## Résumé exécutif\n\n${data.executive}\n\n`;
  if (data.decisions && data.decisions.length > 0) {
    output += `## Décisions\n\n`;
    data.decisions.forEach((d, i) => { output += `${i + 1}. ${d}\n`; });
    output += '\n';
  }
  if (data.actions && data.actions.length > 0) {
    output += `## Actions à mener\n\n`;
    data.actions.forEach((a, i) => { output += `${i + 1}. ${a}\n`; });
    output += '\n';
  }
  if (data.openQuestions && data.openQuestions.length > 0) {
    output += `## Questions ouvertes\n\n`;
    data.openQuestions.forEach((q) => { output += `- ${q}\n`; });
    output += '\n';
  }
  if (data.keywords && data.keywords.length > 0) {
    output += `## Mots-clés\n\n${data.keywords.join(', ')}\n`;
  }
  return output;
}

function getGenericPrompt(language = 'fr') {
  const prompts = {
    fr: `Tu es un assistant expert en résumé de réunions et documents.
Analyse la transcription et extrais les informations essentielles.
Réponds uniquement en JSON valide avec: executive, decisions[], actions[], openQuestions[], keywords[].`,
    en: `You are an expert meeting/document summarizer.
Analyze the transcription and extract essentials.
Respond only in valid JSON with: executive, decisions[], actions[], openQuestions[], keywords[].`
  };
  return prompts[language] || prompts.fr;
}

/**
 * Parser la réponse JSON du LLM (robuste)
 */
function parseLLMResponse(responseText) {
  if (responseText && typeof responseText === 'object') return responseText;
  try {
    const jsonMatch = String(responseText).match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(responseText);
  } catch (error) {
    console.error('[Templates] Erreur parsing JSON:', error.message);
    return { executive: String(responseText || ''), decisions: [], actions: [], openQuestions: [], keywords: [] };
  }
}

module.exports = {
  getTemplate,
  getAllTemplates,
  getSystemPrompt,
  getUserPrompt,
  formatSummary,
  parseLLMResponse,
  getLengthInstructions
};
