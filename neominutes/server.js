/**
 * NeoMinutes - Serveur principal
 * Application Express pour la transcription, résumé et distribution de réunions
 * 
 * Endpoints principaux:
 * - /recordings - CRUD enregistrements
 * - /transcribe - Transcription standalone
 * - /templates - Gestion templates
 */

const express = require('express');
const { redis, cacheMiddleware, invalidateCache } = require("./redis-cache");
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { helmet, requestLogger, corsMiddleware, apiLimiter, aiLimiter, inputSanitizer } = require('./middleware/security');
const validation = require('./middleware/validation');

// Initialiser Express
const app = express();
app.set("trust proxy", 1);
const PORT = config.port;

// ===== MIDDLEWARE =====

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(corsMiddleware());
app.use(requestLogger);

// Skip rate limiting for health endpoint
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  apiLimiter(req, res, next);
});

// Landing page (before auth)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ===== ROUTES STATIQUES PUBLIQUES (AVANT AUTH) =====
app.use('/landing', express.static(path.join(__dirname, '..', 'public', 'landing')));
// Dashboard : NO-CACHE (évite que Cloudflare/navigateur servent une vieille version)
app.use('/dashboard', express.static(path.join(__dirname, '..', 'public', 'dashboard'), {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html')));

// Body parsing (avant les routes qui ont besoin de req.body)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== ROUTES PUBLIQUES (AVANT AUTH) =====

// Share routes (toutes publiques - l'auth est gérée dans share.js pour les routes protégées)
const shareRouter = require('./routes/share');
app.use('/share', shareRouter);

// Health check (before rate limit - no rate limiting on health)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'NeoMinutes',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    config: {
      openai: config.isConfigured('openai'),
      myclaw: config.isConfigured('myclaw'),
      anthropic: config.isConfigured('anthropic'),
      email: config.isConfigured('email'),
      telegram: config.isConfigured('telegram'),
      whatsapp: config.isConfigured('whatsapp')
    }
  });
});

// ===== AUTHENTIFICATION =====

// Authentification par API Key
const authMiddleware = require('./middleware/auth');

// Exempter /share/view de l'authentification
app.use('/share/view', (req, res, next) => {
  // La route publique /share/view/:token ne nécessite pas d'auth
  next();
});

app.use(authMiddleware);

// Input sanitization
app.use(inputSanitizer);

// Monitoring (Day 8)
const metricsRouter = require('./routes/metrics');
app.use('/metrics', metricsRouter);

// ===== ROUTES =====

// Recordings (CRUD + upload + stop)
const recordingsRouter = require('./routes/recordings');
app.use('/recordings', recordingsRouter);

// Transcription standalone
const transcribeRouter = require('./routes/transcribe');
app.use('/transcribe', transcribeRouter);

// Résumé
const summarizeRouter = require('./routes/summarize');
app.use(summarizeRouter);  // Note: Les routes sont sous /recordings/:id/summarize

// Export
const exportRouter = require('./routes/export');
app.use(exportRouter);  // Les routes sont sous /recordings/:id/export

// Envoi
const sendRouter = require('./routes/send');
app.use(sendRouter);  // Les routes sont sous /recordings/:id/send

// Templates
const templatesRouter = require('./routes/templates');
app.use('/templates', templatesRouter);

// Contacts (carnet d'adresses : médecin traitant, correspondants…)
const contactsRouter = require('./routes/contacts');
app.use('/contacts', contactsRouter);

// AI Chat + Q&A + Diarization
const aiRouter = require('./routes/ai');
app.use('/ai', aiLimiter, aiRouter);

// Streaming transcription (V2)
const streamRouter = require('./routes/stream');
app.use('/stream', aiLimiter, streamRouter);

// ===== FONCTIONNALITÉS PREMIUM =====

// Partage sécurisé (Feature 1) — déjà monté avant auth pour /share/view public
// Les routes POST/DELETE dans share.js vérifient l'auth en interne

// Actions (Feature 2)
const actionsRouter = require('./routes/actions');
app.use('/actions', actionsRouter);

// Recherche sémantique (Feature 3)
const semanticRouter = require('./routes/semantic');
app.use('/semantic', semanticRouter);

// Import URL (Feature 4)
const importRouter = require('./routes/import');
app.use('/import', importRouter);

// Anonymisation RGPD (Feature 5)
const anonymizeRouter = require('./routes/anonymize');
app.use('/anonymize', anonymizeRouter);

// Webhooks (Day 2)
const webhooksRouter = require('./routes/webhooks');
app.use('/webhooks', webhooksRouter);

