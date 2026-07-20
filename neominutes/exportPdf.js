/**
 * NeoMinutes - Service Export PDF (pdfkit).
 * mode: 'summary' | 'transcript' | 'letter'.
 * En mode summary, si fullSummary (texte déjà mis en forme) est fourni, on l'utilise
 * directement (fiable) ; sinon on reformate via templates.formatSummary.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const templates = require('../services/summarize');

async function generatePdf(options) {
  const {
    recording,
    transcript,
    summary,
    fullSummary = null,
    templateId,
    includeTranscript = false,
    mode = 'summary',
    letterText = ''
  } = options;

  const outputDir = path.join(__dirname, '..', '..', 'exports');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const suffix = mode === 'transcript' ? 'transcription' : (mode === 'letter' ? 'courrier' : 'cr');
  const filename = `neominutes-${recording.id}-${suffix}-${Date.now()}.pdf`;
  const filePath = path.join(outputDir, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 55, bottom: 55, left: 55, right: 55 },
      info: { Title: recording.title || 'Document NeoMinutes', Author: 'NeoMinutes', Creator: 'NeoMinutes' }
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const styles = {
      title: { size: 20, color: '#1a1a2e' },
      sectionTitle: { size: 13, color: '#1a4b8c' },
      body: { size: 11, color: '#222222' },
      small: { size: 9, color: '#666666' },
      caption: { size: 10, color: '#666666', italic: true }
    };

    const addText = (text, opts = {}) => {
      doc.fontSize(opts.size || 11).fillColor(opts.color || '#222222');
      if (opts.bold) doc.font('Helvetica-Bold');
      else if (opts.italic) doc.font('Helvetica-Oblique');
      else doc.font('Helvetica');
      doc.text(text, opts);
    };
    const pageBreak = (h) => { if (doc.y + h > doc.page.height - 55) doc.addPage(); };
    const dateStr = new Date(recording.createdAt || Date.now()).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });

    const finish = () => {
      finalizeFooter(doc);
      doc.end();
      stream.on('close', () => resolve({ filePath, fileSize: fs.statSync(filePath).size, filename }));
      stream.on('error', reject);
    };

    // ============ COURRIER ============
    if (mode === 'letter') {
      const lines = String(letterText || '').split('\n');
      lines.forEach((raw, i) => {
        const l = raw.trim();
        if (i === 0 && l) { addText(l, { ...styles.title, bold: true }); doc.moveDown(0.3); return; }
        if (l === '') { doc.moveDown(0.5); return; }
        addText(l, { ...styles.body, lineGap: 2 });
        pageBreak(20);
      });
      finish();
      return;
    }

    // ============ EN-TÊTE (summary / transcript) ============
    addText(recording.title || (mode === 'transcript' ? 'Transcription' : 'Compte-rendu'), { ...styles.title, bold: true, align: 'center' });
    doc.moveDown(0.3);
    addText(`${mode === 'transcript' ? 'Transcription' : 'Compte-rendu'} • ${dateStr}`, { ...styles.caption, align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(55, doc.y).lineTo(doc.page.width - 55, doc.y).stroke('#cccccc');
    doc.moveDown(0.6);

    // ============ TRANSCRIPTION SEULE ============
    if (mode === 'transcript') {
      String(transcript || '').split(/\n\n+/).forEach(p => {
        if (p.trim()) { addText(p.trim(), { ...styles.body, lineGap: 2 }); doc.moveDown(0.3); pageBreak(30); }
      });
      finish();
      return;
    }

    // ============ COMPTE-RENDU ============
    // Texte déjà formaté (fiable) sinon on reformate.
    const crText = fullSummary || (summary ? templates.formatSummary(templateId, summary) : '');
    for (const line of String(crText).split('\n')) {
      const l = line.replace(/\s+$/, '');
      if (l.startsWith('═') || l.startsWith('─') || l.trim() === '') { if (l.trim() === '') doc.moveDown(0.2); continue; }
      // Titre de rubrique : MAJUSCULES courtes sans ponctuation de phrase
      const isSection = l === l.toUpperCase() && l.trim().length > 2 && l.trim().length < 60 && !/[.]/.test(l);
      if (l.startsWith('## ')) { doc.moveDown(0.4); addText(l.replace('## ', ''), { ...styles.sectionTitle, bold: true }); doc.moveDown(0.2); }
      else if (isSection) { doc.moveDown(0.4); addText(l.trim(), { ...styles.sectionTitle, bold: true }); doc.moveDown(0.15); }
      else if (l.startsWith('- ') || l.match(/^\d+\.\s/)) { addText(l.replace(/^[-\d.]+\s*/, '•  '), { ...styles.body, indent: 8 }); }
      else { addText(l, styles.body); }
      pageBreak(20);
    }

    if (includeTranscript && transcript) {
      doc.addPage();
      addText('Transcription complète (annexe)', { ...styles.sectionTitle, bold: true });
      doc.moveDown(0.3);
      String(transcript).split(/\n\n+/).forEach(p => {
        if (p.trim()) { addText(p.trim(), { ...styles.small, lineGap: 2 }); doc.moveDown(0.3); pageBreak(30); }
      });
    }

    finish();
  });
}

// Footer robuste : compatible pdfkit où les pages sont indexées à partir de 0 OU 1.
function finalizeFooter(doc) {
  try {
    const range = doc.bufferedPageRange(); // { start, count }
    if (!range || !range.count) return;
    for (let i = 0; i < range.count; i++) {
      const pageIndex = range.start + i;
      try {
        doc.switchToPage(pageIndex);
        doc.fontSize(8).fillColor('#999999').font('Helvetica')
          .text('Généré par NeoMinutes', 55, doc.page.height - 35, { align: 'center' });
      } catch (inner) { /* page hors buffer : on ignore cette page */ }
    }
  } catch (e) {
    console.warn('[Export] Footer ignoré:', e.message);
  }
}

async function generateFromData(recordingId, data) {
  return generatePdf({
    recording: {
      id: recordingId, title: data.title,
      createdAt: data.createdAt || new Date().toISOString(),
      participants: data.participants || [], tags: data.tags || []
    },
    transcript: data.transcript || '',
    summary: data.summary,
    fullSummary: data.fullSummary || null,
    templateId: data.templateId || 'auto',
    includeTranscript: data.includeTranscript || false,
    mode: data.mode || 'summary',
    letterText: data.letterText || ''
  });
}

module.exports = { generatePdf, generateFromData, isConfigured: () => !!PDFDocument };
