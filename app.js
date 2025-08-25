/* FireMeBot — frontend with gauge + tiles */
(function () {
  const els = {
    roleInput: document.getElementById('roleInput'),
    goBtn: document.getElementById('goBtn'),
    results: document.getElementById('results'),
    status: document.getElementById('statusBar'),
    envStatus: document.getElementById('envStatus'),
    editEndpointBtn: document.getElementById('editEndpointBtn'),
    gaugeCard: document.getElementById('gaugeCard'),
    riskGauge: document.getElementById('riskGauge'),
    gaugeValue: document.getElementById('gaugeValue'),
    gaugeBucket: document.getElementById('gaugeBucket'),
    gaugeUpdated: document.getElementById('gaugeUpdated'),

    skeletonWrap: document.getElementById('skeletonWrap'),
    errorCard: document.getElementById('errorCard'),
    errorMsg: document.getElementById('errorMsg'),
    errorDetails: document.getElementById('errorDetails'),
    retryBtn: document.getElementById('retryBtn'),

    cardAssessment: document.getElementById('cardAssessment'),
    assessmentContent: document.getElementById('assessmentContent'),

    cardPost: document.getElementById('cardPost'),
    postContent: document.getElementById('postContent'),

    cardTips: document.getElementById('cardTips'),
    tipsWrap: document.getElementById('tipsWrap'),

    copyButtons: () => document.querySelectorAll('button.copy'),

    historyList: document.getElementById('historyList'),
    clearHistory: document.getElementById('clearHistory'),
  };

  /* ---------- Endpoint management ---------- */
  const LS_KEY_ENDPOINT = 'firemebot.workerUrl';
  function getWorkerUrl() {
    const ui = (window.FireMeBot && window.FireMeBot.WORKER_URL) || '';
    const saved = localStorage.getItem(LS_KEY_ENDPOINT) || '';
    const url = saved || ui || '';
    if (els.envStatus) els.envStatus.innerHTML = 'worker: <em>' + (url || 'unset') + '</em>';
    return url;
  }
  function setWorkerUrl(newUrl) {
    if (!newUrl) return;
    localStorage.setItem(LS_KEY_ENDPOINT, newUrl);
    if (!window.FireMeBot) window.FireMeBot = {};
    window.FireMeBot.WORKER_URL = newUrl;
    getWorkerUrl();
  }
  getWorkerUrl();

  if (els.editEndpointBtn) {
    els.editEndpointBtn.addEventListener('click', () => {
      const current = getWorkerUrl() || '';
      const val = prompt('Set Worker URL', current);
      if (val) setWorkerUrl(val.trim());
    });
  }

  /* ---------- Helpers ---------- */
  function show(el){ if(el) el.classList.remove('hidden'); }
  function hide(el){ if(el) el.classList.add('hidden'); }
  function setStatus(msg){ if(els.status) els.status.textContent = msg; }

  function toast(msg){
    let t = document.querySelector('.toast');
    if(!t){
      t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'), 1200);
  }

  function nowStamp(){
    try {
      const d = new Date();
      return d.toLocaleString([], {hour:'2-digit', minute:'2-digit'}) + ' · ' + d.toLocaleDateString();
    } catch {
      return new Date().toString();
    }
  }

  /* ---------- Gauge ---------- */
  const CIRCUM = 2 * Math.PI * 52; // r=52
  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
  function bucketFor(score){
    if (score == null) return '—';
    if (score <= 25) return 'Low';
    if (score <= 70) return 'Medium';
    if (score <= 84) return 'Elevated';
    return 'High';
  }
  function colorFor(score){
    if (score == null) return '#555a66';
    // green (120) -> red (0)
    const hue = (120 * (100 - score)) / 100;
    return `hsl(${hue}, 85%, 50%)`;
  }
  function renderGauge(score){
    show(els.gaugeCard);
    const s = (typeof score === 'number' && !Number.isNaN(score)) ? clamp(score, 0, 100) : null;
    // arc
    const val = s == null ? 0 : (CIRCUM * s / 100);
    const rest = CIRCUM - val;
    const stroke = colorFor(s);
    const valueCircle = els.riskGauge && els.riskGauge.querySelector('.gauge-value');
    if (valueCircle){
      valueCircle.setAttribute('stroke', stroke);
      valueCircle.setAttribute('stroke-dasharray', `${val} ${rest}`);
    }
    // labels
    els.gaugeValue && (els.gaugeValue.textContent = (s == null ? '--' : String(Math.round(s))));
    els.gaugeBucket && (els.gaugeBucket.textContent = bucketFor(s));
    els.gaugeBucket && (els.gaugeBucket.style.color = stroke);
    els.gaugeUpdated && (els.gaugeUpdated.textContent = 'Updated ' + nowStamp());
    // a11y
    els.riskGauge && els.riskGauge.setAttribute('aria-label', `Automation Risk: ${s == null ? 'unknown' : s}, ${bucketFor(s)}`);
  }

  /* ---------- Parse & normalize ---------- */
  function cleanToJson(text){
    if (!text) return null;
    let t = text.trim();
    // strip code fences
    if (t.startsWith('```')) {
      t = t.replace(/^```[a-z]*\n?/i, '').replace(/```$/,'').trim();
    }
    // try direct parse
    try { return JSON.parse(t); } catch{}
    // try to find first {..}
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const cand = t.slice(start, end+1);
      try { return JSON.parse(cand); } catch {}
    }
    return null;
  }

  function normalizePayload(obj){
    if (!obj || typeof obj !== 'object') return null;
    const out = {};
    // title is intentionally ignored in UI, but we keep it in payload
    out.title = (typeof obj.title === 'string') ? obj.title : '';
    // score coercion
    const n = Number(obj.score);
    out.score = Number.isFinite(n) ? n : null;
    // body/post
    out.body = (typeof obj.body === 'string' && obj.body.trim()) ? obj.body.trim() : '';
    out.post = (typeof obj.post === 'string' && obj.post.trim()) ? obj.post.trim() : '';
    // tip: array of strings
    if (Array.isArray(obj.tip)) {
      out.tip = obj.tip.map(x => String(x)).filter(Boolean);
    } else if (typeof obj.tip === 'string') {
      out.tip = obj.tip.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      out.tip = [];
    }
    return out;
  }

  /* ---------- Render tiles ---------- */
  function setHtml(el, html){ if(el) el.innerHTML = html; }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function renderTiles(payload){
    // Assessment
    if (payload.body){
      setHtml(els.assessmentContent, escapeHtml(payload.body));
      show(els.cardAssessment);
    } else {
      hide(els.cardAssessment);
    }
    // Post
    if (payload.post){
      setHtml(els.postContent, escapeHtml(payload.post));
      show(els.cardPost);
    } else {
      hide(els.cardPost);
    }
    // Tips
    if (payload.tip && payload.tip.length){
      const chips = payload.tip.map(t => `<span class="chip">${escapeHtml(String(t))}</span>`).join('');
      setHtml(els.tipsWrap, chips);
      show(els.cardTips);
    } else {
      hide(els.cardTips);
    }
  }

  /* ---------- Copy actions ---------- */
  function wiresCopy(payload){
    document.querySelectorAll('button.copy').forEach(btn => {
      btn.onclick = () => {
        const kind = btn.getAttribute('data-copy');
        let text = '';
        if (kind === 'assessment') text = payload.body || '';
        else if (kind === 'post') text = payload.post || '';
        else if (kind === 'tips-list') text = (payload.tip || []).join(', ');
        else if (kind === 'tips-bullets') text = (payload.tip || []).map(x => '• ' + x).join('\n');
        if (text) {
          navigator.clipboard.writeText(text).then(()=>toast('Copied.'));
        }
      };
    });
  }

  /* ---------- History ---------- */
  const LS_KEY_HISTORY = 'firemebot.history';
  function readHistory(){
    try { return JSON.parse(localStorage.getItem(LS_KEY_HISTORY) || '[]'); } catch { return []; }
  }
  function writeHistory(arr){
    try { localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(arr.slice(0,30))); } catch {}
  }
  function pushHistory(title){
    if(!title) return;
    const h = readHistory();
    const idx = h.indexOf(title);
    if (idx !== -1) h.splice(idx,1);
    h.unshift(title);
    writeHistory(h);
    renderHistory();
  }
  function renderHistory(){
    if (!els.historyList) return;
    const h = readHistory();
    els.historyList.innerHTML = h.map(t => `<li data-role="${escapeHtml(t)}">${escapeHtml(t)}</li>`).join('');
    els.historyList.querySelectorAll('li').forEach(li => {
      li.onclick = () => {
        els.roleInput.value = li.getAttribute('data-role') || '';
        run();
      };
    });
  }
  if (els.clearHistory){
    els.clearHistory.onclick = () => { localStorage.removeItem(LS_KEY_HISTORY); renderHistory(); };
  }
  renderHistory();

  /* ---------- Networking ---------- */
  async function callWorker(role){
    const url = getWorkerUrl();
    if (!url) throw new Error('Worker URL is not set. Click “Set endpoint”.');

    const payload = { title: role };
    const res = await fetch(url, {
      method:'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const text = await res.text();
    if (!res.ok){
      const err = new Error('HTTP ' + res.status + ' ' + res.statusText);
      err.details = text;
      throw err;
    }
    return text;
  }

  function showSkeletons(){ show(els.skeletonWrap); hide(els.errorCard); }
  function hideSkeletons(){ hide(els.skeletonWrap); }

  let lastGood = null;
  async function run(){
    const role = (els.roleInput && els.roleInput.value || '').trim();
    if (!role){ setStatus('Enter a job title.'); els.roleInput && els.roleInput.focus(); return; }

    setStatus('Loading…');
    showSkeletons();

    try {
      const raw = await callWorker(role);
      const obj = cleanToJson(raw);
      if (!obj) {
        throw Object.assign(new Error('Could not parse JSON'), { details: raw.slice(0, 2000) });
      }
      const data = normalizePayload(obj);
      if (!data) {
        throw Object.assign(new Error('Response JSON was not an object'), { details: raw.slice(0, 2000) });
      }

      // Render
      renderGauge(data.score);
      renderTiles(data);
      wiresCopy(data);
      pushHistory(role);

      lastGood = data;
      hide(els.errorCard);
      setStatus('Done.');
    } catch (e){
      // Keep last good on screen if any, and show an error card
      if (lastGood){
        renderGauge(lastGood.score);
        renderTiles(lastGood);
        wiresCopy(lastGood);
      } else {
        // If nothing to show, hide cards
        hide(els.gaugeCard); hide(els.cardAssessment); hide(els.cardPost); hide(els.cardTips);
      }
      if (els.errorMsg) els.errorMsg.textContent = e.message || 'Unknown error';
      if (els.errorDetails) els.errorDetails.textContent = (e.details || '').toString();
      show(els.errorCard);
      setStatus('Error.');
    } finally {
      hideSkeletons();
    }
  }

  if (els.retryBtn) els.retryBtn.onclick = () => run();

  if (els.goBtn) els.goBtn.addEventListener('click', () => run());
  if (els.roleInput) els.roleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

  // Autofocus and show endpoint
  setTimeout(() => els.roleInput && els.roleInput.focus(), 100);
  getWorkerUrl();
})();