// ===== NOUVELLES ROUTES (Jour 3-5) =====

// Suivi inter-réunions (Jour 3)
const compareRouter = require('./routes/compare');
app.use('/compare', compareRouter);

// Digest hebdomadaire (Jour 3)
const digestRouter = require('./routes/digest');
app.use('/digest', digestRouter);

// Audit trail (Jour 4)
const auditRouter = require('./routes/audit');
app.use('/audit', auditRouter);

// Rétention configurable (Jour 4)
const retentionRouter = require('./routes/retention');
app.use('/retention', retentionRouter);

// OpenAPI spec (Jour 5)
const openapiRouter = require('./routes/openapi');
app.use('/openapi', openapiRouter);

// Docs Swagger UI (accessible without auth)
app.get('/docs', (req, res, next) => {
  // Delegate to openapi route
  const openapiRouter = require('./routes/openapi');
  openapiRouter(req, res, next);
});

// ===== SCHEDULER POUR TÂCHES PLANIFIÉES =====

/**
 * Scheduler interne pour les tâches planifiées
 * - Digest hebdomadaire (lundi matin)
 * - Rappel des actions (quotidien)
 */
function startScheduler() {
  // Digest automatique chaque lundi à 8h00
  const digestCron = setInterval(async () => {
    const now = new Date();
    const day = now.getDay(); // 1 = lundi
    const hour = now.getHours();
    
    if (day === 1 && hour >= 8 && hour < 9) {
      console.log('[Scheduler] Exécution digest hebdomadaire...');
      
      try {
        const digestService = require('./services/digest');
        const sendEmail = require('./services/sendEmail');
        
        // Générer le digest pour la semaine dernière
        const digest = digestService.generateDigest('default');
        
        if (digest.recordings && digest.recordings.length > 0) {
          const text = digestService.formatDigestText(digest);
          
          // Envoyer par email si configuré
          if (config.isConfigured('email')) {
            await sendEmail.sendDigest(config.smtp.user, text);
            console.log('[Scheduler] Digest envoyé par email');
          }
          
          // Envoyer par Telegram si configuré
          if (config.isConfigured('telegram')) {
            const sendTelegram = require('./services/sendTelegram');
            await sendTelegram.sendDigest(config.telegram.chatId, text);
            console.log('[Scheduler] Digest envoyé par Telegram');
          }
        }
      } catch (e) {
        console.error('[Scheduler] Erreur digest:', e.message);
      }
    }
  }, 60 * 60 * 1000); // Vérifier chaque heure
  
  // Rappel des actions en retard (quotidien à 9h)
  const actionsCron = setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 9 && now.getMinutes() < 5) {
      console.log('[Scheduler] Vérification actions en retard...');
      
      try {
        const { db } = require('./models/recording');
        const nowIso = new Date().toISOString();
        
        // Marquer les actions overdue
        const result = db.prepare(`
          UPDATE action_items 
          SET status = 'overdue' 
          WHERE status = 'pending' AND deadline < ?
        `).run(nowIso);
        
        if (result.changes > 0) {
          console.log(`[Scheduler] ${result.changes} actions marquées en retard`);
          
          // Envoyer une notification Telegram
          if (config.isConfigured('telegram')) {
            const sendTelegram = require('./services/sendTelegram');
            await sendTelegram.sendMessage(
              config.telegram.chatId,
              `⚠️ ${result.changes} action(s) en retard! Check /actions/overdue`
            );
          }
        }
      } catch (e) {
        console.error('[Scheduler] Erreur actions:', e.message);
      }
    }
  }, 60 * 60 * 1000);
  
  console.log('[Scheduler] Démarré (digest lundi 8h, actions 9h)');
}

// ===== FICHIERS STATIQUES =====

// Servir les fichiers uploadés
const uploadDir = config.storage.uploadDir;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// Servir les exports
const exportStaticDir = path.join(__dirname, '..', 'exports');
if (!fs.existsSync(exportStaticDir)) {
  fs.mkdirSync(exportStaticDir, { recursive: true });
}
app.use('/exports', express.static(exportStaticDir));

// ===== HEALTH CHECK (moved before auth) =====

