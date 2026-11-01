// Storefront behavior: cart (kept in the browser), add to cart, product
// gallery, mobile menu, age gate, cart and checkout pages.
(() => {
  const KEY = 'sf_cart', AGE = 'sf_age_ok';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

  const load = () => { try { return JSON.parse(store(KEY)) || []; } catch { return []; } };
  const save = (cart) => { store(KEY, JSON.stringify(cart)); renderCount(); };
  const renderCount = () => { const n = load().reduce((s, i) => s + i.qty, 0); $$('[data-cart-count]').forEach((el) => { el.textContent = n; el.hidden = n === 0; }); };

  // Money formatting uses the store's currency, read from the page.
  const fmt = new Intl.NumberFormat(document.body.dataset.locale || 'en-US', { style: 'currency', currency: (document.body.dataset.currency || 'usd').toUpperCase() });
  const money = (c) => fmt.format(c / 100);
  const shippingFor = (el, sub) => { const free = el.dataset.freeOver; return free !== '' && sub >= Number(free) ? 0 : Number(el.dataset.flat || 0); };

  // Toast
  const toastEl = $('[data-toast]'); let toastT;
  const toast = (html) => { if (!toastEl) return; toastEl.innerHTML = html; toastEl.hidden = false; requestAnimationFrame(() => toastEl.classList.add('show')); clearTimeout(toastT); toastT = setTimeout(() => { toastEl.classList.remove('show'); setTimeout(() => { toastEl.hidden = true; }, 250); }, 3200); };

  // Mobile menu
  const menuBtn = $('[data-menu]');
  if (menuBtn) menuBtn.addEventListener('click', () => { const open = menuBtn.getAttribute('aria-expanded') !== 'true'; menuBtn.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('menu-open', open); });

  // Age gate (restricted mode)
  const gate = $('[data-age-gate]');
  if (gate && store(AGE) !== '1') {
    gate.hidden = false; document.body.classList.add('gated');
    $('[data-age-yes]', gate).focus();
    $('[data-age-yes]', gate).addEventListener('click', () => { store(AGE, '1'); gate.hidden = true; document.body.classList.remove('gated'); });
  }

  // Product page: gallery
  const gallery = $('[data-gallery]');
  if (gallery) gallery.addEventListener('click', (e) => {
    const t = e.target.closest('.thumb'); if (!t) return;
    $('.gallery-main img', gallery).src = t.dataset.src;
    $$('.thumb', gallery).forEach((b) => b.removeAttribute('aria-current')); t.setAttribute('aria-current', 'true');
  });

  // Product page: options, quantity, add to cart
  const form = $('[data-add-form]');
  if (form) {
    const btn = $('[data-add-btn]', form), qty = form.qty;
    const chosen = () => $('input[name=variant]:checked', form) || $('input[name=variant][type=hidden]', form);
    const sync = () => {
      const o = chosen(); if (!o) return;
      $('[data-price]').textContent = money(Number(o.dataset.price));
      const was = $('[data-was]'); was.hidden = !o.dataset.compare; was.textContent = o.dataset.compare ? money(Number(o.dataset.compare)) : '';
      $('[data-stock-note]', form).textContent = o.dataset.stock || '';
      const out = o.hasAttribute('data-soldout'); btn.disabled = out; btn.textContent = out ? 'Sold out' : 'Add to cart';
    };
    form.addEventListener('change', sync);
    form.addEventListener('click', (e) => { const s = e.target.closest('[data-step]'); if (!s) return; qty.value = Math.max(1, Math.min(20, (parseInt(qty.value, 10) || 1) + Number(s.dataset.step))); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const o = chosen(); if (!o || o.hasAttribute('data-soldout')) return;
      const n = Math.max(1, Math.min(20, parseInt(qty.value, 10) || 1));
      const cart = load(); const line = cart.find((i) => i.id === o.value);
      const label = o.dataset.label === 'Default' ? form.dataset.name : `${form.dataset.name}, ${o.dataset.label}`;
      if (line) line.qty = Math.min(20, line.qty + n);
      else cart.push({ id: o.value, label, price: Number(o.dataset.price), qty: n, image: form.dataset.image });
      save(cart);
      const badge = $('.cart-count'); if (badge && badge.animate) badge.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 350 });
      toast(`<span>Added ${n > 1 ? `${n} × ` : ''}${esc(label)}</span><a href="/cart">View cart</a>`);
    });
    sync();
  }

  // Cart page
  const cartEl = $('[data-cart]');
  const renderCart = () => {
    const cart = load();
    if (!cart.length) { cartEl.innerHTML = $('[data-empty-tpl]').innerHTML; return; }
    const sub = cart.reduce((s, i) => s + i.price * i.qty, 0), ship = shippingFor(cartEl, sub), free = cartEl.dataset.freeOver;
    cartEl.innerHTML = `
      <ul class="cart-lines">${cart.map((i, n) => `
        <li class="cart-line">
          <div class="cart-thumb">${i.image ? `<img src="${esc(i.image)}" alt="">` : ''}</div>
          <div class="cart-info"><strong>${esc(i.label)}</strong><span class="muted">${money(i.price)} each</span>
            <button class="link-btn" data-remove="${n}">Remove</button></div>
          <label class="qty small"><span class="sr-only">Quantity</span><button type="button" data-cstep="-1" data-n="${n}" aria-label="Less">−</button><input type="number" min="1" max="20" value="${i.qty}" data-qty="${n}"><button type="button" data-cstep="1" data-n="${n}" aria-label="More">+</button></label>
          <div class="cart-total">${money(i.price * i.qty)}</div>
        </li>`).join('')}
      </ul>
      <div class="cart-foot">
        ${free !== '' && sub < Number(free) ? `<p class="free-note">Add ${money(Number(free) - sub)} more for free shipping.</p>` : ''}
        <dl class="totals"><dt>Subtotal</dt><dd>${money(sub)}</dd><dt>Shipping</dt><dd>${ship ? money(ship) : 'Free'}</dd><dt class="grand">Total</dt><dd class="grand">${money(sub + ship)}</dd></dl>
        <div class="row end"><a class="btn btn-ghost" href="/shop">Keep shopping</a><a class="btn btn-primary btn-lg" href="/checkout">Check out</a></div>
      </div>`;
  };
  if (cartEl) {
    renderCart();
    const setQty = (n, q) => { const cart = load(); if (!cart[n]) return; cart[n].qty = Math.max(1, Math.min(20, q || 1)); save(cart); renderCart(); };
    cartEl.addEventListener('click', (e) => {
      if (e.target.dataset.remove !== undefined) { const cart = load(); cart.splice(Number(e.target.dataset.remove), 1); save(cart); renderCart(); }
      const s = e.target.closest('[data-cstep]'); if (s) { const n = Number(s.dataset.n); setQty(n, load()[n].qty + Number(s.dataset.cstep)); }
    });
    cartEl.addEventListener('change', (e) => { if (e.target.dataset.qty !== undefined) setQty(Number(e.target.dataset.qty), parseInt(e.target.value, 10)); });
  }

  // Checkout page: order summary, hidden items field, live shipping + tax for the address
  const co = $('[data-checkout]');
  if (co) {
    const cart = load(), sum = $('[data-summary]', co);
    if (!cart.length) {
      sum.innerHTML = '';
      $('.checkout-form', co).innerHTML = '<div class="empty"><p>Your cart is empty.</p><a class="btn btn-primary" href="/shop">Start shopping</a></div>';
    } else {
      const sub = cart.reduce((s, i) => s + i.price * i.qty, 0);
      const taxLabel = sum.dataset.taxLabel || 'Sales tax';
      const draw = (q) => {
        const ship = q ? q.shipping : shippingFor(co, sub);
        const tax = q && q.taxReady ? q.tax : null;
        const total = (q ? q.subtotal : sub) + ship + (tax || 0);
        sum.innerHTML = `<h2 class="h3">Order summary</h2><ul class="sum-lines">${cart.map((i) => `<li><span class="sum-thumb">${i.image ? `<img src="${esc(i.image)}" alt="">` : ''}<b>${i.qty}</b></span><span>${esc(i.label)}</span><span>${money(i.price * i.qty)}</span></li>`).join('')}</ul>
          <dl class="totals"><dt>Subtotal</dt><dd>${money(q ? q.subtotal : sub)}</dd><dt>Shipping</dt><dd>${ship ? money(ship) : 'Free'}</dd>
          <dt>${esc(taxLabel)}</dt><dd>${tax === null ? '<span class="muted small">Added from your address</span>' : tax ? money(tax) : money(0)}</dd>
          <dt class="grand">Total</dt><dd class="grand">${money(total)}</dd></dl>
          <a class="text-link small" href="/cart">Edit cart</a>`;
      };
      draw(null);
      const items = cart.map(({ id, qty }) => ({ id, qty }));
      $('[data-items-field]', co).value = JSON.stringify(items);
      const form = $('.checkout-form', co);
      let t, seq = 0;
      const requote = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const f = new FormData(form); const mine = ++seq;
          const body = { items, address1: f.get('address1'), city: f.get('city'), state: f.get('state'), zip: f.get('zip'), country: f.get('country') };
          if (!body.state || String(body.zip || '').trim().length < 3) return draw(null);
          try {
            const r = await fetch('/checkout/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const q = await r.json(); if (mine === seq && !q.error) draw(q);
          } catch {}
        }, 450);
      };
      form.addEventListener('input', (e) => { if (/^(state|zip|city|country|address1)$/.test(e.target.name)) requote(); });
      requote();
      // Button text follows the payment choice.
      const btn = $('[data-pay-btn]', form);
      const syncBtn = () => { const m = $('input[name=method]:checked', form); if (btn) btn.textContent = (m && m.dataset.button) || 'Place order'; };
      form.addEventListener('change', (e) => { if (e.target.name === 'method') syncBtn(); });
      syncBtn();
    }
  }

  // Order page: upload a payment screenshot (resized in the browser first)
  const proof = $('[data-proof]');
  if (proof) {
    const input = $('[data-proof-input]', proof), status = $('[data-proof-status]', proof);
    input.addEventListener('change', async () => {
      const file = input.files[0]; input.value = ''; if (!file) return;
      status.textContent = 'Uploading…';
      try {
        const data = await new Promise((resolve, reject) => {
          const img = new Image(); const u = URL.createObjectURL(file);
          img.onload = () => { const sc = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); resolve(c.toDataURL('image/jpeg', 0.85)); };
          img.onerror = () => reject(new Error('That file isn’t an image this browser can read.')); img.src = u;
        });
        const r = await fetch(proof.dataset.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
        const out = await r.json(); if (!r.ok) throw new Error(out.error || 'Upload failed.');
        status.textContent = 'Got it. We’ll check it and email you when your payment is confirmed.';
      } catch (err) { status.textContent = err.message; }
    });
  }

  // Paid order page: empty the cart
  if ($('[data-clear-cart]')) save([]);

  // Confirm before destructive admin actions
  $$('form[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));

  renderCount();
})();
