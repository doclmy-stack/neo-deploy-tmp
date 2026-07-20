/**
 * NeoMinutes - Service IA texte (chat) via curl.
 * Contourne le bug undici "Premature close" (Node -> Groq/OpenAI/Anthropic).
 *
 * ORDRE DE PRIORITÉ POUR LES RÉSUMÉS (qualité médicale) :
 *   1. MyClaw (gateway Anthropic-compatible, Claude Haiku) — MEILLEURE qualité de tri clinique
 *   2. Anthropic direct (Claude Haiku)
 *   3. OpenAI-compatible (Groq/Llama) — secours
 * NB : la TRANSCRIPTION (Whisper) reste sur Groq/OpenAI ailleurs (whisper.js), non concernée ici.
 * On peut forcer un provider via opts.provider = 'openai' | 'myclaw' | 'anthropic'.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');

function curlPost(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), 'nm-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
    try { fs.writeFileSync(tmp, JSON.stringify(bodyObj)); }
    catch (e) { return reject(new Error('tmp write: ' + e.message)); }
    const args = ['-sS', '--max-time', '180', url, '-H', 'Content-Type: application/json'];
    for (const k of Object.keys(headers)) { args.push('-H', k + ': ' + headers[k]); }
    args.push('--data-binary', '@' + tmp);
    execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch (e) {}
      if (err) return reject(new Error('curl: ' + (stderr || err.message)));
      const body = (stdout || '').trim();
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('Réponse non-JSON: ' + body.slice(0, 300))); }
    });
  });
}

// --- Providers unitaires ---

async function viaMyClaw(system, user, maxTokens) {
  const base = (process.env.MYCLAW_BASE_URL || '').replace(/\/$/, '');
  if (!process.env.MYCLAW_API_KEY || !base) return null;
  const model = process.env.MYCLAW_MODEL || process.env.AI_MODEL || 'claude-haiku-4.5';
  const data = await curlPost(base + '/messages',
    { 'x-api-key': process.env.MYCLAW_API_KEY, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
  if (data.error) throw new Error('myclaw: ' + (data.error.message || JSON.stringify(data.error)));
  const t = data.content && data.content[0] && data.content[0].text;
  return t || null;
}

async function viaAnthropic(system, user, maxTokens) {
  const key = config.anthropic && config.anthropic.apiKey;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  const data = await curlPost('https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
  if (data.error) throw new Error('anthropic: ' + (data.error.message || JSON.stringify(data.error)));
  const t = data.content && data.content[0] && data.content[0].text;
  return t || null;
}

async function viaOpenAI(system, user, temperature, maxTokens, json) {
  if (!config.openai || !config.openai.apiKey) return null;
  const base = (config.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const body = {
    model: config.openai.model,
    temperature,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  };
  if (json) body.response_format = { type: 'json_object' };
  const data = await curlPost(base + '/chat/completions',
    { 'Authorization': 'Bearer ' + config.openai.apiKey }, body);
  if (data.error) throw new Error('openai: ' + (data.error.message || JSON.stringify(data.error)));
  const t = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return t || null;
}

/**
 * chat(system, user, { temperature, maxTokens, json, provider }) -> string
 * Par défaut : Claude (MyClaw puis Anthropic) prioritaire pour la qualité, Groq/OpenAI en secours.
 * Si opts.json est demandé et que seul OpenAI le supporte proprement, on garde Claude en 1er
 * (Claude renvoie du JSON valide si le prompt le demande — ce qui est le cas via summarize.js).
 */
async function chat(system, user, opts = {}) {
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.3;
  const maxTokens = opts.maxTokens || 4000;
  const forced = opts.provider;

  const order = forced ? [forced] : ['myclaw', 'anthropic', 'openai'];
  let lastErr = null;

  for (const p of order) {
    try {
      let t = null;
      if (p === 'myclaw') t = await viaMyClaw(system, user, maxTokens);
      else if (p === 'anthropic') t = await viaAnthropic(system, user, maxTokens);
      else if (p === 'openai') t = await viaOpenAI(system, user, temperature, maxTokens, opts.json);
      if (t && String(t).trim()) return t;
    } catch (e) {
      lastErr = e;
      console.error('[aiText] provider ' + p + ' KO:', e.message);
    }
  }
  throw new Error(lastErr ? lastErr.message : 'Aucun LLM disponible (MyClaw/Anthropic/OpenAI).');
}

module.exports = { chat, curlPost };
