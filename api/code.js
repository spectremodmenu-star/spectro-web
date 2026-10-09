// Codigos de regalo — backend serverless (Vercel Functions).
//
// Un codigo lo canjea una PC y le deja el producto habilitado (por defecto PARA
// SIEMPRE). Es el camino "gratis sin Lemon Squeezy": no toca la tienda ni cobra.
// La habilitacion se guarda en el MISMO registro que la prueba (trial:<prod>:<hwid>),
// asi el arranque del exe (que ya consulta /api/trial) la ve como "activa" y la
// cachea para andar offline. La diferencia con la prueba es la fecha: aca es lejana.
//
//   POST /api/code {op:'redeem', code, hwid, product}  -> canjea (publico)
//   POST /api/code {op:'mkcode', admin, code, uses?, days?, product?}  -> crea/edita un codigo
//                   admin = el secreto en claro; se compara su SHA-256 con ADMIN_HASH.
//                   uses: cuantas PCs distintas pueden canjearlo (0 = ilimitado). Default 1.
//                   days: vigencia en dias (0/ausente = permanente).
//   POST /api/code {op:'status', admin, code, product?}   -> quienes lo canjearon y su estado
//   POST /api/code {op:'revoke', admin, code|hwid, product?} -> DA DE BAJA (corta el acceso)
//                   revoke por code = corta a TODAS las PCs que lo canjearon.
//                   revoke por hwid = corta solo esa PC.
//                   Surte efecto cuando la PC vuelve a estar online (igual que una
//                   licencia: offline hay una gracia por la cache local del exe).
//
// El secreto NO vive aca: solo su hash (ver .secrets/admin.txt en la PC del autor).
// Env vars: KV_REST_API_URL + KV_REST_API_TOKEN (las setea la integracion KV de Vercel).

const crypto = require('crypto');

// SHA-256 del secreto de admin. El secreto en claro queda local (no en el repo).
const ADMIN_HASH = '7e515602af8bdf902a7f3abe2d9caa5bc03a9c29e4d6ca1071f726371c820f34';

// Fecha "para siempre" (lejana pero representable sin problemas en JS/.NET).
const FOREVER_MS = Date.parse('2099-01-01T00:00:00Z');

async function kv(cmd) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV_NOT_CONFIGURED');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('KV_HTTP_' + r.status);
  const j = await r.json();
  return j.result;
}

function parse(v) { return typeof v === 'string' ? JSON.parse(v) : v; }

// Normaliza un codigo igual que el exe: sin espacios, mayusculas.
function normCode(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const op = String(body.op || '').toLowerCase();
  const product = String(body.product || 'spectro').trim().toLowerCase();
  const now = Date.now();

  try {
    // --- Crear/editar un codigo (protegido por el hash del secreto) ---------
    if (op === 'mkcode') {
      const given = crypto.createHash('sha256').update(String(body.admin || '')).digest('hex');
      if (given !== ADMIN_HASH) { res.status(401).json({ error: 'admin' }); return; }
      const code = normCode(body.code);
      if (code.length < 4) { res.status(400).json({ error: 'code' }); return; }
      const uses = Number.isFinite(body.uses) ? Math.max(0, Math.floor(body.uses)) : 1;
      const days = Number.isFinite(body.days) ? Math.max(0, Math.floor(body.days)) : 0;
      const rec = { uses, used: 0, days, createdAt: now };
      await kv(['SET', `code:${product}:${code}`, JSON.stringify(rec)]);
      res.status(200).json({ ok: true, code, product, uses, days });
      return;
    }

    // --- Canjear un codigo (publico) ----------------------------------------
    if (op === 'redeem') {
      const code = normCode(body.code);
      const hwid = String(body.hwid || '').trim();
      if (hwid.length < 3) { res.status(400).json({ error: 'hwid' }); return; }
      if (code.length < 4) { res.status(400).json({ error: 'code' }); return; }

      const trialKey = `trial:${product}:${hwid}`;

      // Idempotente: si esta PC ya canjeo un codigo, devolver eso sin gastar otro uso.
      const prev = await kv(['GET', trialKey]);
      if (prev) {
        const p = parse(prev);
        if (p && typeof p.source === 'string' && p.source.startsWith('code:')) {
          res.status(200).json({
            status: p.expiresAt > now ? 'active' : 'expired',
            issuedAt: new Date(p.issuedAt).toISOString(),
            expiresAt: new Date(p.expiresAt).toISOString(),
            isNew: false,
          });
          return;
        }
      }

      const codeKey = `code:${product}:${code}`;
      const raw = await kv(['GET', codeKey]);
      if (!raw) { res.status(404).json({ error: 'code' }); return; }
      const rec = parse(raw);
      if (rec.uses > 0 && rec.used >= rec.uses) { res.status(410).json({ error: 'used' }); return; }

      const expiresAt = rec.days && rec.days > 0 ? now + rec.days * 86400000 : FOREVER_MS;
      await kv(['SET', trialKey, JSON.stringify({ issuedAt: now, expiresAt, source: 'code:' + code })]);
      if (rec.uses > 0) { rec.used += 1; await kv(['SET', codeKey, JSON.stringify(rec)]); }
      // Anota la PC bajo el codigo, asi un revoke por codigo las encuentra a todas.
      await kv(['SADD', `code:${product}:${code}:hwids`, hwid]);

      res.status(200).json({
        status: 'active',
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        isNew: true,
      });
      return;
    }

    // --- Ver quien canjeo un codigo y su estado (admin) ---------------------
    if (op === 'status') {
      const given = crypto.createHash('sha256').update(String(body.admin || '')).digest('hex');
      if (given !== ADMIN_HASH) { res.status(401).json({ error: 'admin' }); return; }
      const code = normCode(body.code);
      if (code.length < 4) { res.status(400).json({ error: 'code' }); return; }
      const rec = parse(await kv(['GET', `code:${product}:${code}`]));
      const hwids = (await kv(['SMEMBERS', `code:${product}:${code}:hwids`])) || [];
      const pcs = [];
      for (const h of hwids) {
        const t = parse(await kv(['GET', `trial:${product}:${h}`]));
        pcs.push({
          hwid: h,
          state: !t ? 'revoked' : (t.expiresAt > now ? 'active' : 'expired'),
          expiresAt: t ? new Date(t.expiresAt).toISOString() : null,
        });
      }
      res.status(200).json({ code, product, uses: rec ? rec.uses : null, used: rec ? rec.used : null, pcs });
      return;
    }

    // --- Dar de baja: cortar el acceso (admin) ------------------------------
    if (op === 'revoke') {
      const given = crypto.createHash('sha256').update(String(body.admin || '')).digest('hex');
      if (given !== ADMIN_HASH) { res.status(401).json({ error: 'admin' }); return; }
      const hwid = String(body.hwid || '').trim();
      const code = normCode(body.code);
      let cut = 0;
      if (hwid.length >= 3) {
        await kv(['DEL', `trial:${product}:${hwid}`]); cut = 1;
      } else if (code.length >= 4) {
        const hwids = (await kv(['SMEMBERS', `code:${product}:${code}:hwids`])) || [];
        for (const h of hwids) { await kv(['DEL', `trial:${product}:${h}`]); cut++; }
      } else {
        res.status(400).json({ error: 'need code or hwid' }); return;
      }
      res.status(200).json({ ok: true, revoked: cut });
      return;
    }

    res.status(400).json({ error: 'op' });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
};
