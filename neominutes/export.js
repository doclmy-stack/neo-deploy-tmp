/**
 * NeoMinutes - Routes: Export
 * content: 'summary' (défaut) | 'transcript' | 'letter'
 * ⚠️ Pour le PDF/Word en mode summary, on réutilise le full_summary DÉJÀ FORMATÉ
 * (généré avec le bon template) au lieu de le refabriquer avec un template éventuellement
 * différent (sinon le doc ne contient que les mots-clés = bug PDF vide).
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
 * Courrier médical STRUCTURÉ et concis, rédigé par l'IA à partir du compte-rendu.
 */
async function buildLetterText(recording, summaryData, fullSummary, templateId, recipient) {
  const crText = fullSummary || templates.formatSummary(templateId, summaryData || {});
  const dest = (recipient && recipient.name) ? recipient.name : 'Cher(e) Confrère';
  const dateStr = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  const system = `Tu es médecin. Tu rédiges une COURTE lettre confraternelle de SUIVI (compte-rendu adressé au médecin traitant / correspondant), à partir d'un compte-rendu de consultation. Ce n'est PAS une lettre d'orientation : la patiente n'est pas "adressée", on informe le confrère du suivi.

STRUCTURE EXACTE (rien d'autre, pas de markdown, pas d'astérisques) :
Ligne 1 : Courrier médical
Ligne 2 : ${dateStr}
Ligne 3 : (vide)
Ligne 4 : ${dest},
Ligne 5 : (vide)
Puis un corps SYNTHÉTIQUE en phrases courtes (pas de puces), 4 à 7 lignes maximum, couvrant dans l'ordre :
- 1 phrase : "Je vous informe du suivi de votre patiente [Nom si connu], vue en consultation pour [motif]."
- 1 à 2 phrases : les éléments cliniques essentiels et la conclusion (diagnostic).
- 1 phrase : "Conduite à tenir : [suivi/examens]."
- 1 phrase : "Traitement prescrit : [médicaments avec posologie]."
Puis :
Ligne (vide)
Bien confraternellement,
Dr [à compléter]

RÈGLES : COURT et factuel. Interdits : "je vous adresse la patiente", "je vous remercie de votre attention", "n'hésitez pas à me contacter", "notre réunion". Reste fidèle au compte-rendu, n'invente rien, corrige les noms de médicaments.`;
  const user = `Compte-rendu source :\n${crText}\n\nRédige la lettre de suivi COURTE en respectant exactement la structure.`;
  const txt = await aiText.chat(system, user, { temperature: 0.2, maxTokens: 900 });
  return txt || crText;
}

router.post('/recordings/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      format = 'docx',
      template,
      includeTranscript = false,
      content = 'summary',
      recipient = null
    } = req.body;

    const allowedFormats = ['docx', 'pdf', 'markdown', 'txt'];
    if (!allowedFormats.includes(format)) {
      return res.status(400).json({ error: 'Format invalide', message: `Format "${format}" non supporté`, allowed: allowedFormats });
    }

    const recording = recordingModel.getById(id);
    if (!recording) return res.status(404).json({ error: 'Non trouvé', message: `Enregistrement ${id} introuvable` });

    let transcript = null;
    if (content === 'transcript' || includeTranscript || format === 'txt' || format === 'markdown') {
      const transcriptData = recordingModel.getTranscript(id);
      transcript = transcriptData?.content || null;
    }

    // Résumé : on récupère data + full_summary + le template AVEC LEQUEL il a été généré
    let summaryData = null, fullSummary = null;
    let templateId = template || 'auto';
    if (content !== 'transcript') {
      const s = recordingModel.getSummary(id);
      summaryData = s?.data || null;
      fullSummary = s?.full_summary || s?.fullSummary || null;
      // ⚠️ priorité au template réellement utilisé pour générer (sinon PDF vide)
      if (s && s.template) templateId = s.template;
      if (!summaryData && !fullSummary) {
        return res.status(400).json({ error: 'Pas de résumé', message: 'Générez d\'abord un compte-rendu' });
      }
    }

    console.log(`[Export] ${id} format=${format} content=${content} template=${templateId}`);

    let result;
    if (format === 'pdf') {
      if (content === 'letter') {
        const letterText = await buildLetterText(recording, summaryData, fullSummary, templateId, recipient);
        result = await exportPdf.generatePdf({ recording, mode: 'letter', letterText });
      } else if (content === 'transcript') {
        result = await exportPdf.generatePdf({ recording, transcript, mode: 'transcript' });
      } else {
        // summary : on passe le texte DÉJÀ formaté (fiable)
        result = await exportPdf.generatePdf({ recording, summary: summaryData, fullSummary, templateId, mode: 'summary', includeTranscript, transcript });
      }
    } else if (format === 'docx') {
      result = await exportWord.generateWord({ recording, transcript, summary: summaryData, templateId, format: 'docx', includeTranscript });
    } else if (format === 'markdown') {
      result = await generateMarkdown(id, recording, transcript, summaryData, fullSummary, templateId, includeTranscript);
    } else {
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

async function generateMarkdown(id, recording, transcript, summaryData, fullSummary, templateId, includeTranscript) {
  const fs = require('fs');
  let content = '';
  content += `# ${recording.title || 'Compte-rendu'}\n\n`;
  content += `*Généré le ${new Date(recording.createdAt).toLocaleDateString('fr-FR')}*\n\n---\n\n`;
  content += (fullSummary || templates.formatSummary(templateId, summaryData || {})) + '\n\n';
  if (includeTranscript && transcript) content += '---\n\n## Transcription complète\n\n' + transcript + '\n';
  content += '\n---\n*Généré par NeoMinutes*\n';
  const outputDir = path.join(__dirname, '..', '..', 'exports');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filename = `neominutes-${id}-${Date.now()}.md`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return { filePath, fileSize: fs.statSync(filePath).size, filename };
}

async function generateTxt(id, recording, transcript, includeTranscript) {
  const fs = require('fs');
  let content = '';
  content += `${recording.title || 'COMPTE-RENDU'}\n`;
  content += `Date: ${new Date(recording.createdAt).toLocaleDateString('fr-FR')}\n\n`;
  if (includeTranscript && transcript) content += 'TRANSCRIPTION\n\n' + transcript + '\n';
  content += '\nGénéré par NeoMinutes\n';
  const outputDir = path.join(__dirname, '..', '..', 'exports');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filename = `neominutes-${id}-${Date.now()}.txt`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return { filePath, fileSize: fs.statSync(filePath).size, filename };
}

router.get('/recordings/:id/exports', async (req, res) => {
  try {
    const { id } = req.params;
    const exports = recordingModel.getExports(id);
    const exportsWithUrls = exports.map(e => ({ ...e, fileUrl: storage.getPublicUrl(e.filePath) }));
    res.json({ success: true, exports: exportsWithUrls });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur', message: error.message });
  }
});

module.exports = router;
