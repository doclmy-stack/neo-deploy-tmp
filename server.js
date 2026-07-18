/**
 * Neocosive Training — Plateforme de formations gynéco-obstétrique
 * © 2026 Neocosive FZCO
 */
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { marked } = require('marked');

const app = express();
const PORT = process.env.PORT || 3100;

// --- Database ---
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'training.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    audience TEXT DEFAULT 'public' CHECK(audience IN ('public','pro')),
    specialty TEXT,
    lang TEXT DEFAULT 'fr',
    plan TEXT DEFAULT 'free' CHECK(plan IN ('free','premium','pro')),
    premium_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS quiz_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    module_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    percentage INTEGER NOT NULL,
    attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS lesson_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    module_id TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    completed INTEGER DEFAULT 1,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, module_id, lesson_id)
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT DEFAULT 'EUR',
    provider TEXT DEFAULT 'stub',
    provider_ref TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Lightweight migration: adopt new columns if old DB exists
try {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols.includes('plan')) db.exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'");
  if (!cols.includes('premium_until')) db.exec("ALTER TABLE users ADD COLUMN premium_until DATETIME");
  if (!cols.includes('audience')) db.exec("ALTER TABLE users ADD COLUMN audience TEXT DEFAULT 'public'");
  // plan_interval : monthly | yearly | lifetime | none — sert à réserver le Tuteur IA
  // aux abonnements mensuel/annuel (le « à vie » n'inclut PAS le tuteur).
  if (!cols.includes('plan_interval')) db.exec("ALTER TABLE users ADD COLUMN plan_interval TEXT DEFAULT 'none'");
} catch (e) { /* noop */ }

// --- Plans / offers ---
// Chaque offre = combo (tier, interval). Montant en centimes.
// tier : free | premium | pro  /  interval : monthly | yearly | lifetime | none
const OFFERS = {
  free:              { tier: 'free',    interval: 'none',     label: 'Gratuit',              price_cents: 0,     audience: 'public', duration_days: 0 },
  premium_monthly:   { tier: 'premium', interval: 'monthly',  label: 'Premium mensuel',      price_cents: 990,   audience: 'public', duration_days: 31 },
  premium_yearly:    { tier: 'premium', interval: 'yearly',   label: 'Premium annuel',       price_cents: 9500,  audience: 'public', duration_days: 365, save_pct: 20 },
  premium_lifetime:  { tier: 'premium', interval: 'lifetime', label: 'Premium à vie',        price_cents: 19900, audience: 'public', duration_days: 36500 },
  pro_monthly:       { tier: 'pro',     interval: 'monthly',  label: 'Pro mensuel',          price_cents: 2490,  audience: 'pro',    duration_days: 31 },
  pro_yearly:        { tier: 'pro',     interval: 'yearly',   label: 'Pro annuel',           price_cents: 23900, audience: 'pro',    duration_days: 365, save_pct: 20 },
  pro_lifetime:      { tier: 'pro',     interval: 'lifetime', label: 'Pro à vie',            price_cents: 49900, audience: 'pro',    duration_days: 36500 }
};
// Back-compat
const PLANS = {
  free:    OFFERS.free,
  premium: OFFERS.premium_monthly,
  pro:     OFFERS.pro_monthly
};
const FREE_LESSONS_PER_MODULE = 2; // grand public : les 2 premières leçons de chaque module

function userPlan(u) {
  if (!u) return 'free';
  if (u.plan === 'pro') return 'pro';
  if (u.plan === 'premium' && (!u.premium_until || new Date(u.premium_until) > new Date())) return 'premium';
  return 'free';
}
function isLessonUnlocked(user, mod, lessonIndex) {
  const plan = userPlan(user);
  if (plan === 'pro') return true;
  if (plan === 'premium') return mod.level !== 'pro';
  // free
  if (mod.level === 'pro') return false;
  return lessonIndex < FREE_LESSONS_PER_MODULE;
}

