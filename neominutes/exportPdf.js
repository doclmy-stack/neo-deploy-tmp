/**
 * NeoMinutes - Service Export PDF
 * Génération de documents PDF avec pdfkit.
 * mode: 'summary' (compte-rendu seul) · 'transcript' (transcription seule) · 'letter' (courrier).
 * Rétro-compatible : si includeTranscript=true en mode summary, la transcription est ajoutée en fin.
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
    templateId,
    includeTranscript = false,
    mode = 'summary',      // 'summary' | 'transcript' | 'letter'
    letterText = ''        // utilisé si mode === 'letter'
  } = options;

  const outputDir = path.join(__dirname, '..', '..', 'exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const suffix = mode === 'transcript' ? 'transcription' : (mode === 'letter' ? 'courrier' : 'cr');
  const filename = `neominutes-${recording.id}-${suffix}-${Date.now()}.pdf`;
  const filePath = path.join(outputDir, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: recording.title || 'Document NeoMinutes',
        Author: 'NeoMinutes',
        Creator: 'NeoMinutes'
      }
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const styles = {
      title: { size: 22, bold: true, color: '#1a1a2e' },
      sectionTitle: { size: 14, bold: true, color: '#1a1a2e' },
      body: { size: 11, color: '#333333' },
      small: { size: 9, color: '#666666' },
      caption: { size: 10, color: '#666666', italic: true }
    };

    const addText = (text, opts = {}) => {
      doc.fontSize(opts.size || 11).fillColor(opts.color || '#333333');
      if (opts.bold) doc.font('Helvetica-Bold');
      else if (opts.italic) doc.font('Helvetica-Oblique');
      else doc.font('Helvetica');
      doc.text(text, opts);
    };

    const checkPageBreak = (height) => {
      if (doc.y + height > doc.page.height - 50) doc.addPage();
    };

    const dateStr = new Date(recording.createdAt || Date.now()).toLocaleDateString('fr-FR', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    // ============ MODE COURRIER ============
    if (mode === 'letter') {
      addText(letterText || '', { ...styles.body, lineGap: 3, align: 'left' });
      finalizeFooter(doc);
      doc.end();
      stream.on('close', () => resolve({ filePath, fileSize: fs.statSync(filePath).size, filename }));
      stream.on('error', reject);
      return;
    }

    // ============ EN-TÊTE (summary / transcript) ============
    doc.fontSize(styles.title.size).fillColor(styles.title.color).font('Helvetica-Bold')
       .text(recording.title || (mode === 'transcript' ? 'Transcription' : 'Compte-rendu'), { align: 'center' });
    doc.moveDown(0.4);
    addText(`${mode === 'transcript' ? 'Transcription' : 'Compte-rendu'} • ${dateStr}`, { ...styles.caption, align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#cccccc');
    doc.moveDown(0.6);

    // ============ MODE TRANSCRIPTION SEULE ============
    if (mode === 'transcript') {
      const paras = String(transcript || '').split(/\n\n+/);
      for (const para of paras) {
        if (para.trim()) {
          addText(para.trim(), { ...styles.body, lineGap: 2 });
          doc.moveDown(0.3);
          checkPageBreak(30);
        }
      }
      finalizeFooter(doc);
      doc.end();
      stream.on('close', () => resolve({ filePath, fileSize: fs.statSync(filePath).size, filename }));
      stream.on('error', reject);
      return;
    }

    // ============ MODE COMPTE-RENDU ============
    if (summary) {
      const formattedSummary = templates.formatSummary(templateId, summary);
      const lines = formattedSummary.split('\n');
      for (const line of lines) {
        if (line.startsWith('═') || line.startsWith('─') || line.trim() === '') continue;
        if (line.startsWith('**') && line.endsWith('**')) {
          doc.moveDown(0.5); addText(line.replace(/\*\*/g, ''), styles.sectionTitle); doc.moveDown(0.3);
        } else if (line.startsWith('## ')) {
          doc.moveDown(0.5); addText(line.replace('## ', ''), styles.sectionTitle); doc.moveDown(0.3);
        } else if (line.startsWith('### ')) {
          addText(line.replace('### ', ''), { ...styles.body, bold: true });
        } else if (line === line.toUpperCase() && line.trim().length > 3 && line.trim().length < 60 && !/[.:]/.test(line)) {
          doc.moveDown(0.4); addText(line.trim(), styles.sectionTitle); doc.moveDown(0.2);
        } else if (line.startsWith('- ') || line.match(/^\d+\.\s/)) {
          addText(line.replace(/^[-\d.]+\s*/, '  • '), styles.body);
        } else {
          addText(line, styles.body);
        }
        checkPageBreak(20);
      }
    }

    // Transcription en annexe UNIQUEMENT si explicitement demandé (défaut = non)
    if (includeTranscript && transcript) {
      doc.addPage();
      addText('Transcription complète (annexe)', styles.sectionTitle);
      doc.moveDown(0.3);
      const transcriptParagraphs = String(transcript).split(/\n\n+/);
      for (const para of transcriptParagraphs) {
        if (para.trim()) {
          addText(para.trim(), { ...styles.small, lineGap: 2 });
          doc.moveDown(0.3);
          checkPageBreak(30);
        }
      }
    }

    finalizeFooter(doc);
    doc.end();
    stream.on('close', () => {
      const stats = fs.statSync(filePath);
      console.log(`[Export] PDF généré (${mode}): ${filePath} (${stats.size} bytes)`);
      resolve({ filePath, fileSize: stats.size, filename });
    });
    stream.on('error', (err) => { console.error('[Export] Erreur PDF:', err); reject(err); });
  });
}

function finalizeFooter(doc) {
  try {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(8).fillColor('#999999').text(
        'Généré par NeoMinutes',
        50, doc.page.height - 30, { align: 'center' }
      );
    }
  } catch (e) {
    console.warn('[Export] Footer pages ignoré:', e.message);
  }
}

async function generateFromData(recordingId, data) {
  return generatePdf({
    recording: {
      id: recordingId,
      title: data.title,
      createdAt: data.createdAt || new Date().toISOString(),
      participants: data.participants || [],
      tags: data.tags || []
    },
    transcript: data.transcript || '',
    summary: data.summary,
    templateId: data.templateId || 'auto',
    includeTranscript: data.includeTranscript || false,
    mode: data.mode || 'summary',
    letterText: data.letterText || ''
  });
}

module.exports = {
  generatePdf,
  generateFromData,
  isConfigured: () => !!PDFDocument
};
