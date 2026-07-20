/**
 * NeoMinutes - Routes: Export
 * content: 'summary' (défaut) | 'transcript' | 'letter'
 * PDF summary : réutilise le full_summary DÉJÀ FORMATÉ (fiable).
 * SIGNATURE praticien via .env : SIGN_NAME, SIGN_SPECIALTY, SIGN_EMAIL, SIGN_PHONE.
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

function signatureBlock() {
  const name = process.env.SIGN_NAME || 'Dr Laurent MAMY';
  const spec = process.env.SIGN_SPECIALTY || 'Gynécologue-obstétricien';
  const email = process.env.SIGN_EMAIL || 'secretaire.drmamy@gmail.com';
  const phone = process.env.SIGN_PHONE || '01.83.75.02.50';
  let s = 'Bien confraternellement,\n' + name;
  if (spec) s += '\n' + spec;
  const contact = [email, phone ? ('Tél : ' + phone) : ''].filter(Boolean).join(' · ');
  if (contact) s += '\n' + contact;
  return s;
}

/**
 * Courrier médical : commence par "Je vois Mme [Nom], née le [DDN], pour : [motif]."
 * Corps rédigé (phrases), signature ajoutée par le code.
 */
async function buildLetterText(recording, summaryData, fullSummary, templateId, recipient) {
  const crText = fullSummary || templates.formatSummary(templateId, summaryData || {});
  const dest = (recipient && recipient.name) ? recipient.name : 'Cher(e) Confrère';
  const system = `Tu es médecin (gynécologue-obstétricien). Tu rédiges une COURTE lettre confraternelle à un confrère (médecin traitant / correspondant), à partir d'un compte-rendu de consultation.

STRUCTURE EXACTE (rien d'autre, pas de markdown, pas d'astérisques, PAS de signature — ajoutée automatiquement) :
Ligne 1 : ${dest},
Ligne 2 : (vide)
Puis le corps en PHRASES (une idée par phrase, pas de puces) :
- 1re phrase OBLIGATOIRE, commence EXACTEMENT par : "Je vois ce jour Mme [Nom], née le [DDN], pour [motif]." (utilise le nom et la date de naissance s'ils figurent dans le compte-rendu ; sinon écris "Mme [Nom]" et "née le [DDN]" tels quels).
- 1 à 3 phrases : éléments cliniques essentiels et conclusion (diagnostic).
- 1 phrase commençant par "Conduite à tenir :" (suivi / examens).
- 1 phrase commençant par "Traitement prescrit :" (médicaments avec posologie).

RÈGLES : COURT et factuel. INTERDITS : "je vous informe du suivi", "je vous adresse la patiente", "je vous remercie de votre attention", "n'hésitez pas à me contacter". Reste fidèle au compte-rendu, n'invente rien, corrige les noms de médicaments. Aucune formule de politesse finale ni signature.`;
  const user = `Compte-rendu source :\n${crText}\n\nRédige la lettre COURTE (sans signature) en respectant la structure, en commençant le corps par "Je vois ce jour Mme ...".`;
  let body = await aiText.chat(system, user, { temperature: 0.2, maxTokens: 900 });
  body = (body || crText).trim();
  // Retire toute signature/politesse que l'IA aurait ajoutée
  body = body.replace(/\n+\s*(bien\s+confraternellement|cordialement|confraternellement|dr\.?\b|dr\s)[\s\S]*$/i, '').trim();
  return body + '\n\n' + signatureBlock();
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

    let summaryData = null, fullSummary = null;
    let templateId = template || 'auto';
    if (content !== 'transcript') {
      const s = recordingModel.getSummary(id);
      summaryData = s?.data || null;
      fullSummary = s?.full_summary || s?.fullSummary || null;
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