// --- i18n ---
const LANGS = ['fr', 'en', 'de', 'es', 'ru', 'zh', 'ar'];
const locales = {};
LANGS.forEach(lang => {
  const fp = path.join(__dirname, 'locales', `${lang}.json`);
  try { locales[lang] = JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { locales[lang] = locales.fr || {}; }
});

function t(key, lang = 'fr') {
  const keys = key.split('.');
  let val = locales[lang] || locales.fr;
  for (const k of keys) {
    if (val && typeof val === 'object' && k in val) val = val[k];
    else return key;
  }
  return typeof val === 'string' ? val : key;
}

// --- Load modules ---
function loadModules() {
  const modulesDir = path.join(__dirname, 'content', 'modules');
  if (!fs.existsSync(modulesDir)) return [];
  return fs.readdirSync(modulesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(modulesDir, f), 'utf8')))
    .sort((a, b) => a.order - b.order);
}

function buildLearningPaths(modules) {
  const groups = [
    {
      id: 'gynecologie',
      title: 'Parcours Gynecologie',
      description: 'Cycle, contraception, pathologies benignes, col, vulve, sein et consultation gynecologique.',
      matcher: (m) => /(gyne|cycle|colpo|hystero|vulv|sein|contrace|menopause|endometr|ovar|cervic|consultation)/i.test(`${m.id} ${m.title}`)
    },
    {
      id: 'obstetrique',
      title: 'Parcours Obstetrique',
      description: 'Suivi de grossesse, travail, accouchement, post-partum, placenta, preeclampsie et urgences.',
      matcher: (m) => /(grossesse|obst|foetal|fetal|partum|placenta|doppler|trimestre|accouchement|preecl|hta|gémellaire|gemellaire|prematur)/i.test(`${m.id} ${m.title}`)
    },
    {
      id: 'echographie',
      title: 'Parcours Echographie',
      description: 'Datation, morphologie, croissance, doppler et echographie gynecologique.',
      matcher: (m) => /(echo|échographie|echographie|doppler|imagerie)/i.test(`${m.id} ${m.title}`)
    },
    {
      id: 'sage-femme',
      title: 'Parcours Sage-femme',
      description: 'Modules dedies a la pratique sage-femme : physiologie, allaitement, nouveau-ne, suites de couches, prevention.',
      matcher: (m) => m.level === 'sage-femme'
    },
    {
      id: 'urgences',
      title: 'Parcours Urgences',
      description: 'Reconnaissance, tri et conduite a tenir devant les situations critiques.',
      matcher: (m) => /(urgence|hpp|hemorrag|eclamps|hrp|procidence|dystoc|haut risque|haute? risque)/i.test(`${m.id} ${m.title}`)
    }
  ];

  return groups.map(group => ({
    ...group,
    modules: modules.filter(group.matcher)
  })).filter(group => group.modules.length > 0);
}

const referenceLibraryPath = path.join(__dirname, 'data', 'content-tools', 'reference-library.json');
let referenceLibrary = {};
try {
  referenceLibrary = JSON.parse(fs.readFileSync(referenceLibraryPath, 'utf8'));
} catch {
  referenceLibrary = {};
}

const caseLibraryPath = path.join(__dirname, 'data', 'content-tools', 'case-library.json');
let caseLibrary = {};
try {
  caseLibrary = JSON.parse(fs.readFileSync(caseLibraryPath, 'utf8'));
} catch {
  caseLibrary = {};
}

const videoLibraryPath = path.join(__dirname, 'data', 'content-tools', 'video-library.json');
let videoLibrary = {};
try {
  videoLibrary = JSON.parse(fs.readFileSync(videoLibraryPath, 'utf8'));
} catch {
  videoLibrary = {};
}

function getReferenceBuckets(module, lesson) {
  const title = `${module.title} ${lesson.title}`.toLowerCase();
  const buckets = [];
  if (/echo|échographie|echographie|doppler|foetal|fetal|imagerie/.test(title)) buckets.push('echographie');
  if (/grossesse|obst|partum|placenta|hta|preecl|accouchement|foetal|fetal|gémellaire|gemellaire/.test(title)) buckets.push('obstetrique');
  if (/gyne|contrace|colpo|hystero|vulv|sein|cycle|menopause|ovar|endometr/.test(title)) buckets.push('gynecologie');
  if (/sage-femme|allait|nouveau-ne|nouveau-né|parentalit|perine|post-partum|maieut|maïeut/.test(title) || module.level === 'sage-femme') buckets.push('sage-femme');
  if (/urgence|hemorrag|hpp|eclamps|hrp|dystoc|procidence/.test(title)) buckets.push('urgences');
  if (/allait/.test(title)) buckets.push('allaitement');
  if (/ebm|preuve|bibliograph|lecture critique|cochrane|pubmed|recherche/.test(title)) buckets.push('ebm');
  return [...new Set(buckets)];
}

