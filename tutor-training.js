/**
 * tutor-training.js — Tuteur V2 pour NeoHealth Training.
 * 🔒 Réservé Premium (users.plan premium/pro ou premium_until futur).
 * 📚 RAG STRICT : répond uniquement à partir du module choisi (content/modules/*.json). Zéro invention.
 * 🧠 Mémoire : profil élève (prénom + résumé continu) dans training.db (table tutor_profile).
 * Monté dans server.js APRÈS la définition de requireAuth :
 *     app.use(require('./tutor-training')({ requireAuth }));
 * Expose : GET /tutor (page de test) · GET /api/tutor/modules · POST /api/tutor/ask
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

module.exports = function ({ requireAuth } = {}) {
  const router = express.Router();
  const db = new Database(path.join(__dirname, 'data', 'training.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS tutor_profile (
    user_id INTEGER PRIMARY KEY, name TEXT, running_summary TEXT DEFAULT '',
    recurring_errors TEXT DEFAULT '[]', updated_at TEXT DEFAULT (datetime('now'))
  )`);

  const auth = typeof requireAuth === 'function' ? requireAuth : (_q, _r, n) => n();
  const jsonBody = express.json({ limit: '256kb' });

  // ---- Chargement des modules (content/modules/*.json) ----
  const MODULES = {};
  (function loadModules() {
    const dir = path.join(__dirname, 'content', 'modules');
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          const id = m.id || f.replace(/\.json$/, '');
          MODULES[id] = { id, title: m.title || id, description: m.description || '', raw: m };
        } catch (_) {}
      }
    } catch (e) { console.error('[tutor-training] modules load:', e.message); }
    console.log('[tutor-training] modules charges:', Object.keys(MODULES).length);
  })();

  // Construit le texte d'ancrage (RAG) d'un module, robuste au schéma exact
  function moduleText(m) {
    const parts = [`# ${m.title}`, m.description || ''];
    const walk = (v) => {
      if (typeof v === 'string') { if (v.trim()) parts.push(v.trim()); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    if (m.raw && m.raw.lessons) walk(m.raw.lessons);
    return parts.join('\n').slice(0, 9000);
  }

  // ---- Auth / Premium (défensif sur la forme de session) ----
  function getUserId(req) {
    const s = req.session || {};
    return s.userId || (s.user && s.user.id) || s.uid || req.userId || null;
  }
  function getUser(uid) {
    try { return db.prepare('SELECT id, name, plan, premium_until FROM users WHERE id = ?').get(uid); }
    catch (_) { return null; }
  }
  function isPremium(u) {
    if (!u) return false;
    if (u.plan === 'premium' || u.plan === 'pro') return true;
    if (u.premium_until && new Date(u.premium_until) > new Date()) return true;
    return false;
  }

  // ---- IA (Anthropic Haiku ; fallback OpenAI) ----
  const AK = process.env.ANTHROPIC_API_KEY, OK = process.env.OPENAI_API_KEY;
  const hasA = AK && AK !== 'sk-your-key-here';
  const hasO = OK && OK !== 'sk-your-key-here';
  async function callAI(system, messages) {
    if (hasA) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': AK, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', system, messages, max_tokens: 600, temperature: 0.2 })
        });
        if (r.ok) { const d = await r.json(); const t = d.content && d.content[0] && d.content[0].text; if (t) return t; }
        else console.error('[tutor-training] anthropic', r.status, (await r.text()).slice(0, 160));
      } catch (e) { console.error('[tutor-training] anthropic', e.message); }
    }
    if (hasO) {
      try {
        const base = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
        const r = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OK },
          body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'system', content: system }, ...messages], max_tokens: 600, temperature: 0.3 })
        });
        if (r.ok) { const d = await r.json(); const t = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content; if (t) return t; }
      } catch (e) { console.error('[tutor-training] openai', e.message); }
    }
    return null;
  }

  const jparse = (s, fb) => { try { return JSON.parse(s); } catch (_) { return fb; } };
  function profile(uid) {
    db.prepare('INSERT OR IGNORE INTO tutor_profile (user_id) VALUES (?)').run(uid);
    return db.prepare('SELECT * FROM tutor_profile WHERE user_id = ?').get(uid);
  }

  // ===================== ROUTES =====================
  // NB: pas de middleware requireAuth ici (il ferait une redirection 302 HTML qui
  // casse le fetch JSON du front). On lit la session nous-mêmes et on répond
  // TOUJOURS en JSON (401 = pas connecté, 402 = pas premium).
  router.get('/api/tutor/modules', (req, res) => {
    const uid = getUserId(req);
    const u = uid ? getUser(uid) : null;
    res.json({
      authenticated: !!u,
      premium: isPremium(u),
      modules: Object.values(MODULES).map(m => ({ id: m.id, title: m.title, description: m.description }))
    });
  });

  router.post('/api/tutor/ask', jsonBody, async (req, res) => {
    const uid = getUserId(req);
    const u = uid ? getUser(uid) : null;
    if (!u) return res.status(401).json({ error: 'auth_required' });
    if (!isPremium(u)) return res.status(402).json({ error: 'premium_required', message: 'Le Tuteur IA est réservé aux abonnés Premium.' });

    const moduleId = String(req.body && req.body.moduleId || '');
    const message = String(req.body && req.body.message || '').trim();
    const m = MODULES[moduleId];
    if (!m) return res.status(400).json({ error: 'module_inconnu' });
    if (!message) return res.status(400).json({ error: 'message_requis' });

    const p = profile(uid);
    const errs = jparse(p.recurring_errors, []);
    const system = [
      `Tu es "Neo", le tuteur IA de la formation NeoHealth Training (gynécologie-obstétrique) pour un professionnel de santé.`,
      p.name ? `L'apprenant s'appelle ${p.name} — tutoie-le et utilise son prénom parfois.` : `Tu ne connais pas encore le prénom de l'apprenant — demande-le une fois, poliement, puis retiens-le.`,
      `RÈGLE ABSOLUE (sécurité médicale) : réponds UNIQUEMENT à partir du CONTENU DU MODULE ci-dessous. Si l'information n'y est pas, dis-le clairement ("ce point n'est pas couvert dans ce module") et invite à consulter la leçon — n'invente JAMAIS de donnée clinique.`,
      `Rôle : interroger l'apprenant sur ce module, expliquer simplement une leçon, ou jouer un cas — 2 à 5 phrases, UNE question à la fois, bienveillant et précis. Réponds dans la langue de l'apprenant (français par défaut).`,
      errs.length ? `Points déjà à retravailler : ${errs.join('; ')}.` : '',
      p.running_summary ? `MÉMOIRE (déjà vu — ne pas répéter) : ${p.running_summary}` : '',
      `=== CONTENU DU MODULE "${m.title}" ===`,
      moduleText(m),
      `=== FIN DU MODULE ===`,
      `Termine EXACTEMENT par :`,
      `---MEMO---`,
      `{"name":"<prénom si donné, sinon vide>","summary":"<max 12 mots: ce qui a été travaillé>"}`
    ].filter(Boolean).join('\n');

    const raw = await callAI(system, [{ role: 'user', content: message }]);
    if (!raw) return res.status(502).json({ error: 'ia_indisponible' });

    // Sépare la réponse visible du MEMO interne
    let visible = raw, memo = null;
    const i = raw.indexOf('---MEMO---');
    if (i !== -1) {
      visible = raw.slice(0, i).trim();
      const ms = raw.slice(i + 10); const a = ms.indexOf('{'), b = ms.lastIndexOf('}');
      if (a >= 0 && b > a) memo = jparse(ms.slice(a, b + 1), null);
    }
    try {
      let name = p.name;
      if (!name && memo && memo.name && String(memo.name).trim()) name = String(memo.name).trim().slice(0, 40);
      let summary = p.running_summary || '';
      if (memo && memo.summary) summary = (summary + ' | ' + String(memo.summary)).slice(-1400);
      db.prepare("UPDATE tutor_profile SET name = ?, running_summary = ?, updated_at = datetime('now') WHERE user_id = ?")
        .run(name || null, summary, uid);
    } catch (e) { console.error('[tutor-training] memo', e.message); }

    res.json({ reply: visible });
  });

  // Page de test autonome
  router.get('/tutor', (_req, res) => {
    res.type('html').send(PAGE);
  });

  const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>NeoHealth Training · Tuteur Neo</title><style>
:root{--b:#0e1626;--c:#14203a;--l:#28406b;--t:#e8eef7;--m:#93a4bd;--a:#38bdf8}
*{box-sizing:border-box}body{margin:0;background:var(--b);color:var(--t);font-family:-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh}
.w{max-width:820px;margin:0 auto;padding:16px 14px 90px}h1{font-size:18px;margin:6px 0}
.sub{color:var(--m);font-size:13px;margin-bottom:12px}
select,input,button{font:inherit}
select{width:100%;background:var(--c);color:var(--t);border:1px solid var(--l);border-radius:10px;padding:10px;margin-bottom:12px}
.chat{display:flex;flex-direction:column;gap:10px;min-height:300px}
.msg{max-width:88%;padding:11px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap}
.me{align-self:flex-end;background:#1d3a52}.neo{align-self:flex-start;background:var(--c);border:1px solid var(--l)}
.bar{position:fixed;left:0;right:0;bottom:0;background:rgba(14,22,38,.96);border-top:1px solid var(--l);padding:10px}
.bar .in{max-width:820px;margin:0 auto;display:flex;gap:8px}.bar input{flex:1;background:var(--c);color:var(--t);border:1px solid var(--l);border-radius:12px;padding:12px}
.bar button{background:var(--a);color:#04121a;font-weight:700;border:0;border-radius:12px;padding:12px 16px;cursor:pointer}
.card{background:var(--c);border:1px solid var(--l);border-radius:14px;padding:16px}
.spin{display:inline-block;width:13px;height:13px;border:2px solid var(--m);border-top-color:var(--a);border-radius:50%;animation:s .7s linear infinite}@keyframes s{to{transform:rotate(360deg)}}
a{color:var(--a)}</style></head><body><div class="w">
<h1>🎓 Neo — Tuteur IA (Premium)</h1><div class="sub">Réponses ancrées uniquement sur le module choisi.</div>
<div id="app"><div class="card"><span class="spin"></span> Chargement…</div></div></div>
<div class="bar" id="bar" style="display:none"><div class="in"><input id="q" placeholder="Pose ta question sur ce module…" autocomplete="off"><button id="send">Envoyer</button></div></div>
<script>
const $=id=>document.getElementById(id);let MOD=null;
async function j(u,o){const r=await fetch(u,Object.assign({headers:{'Content-Type':'application/json'},credentials:'same-origin'},o));if(r.status===401){throw{a:1}}if(r.status===402){throw{p:1,m:(await r.json()).message}}if(!r.ok){let e={};try{e=await r.json()}catch(_){}throw new Error(e.error||('HTTP '+r.status))}return r.json()}
function esc(s){return String(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
async function init(){let d;try{d=await j('/api/tutor/modules')}catch(e){$('app').innerHTML='<div class=card>Erreur de chargement.</div>';return}
 if(!d.authenticated){$('app').innerHTML='<div class=card>👤 Connecte-toi à Training pour utiliser le Tuteur.<br><br><a href="/login?redirect=/tutor">Se connecter</a></div>';return}
 if(!d.premium){$('app').innerHTML='<div class=card>🔒 Le <b>Tuteur IA</b> est réservé aux abonnés <b>Premium</b>.<br><br><a href="/premium">Passer à Premium</a></div>';return}
 const opts=d.modules.map(m=>'<option value="'+m.id+'">'+esc(m.title)+'</option>').join('');
 $('app').innerHTML='<select id="mod">'+opts+'</select><div class="card"><div class="chat" id="chat"></div></div>';
 MOD=d.modules[0].id;$('mod').onchange=e=>{MOD=e.target.value;$('chat').innerHTML='';add('neo','Nouveau module sélectionné. Pose-moi une question, ou dis « interroge-moi ».')};
 $('bar').style.display='block';add('neo','Bonjour ! Je suis Neo. Sur quel point de ce module veux-tu travailler ? (je peux t\\'interroger, ou t\\'expliquer une leçon)');$('q').focus();}
function add(role,txt){const c=$('chat');const d=document.createElement('div');d.className='msg '+(role==='me'?'me':'neo');d.textContent=txt;c.appendChild(d);window.scrollTo(0,document.body.scrollHeight)}
async function send(){const q=$('q');const msg=q.value.trim();if(!msg)return;q.value='';add('me',msg);const c=$('chat');const w=document.createElement('div');w.className='msg neo';w.innerHTML='<span class=spin></span>';c.appendChild(w);
 try{const d=await j('/api/tutor/ask',{method:'POST',body:JSON.stringify({moduleId:MOD,message:msg})});w.remove();add('neo',d.reply)}catch(e){w.remove();add('neo',e.p?('🔒 '+e.m):('⚠️ '+(e.message||'erreur')))}}
$('send').onclick=send;$('q').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();send()}});init();
</script></body></html>`;

  return router;
};
