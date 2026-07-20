/**
 * NeoMinutes - Service Export PDF (pdfkit).
 * mode: 'summary' | 'transcript' | 'letter'.
 * En-tête établissement paramétrable : HEADER_ORG, HEADER_SUBTITLE (.env).
 * Courrier = mise en page COMPACTE (tient sur 1 page).
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const templates = require('../services/summarize');

function headerOrg() { return process.env.HEADER_ORG || 'Centre Médical FOCH'; }
function headerSubtitle() { return process.env.HEADER_SUBTITLE || 'Consultation du Dr Laurent Mamy'; }

async function generatePdf(options) {
  const {
    recording, transcript, summary, fullSummary = null, templateId,
    includeTranscript = false, mode = 'summary', letterText = ''
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
      margins: { top: 48, bottom: 48, left: 55, right: 55 },
      info: { Title: recording.title || 'Document NeoMinutes', Author: headerOrg(), Creator: 'NeoMinutes' }
    });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const styles = {
      org: { size: 15, color: '#1a1a2e' },
      title: { size: 14, color: '#1a1a2e' },
      sectionTitle: { size: 12, color: '#1a4b8c' },
      body: { size: 11, color: '#222222' },
      small: { size: 9, color: '#666666' },
      caption: { size: 9, color: '#666666', italic: true }
    };

    const addText = (text, opts = {}) => {
      doc.fontSize(opts.size || 11).fillColor(opts.color || '#222222');
      if (opts.bold) doc.font('Helvetica-Bold');
      else if (opts.italic) doc.font('Helvetica-Oblique');
      else doc.font('Helvetica');
      doc.text(text, opts);
    };
    const pageBreak = (h) => { if (doc.y + h > doc.page.height - 48) doc.addPage(); };
    const dateStr = new Date(recording.createdAt || Date.now()).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });

    // En-tête établissement compact
    const drawOrgHeader = () => {
      addText(headerOrg(), { ...styles.org, bold: true, align: 'center' });
      if (headerSubtitle()) addText(headerSubtitle(), { ...styles.caption, align: 'center' });
      addText(dateStr, { ...styles.caption, align: 'center' });
      doc.moveDown(0.25);
      doc.moveTo(55, doc.y).lineTo(doc.page.width - 55, doc.y).stroke('#cccccc');
      doc.moveDown(0.4);
    };

    const finish = () => {
      finalizeFooter(doc);
      doc.end();
      stream.on('close', () => resolve({ filePath, fileSize: fs.statSync(filePath).size, filename }));
      stream.on('error', reject);
    };

    // ============ COURRIER (compact, 1 page) ============
    if (mode === 'letter') {
      drawOrgHeader();
      const lines = String(letterText || '').split('\n');
      lines.forEach((raw) => {
        const l = raw.trim();
        if (l === '') { doc.moveDown(0.35); return; }
        addText(l, { ...styles.body, lineGap: 1, paragraphGap: 2 });
      });
      finish();
      return;
    }

    // ============ EN-TÊTE (summary / transcript) ============
    drawOrgHeader();
    if (mode === 'transcript') {
      addText('Transcription', { ...styles.title, bold: true });
      doc.moveDown(0.3);
      String(transcript || '').split(/\n\n+/).forEach(p => {
        if (p.trim()) { addText(p.trim(), { ...styles.body, lineGap: 1 }); doc.moveDown(0.25); pageBreak(30); }
      });
      finish();
      return;
    }

    // ============ COMPTE-RENDU ============
    const crText = fullSummary || (summary ? templates.formatSummary(templateId, summary) : '');
    for (const line of String(crText).split('\n')) {
      const l = line.replace(/\s+$/, '');
      if (l.startsWith('═') || l.startsWith('─') || l.trim() === '') { if (l.trim() === '') doc.moveDown(0.15); continue; }
      if (/^COMPTE-RENDU/.test(l.trim())) continue;
      const isSection = l === l.toUpperCase() && l.trim().length > 2 && l.trim().length < 60 && !/[.]/.test(l);
      if (l.startsWith('## ')) { doc.moveDown(0.3); addText(l.replace('## ', ''), { ...styles.sectionTitle, bold: true }); doc.moveDown(0.15); }
      else if (isSection) { doc.moveDown(0.3); addText(l.trim(), { ...styles.sectionTitle, bold: true }); doc.moveDown(0.1); }
      else if (l.startsWith('- ') || l.match(/^\d+\.\s/)) { addText(l.replace(/^[-\d.]+\s*/, '•  '), { ...styles.body, indent: 8, lineGap: 1 }); }
      else if (l.startsWith('•')) { addText(l, { ...styles.body, indent: 8, lineGap: 1 }); }
      else { addText(l, { ...styles.body, lineGap: 1 }); }
      pageBreak(18);
    }

    if (includeTranscript && transcript) {
      doc.addPage();
      addText('Transcription complète (annexe)', { ...styles.sectionTitle, bold: true });
      doc.moveDown(0.3);
      String(transcript).split(/\n\n+/).forEach(p => {
        if (p.trim()) { addText(p.trim(), { ...styles.small, lineGap: 1 }); doc.moveDown(0.25); pageBreak(30); }
      });
    }

    finish();
  });
}

function finalizeFooter(doc) {
  try {
    const range = doc.bufferedPageRange();
    if (!range || !range.count) return;
    for (let i = 0; i < range.count; i++) {
      const pageIndex = range.start + i;
      try {
        doc.switchToPage(pageIndex);
        doc.fontSize(8).fillColor('#999999').font('Helvetica')
          .text('Généré par NeoMinutes', 55, doc.page.height - 32, { align: 'center' });
      } catch (inner) { /* ignore */ }
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