function pickDiagram(module, lesson) {
  const title = `${module.title} ${lesson.title}`.toLowerCase();
  if (/rcf|monitoring|cardiotoc|variabilit|deceleration/.test(title)) return '/diagrams/monitoring-rcf.svg';
  if (/colposcop/.test(title)) return '/diagrams/colposcopy-pathway.svg';
  if (/diabete gestationnel|dg\b|glycem/.test(title)) return '/diagrams/diabete-gestationnel.svg';
  if (/urgence|hemorrag|hpp|eclamps|procidence|hrp|dystoc/.test(title)) return '/diagrams/triage-urgences.svg';
  if (/suivi|grossesse|trimestre|consultation prénatale|prenatale/.test(title)) return '/diagrams/suivi-grossesse.svg';
  if (module.level === 'sage-femme') return '/diagrams/decision-tree-sage-femme.svg';
  return '/diagrams/decision-tree-general.svg';
}

function parseLessonEnhancements(raw, lesson, module) {
  const text = raw || '';
  const lines = text.split(/\r?\n/);
  const refs = [];
  const videos = [];
  const cases = [];
  const diagrams = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('REF:')) refs.push(trimmed.slice(4).trim());
    if (trimmed.startsWith('VIDEO:')) videos.push(trimmed.slice(6).trim());
    if (trimmed.startsWith('CASE:')) cases.push(trimmed.slice(5).trim());
    if (trimmed.startsWith('DIAGRAM:')) diagrams.push(trimmed.slice(8).trim());
  }

  if (refs.length === 0) {
    const buckets = getReferenceBuckets(module, lesson);
    for (const bucket of buckets) {
      for (const ref of (referenceLibrary[bucket] || [])) refs.push(ref);
    }
    if (refs.length === 0) {
      refs.push('CNGOF — Recommandations pour la pratique clinique pertinentes sur ce theme');
      refs.push('HAS — Recommandations et fiches de bon usage associees');
      refs.push('OMS / FIGO / RCOG — Referentiels internationaux complementaires');
    }
  }

  if (videos.length === 0) {
    const lessonSpecificVideos = videoLibrary.lessonSpecific?.[lesson.id] || [];
    for (const video of lessonSpecificVideos) videos.push(video);
    if (videos.length === 0) {
      const buckets = getReferenceBuckets(module, lesson);
      for (const bucket of buckets) {
        for (const video of (videoLibrary[bucket] || [])) videos.push(video);
      }
    }
    if (videos.length === 0) {
      videos.push(`Recherche recommandee : ${module.title} sur YouTube (CNGOF, FIGO, RCOG, CHU)`);
      videos.push(`Recherche recommandee : ${lesson.title} conference ou webinar`);
    }
  }

  const lessonCase = caseLibrary[lesson.id] || caseLibrary[module.id] || caseLibrary.default || null;
  if (cases.length === 0 && lessonCase?.prompt) {
    cases.push(lessonCase.prompt);
  } else if (cases.length === 0) {
    cases.push(`Patiente type : appliquer ${lesson.title.toLowerCase()} a une situation clinique progressive, puis justifier la conduite a tenir.`);
  }

  if (diagrams.length === 0) {
    diagrams.push(pickDiagram(module, lesson));
  }

  return {
    refs: [...new Set(refs)],
    videos,
    cases,
    diagrams,
    interactiveCase: lessonCase
  };
}

// --- Middleware ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
  secret: process.env.SESSION_SECRET || 'neocosive-training-2026-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 30 * 24 * 3600 * 1000 }
}));

