// Admin product form: add/remove option rows, upload photos (resized in the
// browser first so a 12 MB phone photo becomes ~300 KB), reorder images.
(() => {
  const form = document.querySelector('[data-admin-form]');
  if (!form) return;
  const csrf = form.querySelector('input[name=csrf]').value;
  const list = form.querySelector('[data-rows="image"]');
  const tpl = form.querySelector('[data-tpl="image"]').innerHTML;
  const status = form.querySelector('[data-upload-status]');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const addImage = (src) => list.insertAdjacentHTML('beforeend', tpl.replace(/__SRC__/g, esc(src)));

  form.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-row]');
    if (add) {
      const kind = add.dataset.addRow;
      const rows = form.querySelector(`[data-rows="${kind}"]`);
      rows.insertAdjacentHTML('beforeend', form.querySelector(`[data-tpl="${kind}"]`).innerHTML);
      const first = rows.lastElementChild.querySelector('input:not([type=hidden])'); if (first) first.focus();
      return;
    }
    const rm = e.target.closest('[data-remove-row]');
    if (rm) { rm.closest('[data-row]').remove(); return; }
    const first = e.target.closest('[data-img-first]');
    if (first) { list.prepend(first.closest('[data-row]')); return; }
    if (e.target.closest('[data-img-add]')) {
      const input = form.querySelector('[data-img-url]'); const url = input.value.trim();
      if (/^https:\/\//i.test(url)) { addImage(url); input.value = ''; } else { input.focus(); status.textContent = 'Image links must start with https://'; }
    }
  });

  // Resize to at most 1600px on the long side and re-encode as WebP (JPEG fallback).
  function resize(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1600, scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        let data = c.toDataURL('image/webp', 0.85);
        if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} isn't an image this browser can read.`)); };
      img.src = url;
    });
  }

  form.querySelector('[data-upload]').addEventListener('change', async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    for (const [i, file] of files.entries()) {
      status.textContent = `Uploading ${i + 1} of ${files.length}…`;
      try {
        const data = await resize(file);
        const res = await fetch('/admin/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf, data }) });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || 'Upload failed.');
        addImage(out.url);
      } catch (err) { status.textContent = err.message; return; }
    }
    status.textContent = `Done. Click “${form.querySelector('button[type=submit]').textContent.trim()}” to save.`;
  });
})();
