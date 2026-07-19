/**
 * NeoMinutes - Routes: Contacts (carnet d'adresses)
 * Correspondants (médecin traitant, confrères…) avec email / telegram / whatsapp.
 * Monté dans server.js APRÈS l'auth : app.use('/contacts', require('./routes/contacts'));
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../models/recording');

// Table (créée à la volée si absente)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      email TEXT,
      telegram TEXT,
      whatsapp TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (e) {
  console.error('[Contacts] DB init error:', e.message);
}

function rowToContact(r) {
  return {
    id: r.id, name: r.name, role: r.role || '', email: r.email || '',
    telegram: r.telegram || '', whatsapp: r.whatsapp || '', note: r.note || '',
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

// GET /contacts — liste
router.get('/', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE ASC').all();
    res.json({ success: true, contacts: rows.map(rowToContact) });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur', message: e.message });
  }
});

// POST /contacts — créer
router.post('/', (req, res) => {
  try {
    const { name, role, email, telegram, whatsapp, note } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nom requis', message: 'Le champ "name" est obligatoire' });
    }
    const id = 'c_' + uuidv4().slice(0, 8);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO contacts (id, name, role, email, telegram, whatsapp, note, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, String(name).trim(), role || '', email || '', telegram || '', whatsapp || '', note || '', now, now);
    res.status(201).json({ success: true, contact: rowToContact(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)) });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur', message: e.message });
  }
});

// PUT /contacts/:id — modifier
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Introuvable', message: 'Contact introuvable' });
    const fields = ['name', 'role', 'email', 'telegram', 'whatsapp', 'note'];
    const updates = [], params = [];
    for (const f of fields) {
      if (req.body && req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (!updates.length) return res.status(400).json({ error: 'Rien à mettre à jour' });
    updates.push('updated_at = ?'); params.push(new Date().toISOString(), id);
    db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true, contact: rowToContact(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)) });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur', message: e.message });
  }
});

// DELETE /contacts/:id — supprimer
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const r = db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
    if (!r.changes) return res.status(404).json({ error: 'Introuvable', message: 'Contact introuvable' });
    res.json({ success: true, message: 'Contact supprimé' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur', message: e.message });
  }
});

module.exports = router;