app.use((req, res, next) => {
  const lang = req.query.lang || req.session.lang || 'fr';
  if (LANGS.includes(lang)) req.session.lang = lang;
  const modules = loadModules();
  res.locals.lang = req.session.lang || 'fr';
  res.locals.t = (key) => t(key, res.locals.lang);
  res.locals.user = req.session.user || null;
  res.locals.modules = modules;
  res.locals.learningPaths = buildLearningPaths(modules);
  res.locals.isRTL = res.locals.lang === 'ar';
  res.locals.marked = marked;
  res.locals.plan = userPlan(req.session.user);
  res.locals.PLANS = PLANS;
  res.locals.OFFERS = OFFERS;
  res.locals.FREE_LESSONS_PER_MODULE = FREE_LESSONS_PER_MODULE;
  res.locals.isLessonUnlocked = isLessonUnlocked;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  next();
}

// --- Routes ---

// Home
app.get('/', (req, res) => res.render('index'));

// All modules
app.get('/modules', (req, res) => res.render('modules'));

// Single module detail
app.get('/module/:id', (req, res) => {
  const mod = loadModules().find(m => m.id === req.params.id);
  if (!mod) return res.redirect('/modules');
  
  let progress = [];
  if (req.session.user) {
    progress = db.prepare('SELECT lesson_id FROM lesson_progress WHERE user_id = ? AND module_id = ?')
      .all(req.session.user.id, mod.id).map(r => r.lesson_id);
  }
  res.render('module-detail', { module: mod, progress });
});

// Lesson
app.get('/module/:id/lesson/:lessonId', (req, res) => {
  const mod = loadModules().find(m => m.id === req.params.id);
  if (!mod) return res.redirect('/modules');
  const lessons = mod.lessons || [];
  const lessonIndex = lessons.findIndex(l => l.id === req.params.lessonId);
  const lesson = lessons[lessonIndex];
  if (!lesson) return res.redirect('/module/' + req.params.id);

  const unlocked = isLessonUnlocked(req.session.user, mod, lessonIndex);
  if (!unlocked) return res.redirect('/premium?from=' + encodeURIComponent(req.originalUrl));

  // Load markdown content with language-aware fallback
  const lang = (req.session.lang || 'fr');
  function loadLocalized(baseCandidates) {
    // baseCandidates is array of {dir, base} - we build .lang.md and .md variants
    if (lang !== 'fr') {
      for (const c of baseCandidates) {
        const p = c.replace(/\.md$/, '.' + lang + '.md');
        try { if (fs.existsSync(p)) return { text: fs.readFileSync(p, 'utf8'), status: 'ai_translated' }; } catch {}
      }
    }
    for (const c of baseCandidates) {
      try { if (fs.existsSync(c)) return { text: fs.readFileSync(c, 'utf8'), status: lang === 'fr' ? 'native' : 'fallback_fr' }; } catch {}
    }
    return { text: '', status: 'native' };
  }

  const mdCandidates = [
    path.join(__dirname, 'content', 'lessons', lesson.id, 'index.md'),
    path.join(__dirname, 'content', 'lessons', mod.id, lesson.id + '.md')
  ];
  const loaded = loadLocalized(mdCandidates);
  let content = loaded.text;
  const translationStatus = loaded.status;

  // Pro content (same language-aware fallback)
  const proCandidates = [
    path.join(__dirname, 'content', 'lessons', lesson.id, 'pro.md'),
    path.join(__dirname, 'content', 'lessons', mod.id, lesson.id + '.pro.md')
  ];
  const loadedPro = loadLocalized(proCandidates);
  let proContent = loadedPro.text;

  const plan = userPlan(req.session.user);
  const isPro = plan === 'pro';
  const enhancements = parseLessonEnhancements(content, lesson, mod);

  res.render('lesson', {
    module: mod,
    lesson,
    content,
    proContent: isPro ? proContent : '',
    isPro,
    lessonIndex,
    lessons,
    enhancements,
    translationStatus
  });
});

// Mark lesson complete
app.post('/api/lesson/:moduleId/:lessonId/complete', requireAuth, (req, res) => {
  db.prepare('INSERT OR REPLACE INTO lesson_progress (user_id, module_id, lesson_id) VALUES (?, ?, ?)')
    .run(req.session.user.id, req.params.moduleId, req.params.lessonId);
  res.json({ ok: true });
});

// Case drills page
app.get('/case-drills', (req, res) => {
  const modules = loadModules().map((mod) => ({
    ...mod,
    caseLessons: (mod.lessons || []).filter((lesson) => !!(caseLibrary[lesson.id] || caseLibrary[mod.id]))
  })).filter((mod) => mod.caseLessons.length > 0);
  res.render('case-drills', { caseModules: modules });
});

// Quiz page
app.get('/module/:id/quiz', (req, res) => {
  const mod = loadModules().find(m => m.id === req.params.id);
  if (!mod || !mod.quiz) return res.redirect('/module/' + req.params.id);
  res.render('quiz', { module: mod });
});

// Quiz submit
app.post('/api/quiz/:moduleId/submit', (req, res) => {
  const mod = loadModules().find(m => m.id === req.params.moduleId);
  if (!mod || !mod.quiz) return res.json({ error: 'Module introuvable' });
  
  const { answers } = req.body;
  let score = 0;
  const corrections = [];
  
  mod.quiz.forEach((q, i) => {
    const correct = String(answers[i]) === String(q.correct);
    if (correct) score++;
    corrections.push({
      question: q.question,
      userAnswer: answers[i],
      correctAnswer: q.correct,
      correct,
      explanation: q.explanation || ''
    });
  });
  
  const total = mod.quiz.length;
  const percentage = Math.round((score / total) * 100);
  
  if (req.session.user) {
    db.prepare('INSERT INTO quiz_results (user_id, module_id, score, total, percentage) VALUES (?, ?, ?, ?, ?)')
      .run(req.session.user.id, req.params.moduleId, score, total, percentage);
  }
  
  res.json({ score, total, percentage, passed: percentage >= 70, corrections });
});

// Progress
app.get('/progress', requireAuth, (req, res) => {
  const lessons = db.prepare('SELECT * FROM lesson_progress WHERE user_id = ?').all(req.session.user.id);
  const quizzes = db.prepare('SELECT * FROM quiz_results WHERE user_id = ? ORDER BY attempted_at DESC LIMIT 20')
    .all(req.session.user.id);
  res.render('progress', { lessonProgress: lessons, quizResults: quizzes });
});

// Auth
app.get('/login', (req, res) => res.render('login', { error: null, redirect: req.query.redirect || '/' }));
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/login', (req, res) => {
  const { email, password, redirect } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Email ou mot de passe incorrect', redirect });
  }
  req.session.user = {
    id: user.id, email: user.email, name: user.name,
    audience: user.audience || 'public',
    plan: user.plan || 'free',
    premium_until: user.premium_until || null,
    plan_interval: user.plan_interval || 'none'
  };
  res.redirect(redirect || '/');
});

