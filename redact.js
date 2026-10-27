// Credentials sometimes get written straight into formulas, descriptions or help text
// (a managed package shipped a Google Maps key in a formula). Nothing that looks like one
// is ever stored: scan_tech.js replaces it with a [REDACTED: …] marker and records what
// kind it was, so analyze.js can still report the field.
const PATTERNS = [
  ['Google API key', /AIza[0-9A-Za-z_\-]{35}/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g],
  ['Stripe key', /\b[sr]k_live_[0-9A-Za-z]{20,}\b/g],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
];
// key=value in URLs and assignments; only the value is replaced, and it must be long enough
// to be a credential rather than a field reference
const PARAM = /([?&](?:key|api_?key|apikey|token|access_token|client_secret|sig|signature)=)([^&"'\s)]{16,})/gi;
const ASSIGN = /(\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*["'])([^"'\s]{12,})(["'])/gi;

// -> { text, kinds }   kinds is [] when nothing was found
function redact(text) {
  if (!text) return { text: text || '', kinds: [] };
  let out = String(text);
  const kinds = new Set();
  for (const [kind, re] of PATTERNS) out = out.replace(re, () => { kinds.add(kind); return '[REDACTED: ' + kind + ']'; });
  out = out.replace(PARAM, (m, pre, v) => (/^\[REDACTED/.test(v) ? m : (kinds.add('Credential in a URL'), pre + '[REDACTED]')));
  out = out.replace(ASSIGN, (m, pre, v, post) => (kinds.add('Password or secret'), pre + '[REDACTED]' + post));
  return { text: out, kinds: [...kinds] };
}
module.exports = { redact };
