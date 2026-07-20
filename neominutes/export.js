/**
 * NeoMinutes - Routes: Export
 * Export des comptes-rendus en différents formats.
 * Body: { format, template, includeTranscript, content, recipient }
 *   content: 'summary' (défaut) | 'transcript' | 'letter'
 *   recipient: { name, role } pour le courrier médecin (content='letter')
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const recordingModel = require('../models/recording');
const exportWord = require('../services/exportWord');
const exportPdf = require('../services/exportPdf');
const templates = require('../services/summarize');
const storage = require('../services/storage');
const aiText = require('../services/aiText');
const { fireWebhookEvent } = require('../services/webhook');

/**
 * Génère le texte d'un courrier médical COURT et confraternel à partir du compte-rendu (via IA).
 */
async function buildLetterText(recording, summary, templateId, recipient) {
  const crText = templates.formatSummary(templateId, summary || {});
  const dest = (recipient && recipient.name) ? recipient.name : 'Cher(e) Confrère';
  const dateStr = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  const system = `Tu es un médecin qui rédige une COURTE lettre confraternelle à un confrère (médecin traitant / correspondant), à partir d'un compte-rendu de consultation.

FORMAT EXACT (rien d'autre) :
- Ligne 1 : "Courrier médical" (titre).
- Ligne suivante : la date, alignée à droite conceptuellement (ex : "Paris, le ${dateStr}").
- Appel : "${dest}," (si le destinataire est une personne nommée, garde son nom ; sinon "Cher(e) Confrère,").
- CORPS TRÈS SYNTHÉTIQUE, 3 à 6 phrases maximum, style direct et confraternel :
   • 1 phrase : "Je vous adresse votre patiente [Nom si connu] qui consulte pour [motif]."
   • 1-2 phrases : les éléments cliniques essentiels / la conclusion (diagnostic).
   • 1 phrase : "Le traitement prescrit est : [liste courte des médicaments avec posologie]."
   • éventuellement 1 phrase de conduite à tenir / suivi si pertinent.
- Formule de fin : "Bien confraternellement," puis à la ligne "Dr [à compléter]".

RÈGLES STRICTES :
- COURT et factuel. PAS de "notre réunion", PAS de blabla ("je vous remercie de votre attention", "n'hésitez pas à me contacter" => À BANNIR).
- Reste fidèle au compte-rendu, n'invente rien. Corrige les noms de médicaments mal orthographiés.
- Pas de markdown, pas d'astérisques, pas de listes à puces : des phrases.`;
  const user = `Date : ${dateStr}
Destinataire : ${dest}
Patient / sujet : ${recording.title || ''}

=== COMPTE-RENDU SOURCE ===
${crText}
=== FIN ===

Rédige la lettre COURTE, prête à imprimer, en respectant exactement le format demandé.`;
  const txt = await aiText.chat(system, user, { temperature: 0.2, maxTokens: 900 });
  return txt || crText;
}