app.post('/register', (req, res) => {
  const { email, password, name, audience, specialty } = req.body;
  try {
    const hash = bcrypt.hashSync(password, 10);
    const aud = (audience === 'pro') ? 'pro' : 'public';
    const r = db.prepare('INSERT INTO users (email, password, name, audience, specialty, plan) VALUES (?, ?, ?, ?, ?, ?)')
      .run(email, hash, name, aud, specialty || '', 'free');
    req.session.user = { id: r.lastInsertRowid, email, name, audience: aud, plan: 'free', premium_until: null, plan_interval: 'none' };
    res.redirect('/');
  } catch (err) {
    const msg = err.message.includes('UNIQUE') ? 'Cet email est déjà utilisé' : 'Erreur lors de l\'inscription';
    res.render('register', { error: msg });
  }
});

// --- Premium / upgrade ---
app.get('/premium', (req, res) => {
  res.render('premium', { from: req.query.from || '/', plans: PLANS, offers: OFFERS });
});

app.post('/api/checkout', requireAuth, (req, res) => {
  const { offer } = req.body;
  const o = OFFERS[offer];
  if (!o || o.tier === 'free') return res.status(400).json({ error: 'offre invalide' });
  // Stub paiement (Stripe à brancher plus tard)
  const payment = db.prepare('INSERT INTO payments (user_id, plan, amount_cents, status, provider, provider_ref) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.session.user.id, o.tier, o.price_cents, 'pending', 'stub', offer);
  // Active le tier + pose l'échéance selon la durée de l'offre
  const until = new Date(Date.now() + o.duration_days * 24 * 3600 * 1000).toISOString();
  db.prepare('UPDATE users SET plan = ?, premium_until = ?, plan_interval = ? WHERE id = ?').run(o.tier, until, o.interval, req.session.user.id);
  db.prepare('UPDATE payments SET status = ? WHERE id = ?').run('paid-stub', payment.lastInsertRowid);
  req.session.user.plan = o.tier;
  req.session.user.premium_until = until;
  req.session.user.plan_interval = o.interval;
  res.json({ ok: true, offer, tier: o.tier, interval: o.interval, until, note: 'mode démo (local) : paiement simulé, Stripe Checkout à brancher' });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// Demo helper for local testing only
app.get('/demo-login/:plan', (req, res) => {
  const allowed = new Set(['free', 'premium', 'pro']);
  const plan = allowed.has(req.params.plan) ? req.params.plan : 'free';
  // interval de démo : yearly par défaut (tuteur actif). ?interval=lifetime pour
  // tester le « à vie » (tuteur bloqué). free => none.
  const allowedIv = new Set(['monthly', 'yearly', 'lifetime']);
  const interval = plan === 'free' ? 'none' : (allowedIv.has(req.query.interval) ? req.query.interval : 'yearly');
  const email = `demo-${plan}@neocosive.local`;
  const name = `Demo ${plan}`;
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  const until = plan === 'free' ? null : new Date(Date.now() + 3650 * 24 * 3600 * 1000).toISOString();
  if (!user) {
    const hash = bcrypt.hashSync('demo1234', 10);
    const audience = plan === 'pro' ? 'pro' : 'public';
    const r = db.prepare('INSERT INTO users (email, password, name, audience, specialty, plan, premium_until, plan_interval) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(email, hash, name, audience, 'demo', plan, until, interval);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  } else {
    const audience = plan === 'pro' ? 'pro' : 'public';
    db.prepare('UPDATE users SET plan = ?, audience = ?, premium_until = ?, plan_interval = ? WHERE id = ?')
      .run(plan, audience, until, interval, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  req.session.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    audience: user.audience || 'public',
    plan: user.plan || 'free',
    premium_until: user.premium_until || null,
    plan_interval: user.plan_interval || 'none'
  };

  res.redirect('/');
});

// --- SEO : robots.txt + sitemap.xml ---
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /login
Disallow: /register
Sitemap: ${req.protocol}://${req.get('host')}/sitemap.xml
`);
});

app.get('/sitemap.xml', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const mods = loadModules();
  const urls = [
    { loc: '/', priority: '1.0', freq: 'weekly' },
    { loc: '/modules', priority: '0.9', freq: 'weekly' },
    { loc: '/premium', priority: '0.8', freq: 'monthly' }
  ];
  mods.forEach(m => {
    urls.push({ loc: `/module/${m.id}`, priority: '0.8', freq: 'weekly' });
    (m.lessons || []).forEach(l => urls.push({ loc: `/module/${m.id}/lesson/${l.id}`, priority: '0.6', freq: 'monthly' }));
    if (m.quiz) urls.push({ loc: `/module/${m.id}/quiz`, priority: '0.5', freq: 'monthly' });
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.map(u => `  <url><loc>${base}${u.loc}</loc><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority>
${LANGS.map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${base}${u.loc}?lang=${l}"/>`).join('\n')}
  </url>`).join('\n')}
</urlset>`;
  res.type('application/xml').send(xml);
});

// Language switch
app.get('/lang/:lang', (req, res) => {
  if (LANGS.includes(req.params.lang)) req.session.lang = req.params.lang;
  res.redirect(req.get('Referer') || '/');
});

// Tuteur V2 (Premium + RAG strict sur modules)
try {
  app.use(require('./tutor-training')({ requireAuth }));
  console.log('[tutor-training] monté');
} catch (e) {
  console.error('[tutor-training] KO', e.message);
}

// Start
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🎓 Neocosive Training running on port ${PORT} (freemium + premium + pro)`);
});
