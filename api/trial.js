// Prueba gratis de 7 dias — backend serverless (Vercel Functions).
//
// Emite UNA sola prueba por PC. La identidad de la PC es el HWID que manda el exe
// (el mismo que usa la licencia: MachineGuid). Guardamos en Vercel KV un registro
// PERMANENTE por HWID, asi aunque el usuario borre el estado local, cambie de mail
// o se haga otra "cuenta", esa computadora NO puede sacar otra prueba.
//
// El anti-abuso real vive ACA (del lado del server, al emitir). El exe solo confia
// en la respuesta. Un cracker podria parchear el exe para saltear esto, pero eso ya
// es "crackear" (mismo caso que la licencia), no el abuso casual de sacar 10 pruebas.
//
// Env vars: KV_REST_API_URL + KV_REST_API_TOKEN (las setea la integracion KV de Vercel).

const TRIAL_DAYS = 7;

// Llama a Vercel KV (Upstash) por su REST API con comandos estilo Redis.
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const hwid = String(body.hwid || '').trim();
  const product = String(body.product || 'spectro').trim().toLowerCase();
  if (hwid.length < 3) { res.status(400).json({ error: 'hwid' }); return; }

  const key = `trial:${product}:${hwid}`;
  const now = Date.now();

  try {
    // ¿Esta PC ya pidio una prueba alguna vez?
    const existing = await kv(['GET', key]);
    if (existing) {
      const rec = typeof existing === 'string' ? JSON.parse(existing) : existing;
      res.status(200).json({
        status: rec.expiresAt > now ? 'active' : 'expired',
        issuedAt: new Date(rec.issuedAt).toISOString(),
        expiresAt: new Date(rec.expiresAt).toISOString(),
        isNew: false,
      });
      return;
    }
    // Primera vez: emitimos la prueba y la dejamos registrada PARA SIEMPRE.
    const expiresAt = now + TRIAL_DAYS * 24 * 60 * 60 * 1000;
    await kv(['SET', key, JSON.stringify({ issuedAt: now, expiresAt })]);
    res.status(200).json({
      status: 'active',
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      isNew: true,
    });
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
};
