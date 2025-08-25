/* FireMeBot frontend — aligned to POST { title } */
(function () {
  const els = {
    roleInput: document.getElementById('roleInput'),
    goBtn: document.getElementById('goBtn'),
    results: document.getElementById('results'),
    status: document.getElementById('statusBar'),
    envStatus: document.getElementById('envStatus'),
    editEndpointBtn: document.getElementById('editEndpointBtn'),
    historyList: document.getElementById('historyList'),
    clearHistory: document.getElementById('clearHistory'),
  };

  // One source of truth for the endpoint
  let WORKER_URL =
    (window.FireMeBot && window.FireMeBot.WORKER_URL) ||
    localStorage.getItem('FMB_WORKER_URL') ||
    'https://firemebot-api.nat-1fa.workers.dev/api/roast';

  // ─────────────── UI helpers ───────────────
  function setEnvLabel() {
    if (!els.envStatus) return;
    els.envStatus.textContent = WORKER_URL ? `worker: ${WORKER_URL}` : 'worker: unset';
  }

  function setStatus(text, type = 'info') {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.classList.remove('ok', 'error', 'info');
    els.status.classList.add(type);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[m]));
  }

  function createCard(title, html, { pre = false } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.innerHTML = `
      <div class="card-hd">${escapeHtml(title)}</div>
      <div class="card-bd">${pre ? `<pre>${escapeHtml(html)}</pre>` : html}</div>
    `;
    return wrap;
  }

  // ─────────────── History ───────────────
  function renderHistory() {
    if (!els.historyList) return;
    els.historyList.innerHTML = '';
    const arr = JSON.parse(localStorage.getItem('FMB_HISTORY') || '[]');
    arr.forEach(item => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = item;
      btn.addEventListener('click', () => {
        els.roleInput.value = item;
        run(item);
      });
      li.appendChild(btn);
      els.historyList.appendChild(li);
    });
  }

  function saveHistory(q) {
    const key = 'FMB_HISTORY';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const exists = arr.indexOf(q);
    if (exists !== -1) arr.splice(exists, 1);
    arr.unshift(q);
    if (arr.length > 12) arr.pop();
    localStorage.setItem(key, JSON.stringify(arr));
    renderHistory();
  }

  // ─────────────── Core request (POST { title }) ───────────────
  async function run(q) {
    const query = (q ?? els.roleInput.value ?? '').trim();
    if (!query) {
      setStatus('Type a role first.', 'error');
      return;
    }
    if (!WORKER_URL) {
      setStatus('Set the Worker endpoint first.', 'error');
      return;
    }

    setStatus('Thinking…', 'info');

    try {
      const blocks = [];

      // Roast block (string or object pretty-print)
      if (typeof normalized.roast !== 'undefined' && normalized.roast !== null) {
        const roastText = typeof normalized.roast === 'string'
          ? normalized.roast
          : JSON.stringify(normalized.roast, null, 2);
        blocks.push(createCard('Roast', roastText, { pre: typeof normalized.roast !== 'string' }));
      }
      
      // Meta
      const metaLines = [];
      if (normalized.title)     metaLines.push(`<div><b>Input:</b> ${escapeHtml(normalized.title)}</div>`);
      if (normalized.riskTier)  metaLines.push(`<div><b>Risk tier:</b> ${escapeHtml(String(normalized.riskTier))}</div>`);
      if (normalized.rationale) metaLines.push(`<div><b>Rationale:</b> ${escapeHtml(normalized.rationale)}</div>`);
      if (normalized.timestamp) metaLines.push(`<div><b>Time:</b> ${escapeHtml(String(normalized.timestamp))}</div>`);
      if (metaLines.length) blocks.push(createCard('Details', metaLines.join('')));
      
      // If nothing else, show the whole payload so you’re never blind
      if (!blocks.length) {
        blocks.push(createCard('Raw response', JSON.stringify(normalized.raw, null, 2), { pre: true }));
      }


      const data = await resp.json();

      // Expected response shape (keep in sync with worker.js)
      // { input?, title?, roast, riskTier, rationale, timestamp }
      const blocks = [];

      if (data.roast) {
        // Pretty-print the roast object or string
        const roastText = typeof data.roast === 'string'
          ? data.roast
          : JSON.stringify(data.roast, null, 2);
        blocks.push(createCard('Roast', roastText, { pre: typeof data.roast !== 'string' }));
      }

      const metaLines = [];
      if (data.title || data.input) metaLines.push(`<div><b>Input:</b> ${escapeHtml(data.title || data.input)}</div>`);
      if (data.riskTier) metaLines.push(`<div><b>Risk tier:</b> ${escapeHtml(data.riskTier)}</div>`);
      if (data.rationale) metaLines.push(`<div><b>Rationale:</b> ${escapeHtml(data.rationale)}</div>`);
      if (data.timestamp) metaLines.push(`<div><b>Time:</b> ${escapeHtml(data.timestamp)}</div>`);

      if (metaLines.length) {
        blocks.push(createCard('Details', metaLines.join('')));
      }

      if (!blocks.length) {
        blocks.push(createCard('Raw response', JSON.stringify(data, null, 2), { pre: true }));
      }

      // Render newest first
      blocks.reverse().forEach(b => els.results.prepend(b));

      saveHistory(query);
      setStatus('Done.', 'ok');
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Request failed', 'error');

      const msg = String(err.message || err).toLowerCase();
      if (msg.includes('cors')) {
        const hintHtml = `
          <p>Your browser blocked the response due to CORS.</p>
          <ul>
            <li>Add <code>Access-Control-Allow-Origin</code> for <code>https://natwerth.github.io</code> on the Worker.</li>
            <li>Handle <code>OPTIONS</code> preflight on <code>/api/roast</code>.</li>
            <li>Return <code>Content-Type: application/json</code> on success and errors.</li>
          </ul>`;
        els.results.prepend(createCard('CORS hint', hintHtml));
      }
    }
  }

  // ─────────────── Wire up UI ───────────────
  setEnvLabel();
  renderHistory();

  if (els.editEndpointBtn) {
    els.editEndpointBtn.addEventListener('click', () => {
      const next = prompt('Worker endpoint URL', WORKER_URL || 'https://firemebot-api.nat-1fa.workers.dev/api/roast');
      if (!next) return;
      WORKER_URL = next.trim();
      localStorage.setItem('FMB_WORKER_URL', WORKER_URL);
      setEnvLabel();
      setStatus('Endpoint saved.', 'ok');
    });
  }

  if (els.goBtn) {
    els.goBtn.addEventListener('click', () => run());
  }

  if (els.roleInput) {
    els.roleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') run();
    });
  }

  // Auto-focus
  setTimeout(() => els.roleInput && els.roleInput.focus(), 100);
})();