app.get('/api', (req, res) => {
  res.json({
    service: 'NeoMinutes',
    version: '2.0.0',
    description: 'Transcription, résumé et distribution de réunions (NeoMiN V2)',
    endpoints: {
      recordings: {
        'POST /recordings': 'Créer un enregistrement',
        'GET /recordings': 'Lister les enregistrements',
        'GET /recordings/:id': 'Obtenir un enregistrement (inclut speakers)',
        'PUT /recordings/:id': 'Mettre à jour',
        'DELETE /recordings/:id': 'Supprimer',
        'POST /recordings/:id/upload': 'Uploader fichier audio',
        'POST /recordings/:id/stop': 'Lancer transcription',
        'POST /recordings/:id/transcribe': 'Transcription à la demande',
        'GET /recordings/:id/transcript': 'Obtenir transcription',
        'GET /recordings/:id/summary': 'Obtenir résumé',
        // V2 Endpoints
        'GET /recordings/search': 'Recherche plein texte (V2)',
        'POST /recordings/import-url': 'Importer depuis URL (V2)',
        'POST /recordings/:id/ask': 'Poser question (V2)',
        'POST /recordings/:id/diarize': 'Diarization (V2)',
        'GET /recordings/:id/speakers': 'Obtenir locuteurs (V2)'
      },
      ai: {
        'POST /ai/chat': 'Chat IA général'
      },
      stream: {
        // V2 Endpoints
        'POST /stream/start': 'Démarrer session streaming',
        'POST /stream/:sessionId/chunk': 'Envoyer chunk audio',
        'GET /stream/:sessionId/transcript': 'Obtenir transcription partielle',
        'POST /stream/:sessionId/stop': 'Finaliser session',
        'GET /stream/:sessionId': 'Statut session',
        'DELETE /stream/:sessionId': 'Supprimer session'
      },
      transcribe: {
        'POST /transcribe': 'Transcription standalone'
      },
      summarize: {
        'POST /recordings/:id/summarize': 'Générer résumé'
      },
      export: {
        'POST /recordings/:id/export': 'Exporter (docx/pdf/markdown/txt)'
      },
      send: {
        'POST /recordings/:id/send': 'Envoyer par plusieurs canaux'
      },
      templates: {
        'GET /templates': 'Lister templates',
        'POST /templates': 'Créer template',
        'GET /templates/:id': 'Obtenir template'
      },
      contacts: {
        'GET /contacts': 'Lister les contacts',
        'POST /contacts': 'Créer un contact',
        'PUT /contacts/:id': 'Modifier un contact',
        'DELETE /contacts/:id': 'Supprimer un contact'
      },
      files: {
        '/uploads/*': 'Fichiers audio uploadés',
        '/exports/*': 'Fichiers exportés'
      }
    }
  });
});

// ===== ERREURS =====

// 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Non trouvé',
    message: `Route ${req.method} ${req.path} introuvable`
  });
});

// Gestionnaire d'erreurs
app.use((err, req, res, next) => {
  const log = {
    ts: new Date().toISOString(),
    method: req.method,
    path: req.path,
    error: err.message || 'Erreur serveur',
    status: err.status || 500
  };
  console.error('[Error]', JSON.stringify(log));
  if (config.nodeEnv === 'development') {
    console.error('[Error Stack]', err.stack);
  }
  
  res.status(err.status || 500).json({
    error: err.message || 'Erreur serveur interne',
    ...(config.nodeEnv === 'development' && { stack: err.stack })
  });
});

// ===== DEMARRAGE =====

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  NeoMinutes Server');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Port: ${PORT}`);
  console.log(`  Mode: ${config.nodeEnv}`);
  console.log(`  Upload dir: ${uploadDir}`);
  console.log(`  Export dir: ${exportStaticDir}`);
  console.log('');
  console.log('  Services:');
  console.log(`    - OpenAI: ${config.isConfigured('openai') ? '✅ configuré' : '❌ non configuré'}`);
  console.log(`    - MyClaw: ${config.isConfigured('myclaw') ? '✅ configuré' : '❌ non configuré'}`);
  console.log(`    - Anthropic: ${config.isConfigured('anthropic') ? '✅ configuré' : '❌ non configuré'}`);
  console.log(`    - Email: ${config.isConfigured('email') ? '✅ configuré' : '❌ non configuré'}`);
  console.log(`    - Telegram: ${config.isConfigured('telegram') ? '✅ configuré' : '❌ non configuré'}`);
  console.log(`    - WhatsApp: ${config.isConfigured('whatsapp') ? '✅ configuré' : '❌ non configuré'}`);
  console.log('');
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  Docs: http://localhost:${PORT}/docs`);
  console.log('═══════════════════════════════════════════════════════════');
  
  // Démarrer le scheduler
  if (config.nodeEnv === 'production') {
    startScheduler();
  }
});

module.exports = app;
