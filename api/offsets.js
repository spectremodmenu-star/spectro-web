// Offsets GATEADOS — el candado recurrente.
//
// Los offsets (donde leer en memoria) son el dato esencial y PERECEDERO del cheat:
// cada parche del juego los rompe. Este endpoint los entrega SOLO a una PC con
// entitlement valido (codigo/prueba viva en KV, o licencia valida en Lemon Squeezy).
// Un exe clonado/craqueado sin licencia NO recibe offsets nuevos -> al proximo parche
// del juego deja de funcionar solo. Dar de baja a alguien (borra su registro) tambien
// le corta los offsets.
//
//   POST /api/offsets  {product, hwid, key?}  -> 200 con el offsets.json | 403 sin entitlement
//
// Los offsets viven en KV (offsets:<product>), se actualizan con /api/code op=setoffsets.

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
  return (await r.json()).result;
}

// Valida una licencia contra Lemon Squeezy (la clave ES la credencial; endpoint publico).
async function lsValid(key, hwid) {
  try {
    const r = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: `license_key=${encodeURIComponent(key)}&instance_name=${encodeURIComponent(hwid)}`,
    });
    const j = await r.json();
    return j && (j.valid === true || (j.license_key && j.license_key.status === 'active'));
  } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const product = String(body.product || '').trim().toLowerCase();
  const hwid = String(body.hwid || '').trim();
  const key = String(body.key || '').trim();
  if (!product || hwid.length < 3) { res.status(400).json({ error: 'args' }); return; }

  try {
    const now = Date.now();
    let ok = false;

    // 1) codigo/prueba: registro vivo en KV (dar de baja lo borra -> corta offsets)
    const raw = await kv(['GET', `trial:${product}:${hwid}`]);
    if (raw) {
      const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (rec && rec.expiresAt > now) ok = true;
    }
    // 2) licencia paga: validar contra Lemon Squeezy
    if (!ok && key.length > 0) ok = await lsValid(key, hwid);

    if (!ok) { res.status(403).json({ error: 'no_entitlement' }); return; }

    const offs = await kv(['GET', `offsets:${product}`]);
    if (!offs) { res.status(404).json({ error: 'no_offsets' }); return; }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(typeof offs === 'string' ? offs : JSON.stringify(offs));
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
};