router.post('/recordings/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      format = 'docx',            // docx, pdf, markdown, txt
      template,
      includeTranscript = false,
      content = 'summary',        // summary | transcript | letter
      recipient = null
    } = req.body;

    const allowedFormats = ['docx', 'pdf', 'markdown', 'txt'];
    if (!allowedFormats.includes(format)) {
      return res.status(400).json({ error: 'Format invalide', message: `Format "${format}" non supporté`, allowed: allowedFormats });
    }

    const recording = recordingModel.getById(id);
    if (!recording) {
      return res.status(404).json({ error: 'Non trouvé', message: `Enregistrement ${id} introuvable` });
    }

    // Transcription (nécessaire pour content transcript, ou si demandée, ou txt/markdown)
    let transcript = null;
    if (content === 'transcript' || includeTranscript || format === 'txt' || format === 'markdown') {
      const transcriptData = recordingModel.getTranscript(id);
      transcript = transcriptData?.content || null;
    }

    // Résumé
    let summary = null;
    let templateId = template || recording.summary?.template || 'auto';
    if (content !== 'transcript') {
      const summaryData = recordingModel.getSummary(id);
      summary = summaryData?.data || null;
      if (summaryData && summaryData.template) templateId = template || summaryData.template;
      if (!summary && content !== 'transcript') {
        return res.status(400).json({ error: 'Pas de résumé', message: 'Générez d\'abord un compte-rendu' });
      }
    }

    console.log(`[Export] ${id} format=${format} content=${content}`);

    let result;

    if (format === 'pdf') {
      if (content === 'letter') {
        const letterText = await buildLetterText(recording, summary, templateId, recipient);
        result = await exportPdf.generatePdf({ recording, summary, templateId, mode: 'letter', letterText });
      } else if (content === 'transcript') {
        result = await exportPdf.generatePdf({ recording, transcript, mode: 'transcript' });
      } else {
        result = await exportPdf.generatePdf({ recording, transcript, summary, templateId, mode: 'summary', includeTranscript });
      }
    } else if (format === 'docx') {
      result = await exportWord.generateWord({ recording, transcript, summary, templateId, format: 'docx', includeTranscript });
    } else if (format === 'markdown') {
      result = await generateMarkdown(id, recording, transcript, summary, templateId, includeTranscript);
    } else { // txt
      result = await generateTxt(id, recording, transcript, includeTranscript);
    }

    recordingModel.saveExport(id, format, templateId, result.filePath, result.fileSize, includeTranscript);
    const fileUrl = storage.getPublicUrl(result.filePath);
    console.log(`[Export] Terminé: ${id} - ${result.fileSize} bytes`);
    fireWebhookEvent('export.complete', { recordingId: id, format, fileSize: result.fileSize });

    res.json({ success: true, fileUrl, filePath: result.filePath, filename: result.filename, size: result.fileSize, format, content });
  } catch (error) {
    console.error('[Export] Erreur:', error);
    res.status(500).json({ error: 'Erreur d\'export', message: error.message });
  }
});

/**
 * Générer un export Markdown
 */
async function generateMarkdown(id, recording, transcript, summary, templateId, includeTranscript) {
  const templatesService = require('../services/summarize');
  const fs = require('fs');

  let content = '';
  content += `# ${recording.title || 'Compte-rendu'}\n\n`;
  content += `*Généré le ${new Date(recording.createdAt).toLocaleDateString('fr-FR')}*\n\n`;
  if (recording.participants?.length) content += `**Participants:** ${recording.participants.join(', ')}\n\n`;
  if (recording.tags?.length) content += `**Tags:** ${recording.tags.join(', ')}\n\n`;
  content += '---\n\n';
  if (summary) content += templatesService.formatSummary(templateId, summary) + '\n\n';
  if (includeTranscript && transcript) {
    content += '---\n\n## Transcription complète\n\n' + transcript + '\n';
  }
  content += '\n---\n*Généré par NeoMinutes*\n';

  const outputDir = path.join(__dirname, '..', '..', 'exports');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filename = `neominutes-${id}-${Date.now()}.md`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return { filePath, fileSize: fs.statSync(filePath).size, filename };
}

/**
 * Générer un export TXT simple
 */
async function generateTxt(id, recording, transcript, includeTranscript) {
  const fs = require('fs');
  let content = '';
  content += '═════════════════════════════════════════════════════════════\n';
  content += `  ${recording.title || 'COMPTE-RENDU'}\n`;
  content += '═════════════════════════════════════════════════════════════\n\n';
  content += `Date: ${new Date(recording.createdAt).toLocaleDateString('fr-FR')}\n`;
  if (recording.participants?.length) content += `Participants: ${recording.participants.join(', ')}\n`;
  content += '\n─────────────────────────────────────────────────────────────\n\n';
  if (includeTranscript && transcript) content += 'TRANSCRIPTION\n\n' + transcript + '\n';
  content += '\n─────────────────────────────────────────────────────────────\n';
  content += 'Généré par NeoMinutes\n';

  const outputDir = path.join(__dirname, '..', '..', 'exports');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filename = `neominutes-${id}-${Date.now()}.txt`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return { filePath, fileSize: fs.statSync(filePath).size, filename };
}

/**
 * GET /recordings/:id/exports - Lister les exports
 */
router.get('/recordings/:id/exports', async (req, res) => {
  try {
    const { id } = req.params;
    const exports = recordingModel.getExports(id);
    const exportsWithUrls = exports.map(e => ({ ...e, fileUrl: storage.getPublicUrl(e.filePath) }));
    res.json({ success: true, exports: exportsWithUrls });
  } catch (error) {
    console.error('[Export] Erreur liste:', error);
    res.status(500).json({ error: 'Erreur serveur', message: error.message });
  }
});

module.exports = router;
