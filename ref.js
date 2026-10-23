/* Afiliados — código o link de referido en la landing.
   Un afiliado comparte https://spectrofivem.vercel.app/?ref=ALIAS (o su link de Lemon
   Squeezy, ?aff=ID). Acá se valida contra /api/code (op 'affref'), se guarda 30 días en
   este navegador y se reescriben los botones de compra con ?aff=<id> (Lemon Squeezy le
   cuenta la venta al afiliado) y el descuento del 10% para el comprador. */
(function () {
  var API = '/api/code';
  var KEY = 'sp_ref';
  var DAYS = 30;
  var SEL = 'a[href*="lemonsqueezy.com/checkout/buy/"]';

  function load() {
    try {
      var r = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (r && r.aff && r.exp > Date.now()) return r;
    } catch (e) {}
    return null;
  }
  function save(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {} }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  function resolve(ref) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'affref', ref: ref })
    }).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    });
  }

  // Botones de compra: guardan su link original para poder quitar el código.
  function apply(r) {
    [].forEach.call(document.querySelectorAll(SEL), function (a) {
      if (!a.dataset.base) a.dataset.base = a.href;
      if (!r) { a.href = a.dataset.base; return; }
      var u = new URL(a.dataset.base);
      u.searchParams.set('aff', r.aff);
      if (r.discount) u.searchParams.set('checkout[discount_code]', r.discount);
      a.href = u.toString();
    });
  }

  var plans = document.getElementById('planes');
  if (!plans) return;
  var anchor = plans.querySelector('.plans');

  var banner = document.createElement('div');
  banner.className = 'ref-banner';
  banner.hidden = true;
  banner.setAttribute('role', 'status');
  if (anchor) plans.insertBefore(banner, anchor);

  var form = document.createElement('form');
  form.className = 'ref-form';
  form.innerHTML =
    '<label for="ref-code">¿Tenés un código de afiliado?</label>' +
    '<div class="ref-row"><input id="ref-code" name="ref" autocomplete="off" spellcheck="false" maxlength="64" placeholder="Ej. MATI">' +
    '<button class="btn btn-sm btn-ghost" type="submit">Aplicar</button></div>' +
    '<p class="ref-msg" aria-live="polite"></p>';
  var note = plans.querySelector('.pay-note');
  if (note && note.parentNode) note.parentNode.insertBefore(form, note.nextSibling);
  else plans.appendChild(form);
  var input = form.querySelector('input');
  var msg = form.querySelector('.ref-msg');

  function show(r) {
    apply(r);
    if (r) {
      banner.innerHTML = '';
      var t = document.createElement('span');
      t.innerHTML = r.discount
        ? 'Código <b></b> aplicado: <strong>10% de descuento</strong> en cualquier plan.'
        : 'Código <b></b> aplicado.';
      t.querySelector('b').textContent = r.alias || r.aff;
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'ref-x';
      x.textContent = 'Quitar';
      x.addEventListener('click', function () { clear(); show(null); });
      banner.appendChild(t);
      banner.appendChild(x);
      banner.hidden = false;
      form.hidden = true;
    } else {
      banner.hidden = true;
      form.hidden = false;
    }
  }

  function use(ref, fromForm) {
    msg.textContent = fromForm ? 'Verificando…' : '';
    msg.className = 'ref-msg';
    return resolve(ref).then(function (j) {
      if (!j || !j.aff) {
        msg.textContent = 'Ese código no existe. Revisalo y probá de nuevo.';
        msg.className = 'ref-msg err';
        return;
      }
      var r = { aff: j.aff, alias: j.alias || '', discount: j.discount || '', exp: Date.now() + DAYS * 864e5 };
      save(r);
      msg.textContent = '';
      show(r);
    }).catch(function () {
      msg.textContent = 'No pude verificar el código ahora. Probá de nuevo en un rato.';
      msg.className = 'ref-msg err';
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value.trim();
    if (v) use(v, true);
  });

  // Prioridad: el código que viene en el link; si no, el que quedó guardado.
  var q = new URLSearchParams(location.search);
  var fromUrl = (q.get('ref') || q.get('aff') || '').trim();
  if (fromUrl) {
    use(fromUrl, false).then(function () {
      if (form.hidden) return;                 // no se aplicó: se ve el error en la cajita
      input.value = fromUrl;
    });
    // Sacar el parámetro de la barra para que no se comparta sin querer.
    q.delete('ref'); q.delete('aff');
    var rest = q.toString();
    try { history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash); } catch (e) {}
  } else {
    show(load());
  }
})();
