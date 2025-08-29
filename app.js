// FireMeBot — vanilla JS UI (LumonOS skin)
// Cleanup pass: same behavior, clearer structure, named constants, guard clauses.
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config & constants (no behavior change)
  // ---------------------------------------------------------------------------
  const WORKER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? '/api/roast'
    : 'https://firemebot-api.nat-1fa.workers.dev/api/roast';

  const LS_LAST_TITLE = 'fmb:lastTitle';

  const DUR = Object.freeze({
    labelEnter: 220,     // ms: % label one-shot entrance
    labelDelay: 120,     // ms: delay before label re-appears inside the bar
    progressTick: 200,   // ms: interval for faux progress
    settle: 2000,        // ms: time to rest at 2000 before resetting to 0
    typewriter: 50,      // ms/char: body typing speed
    extraCreepAfter: 10000 // ms: after this, glide toward 99%
  });

  const PROGRESS = Object.freeze({
    start: 3,
    creepCeil: 87,
    onLightThreshold: 60,
    fillRightThreshold: 99
  });

  const STATE = Object.freeze({ idle: 'idle', fadeout: 'fadeout', active: 'active' });

  // ---------------------------------------------------------------------------
  // Element handles
  // ---------------------------------------------------------------------------
  const els = {
    form: document.getElementById('job-form'),
    input: document.getElementById('job-input'),
    btn: document.getElementById('submit-btn'),
    status: document.getElementById('status'),
    titleHdr: document.getElementById('out-title'),
    score: document.getElementById('out-score'),
    body: document.getElementById('out-analysis'),
    post: document.getElementById('out-post'),
    tips: document.getElementById('out-tips'),
    errCard: document.getElementById('errorCard'),
    errMsg: document.getElementById('errorMsg'),
    inputWrapper: document.querySelector('.top-input__field'),
    pct: document.getElementById('progress-pct'),
    copyBtn: document.getElementById('copy-post'),
    copyStatus: document.getElementById('copy-status'),
    gaugeFill: document.getElementById('gauge-fill'),
    gauge: document.querySelector('.gauge')
  };

  // ---------------------------------------------------------------------------
  // Card visibility helpers (hide results while loading; reveal at 100%)
  // ---------------------------------------------------------------------------
  const resultCards = (() => {
    const targets = [els.titleHdr, els.body, els.score, els.post, els.tips];
    const cards = new Set();
    for (const t of targets){
      if (!t) continue;
      const c = t.closest('.card');
      if (c) cards.add(c);
    }
    return Array.from(cards);
  })();

  function setCardsVisible(isVisible){
    for (const c of resultCards){
      if (!c) continue;
      if (isVisible){
        c.style.display = 'block';
        c.removeAttribute('aria-hidden');
      } else {
        c.style.display = 'none';
        c.setAttribute('aria-hidden', 'true');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tiny helpers
  // ---------------------------------------------------------------------------
  const setStatus = (msg) => { if (els.status) els.status.textContent = msg; };
  const setAriaNow = (el, val) => { if (el) el.setAttribute('aria-valuenow', String(val)); };

  // Escape text for safe HTML injection
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    })[m]);
  }

  function showErr(msg, details = ''){
    if (!els.errCard || !els.errMsg) return;
    els.errMsg.textContent = [msg, details].filter(Boolean).join('\n');
    els.errCard.style.display = 'block';
  }
  function hideErr(){
    if (els.errCard) els.errCard.style.display = 'none';
    if (els.errMsg) els.errMsg.textContent = '';
  }

  // Measure the rendered width of the input's current text in pixels
  const measureInputTextPx = () => {
    if (!els.input) return 0;
    const cs = getComputedStyle(els.input);
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const canvas = measureInputTextPx._c || (measureInputTextPx._c = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    const text = els.input.value || '';
    const w = ctx.measureText(text).width;
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    return w + padL + padR + 40; // small buffer so the label doesn’t collide
  };

  // ---------------------------------------------------------------------------
  // % label positioning & progress
  // ---------------------------------------------------------------------------
  let progressTimer = null;
  let lastPct = 0;
  let pctState = STATE.idle; // 'idle' | 'fadeout' | 'active'
  let pctShowThresholdPx = 0; // dynamic: input text width + padding
  let renderSeq = 0; // increments per render; cancels old typewriter loops

  function setPctIdle(){
    if (!els.pct) return;
    els.pct.style.opacity = '1';
    els.pct.style.right = '12px';
    els.pct.style.left = 'auto';
    els.pct.style.transform = 'translateY(-50%)';
    els.pct.textContent = '0%';
  }

  function setPctFade(){ if (els.pct) els.pct.style.opacity = '0'; }

  function setPctActive(v){
    if (!els.pct) return;
    const clamped = Math.max(0, Math.min(100, v));
    els.pct.style.right = 'auto';
    els.pct.style.left = clamped + '%';
    els.pct.style.transform = 'translate(-100%, -50%)';
  }

  function setProgress(n){
    const v = Math.max(0, Math.min(100, Math.floor(n)));
    if (els.inputWrapper) {
      els.inputWrapper.style.setProperty('--pct', String(v));
      els.inputWrapper.toggleAttribute('data-fill-at-right', v >= PROGRESS.fillRightThreshold);
      els.inputWrapper.toggleAttribute('data-onlight', v >= PROGRESS.onLightThreshold);
      setAriaNow(els.inputWrapper, v);

      // Gate the % label until the fill surpasses the input text width
      if (els.inputWrapper && els.pct){
        const fieldW = els.inputWrapper.clientWidth || 0;
        const fillPx = fieldW * (v / 100);
        if (fillPx < pctShowThresholdPx){
          els.pct.style.opacity = '0';
        } else {
          els.pct.style.opacity = ''; // release to CSS-driven opacity
        }
      }

      // direction-aware one-shot entrance at start
      if (lastPct === 0 && v > 0){
        const dirClass = v >= 50 ? 'pct-enter-right' : 'pct-enter-left';
        els.inputWrapper.classList.add(dirClass);
        setTimeout(() => els.inputWrapper.classList.remove(dirClass), DUR.labelEnter);
      }
    }
    if (els.pct) els.pct.textContent = v + '%';
    if (pctState === STATE.active) setPctActive(v);
    lastPct = v;
  }

  function beginProgress(){
    // Hide result cards during loading
    setCardsVisible(false);

    pctState = STATE.fadeout;
    setPctFade();
    // Compute when the label is allowed to appear (px)
    pctShowThresholdPx = measureInputTextPx();
    setProgress(PROGRESS.start);
    if (els.inputWrapper) els.inputWrapper.setAttribute('data-darktext', 'true');

    clearInterval(progressTimer);
    let p = PROGRESS.start;
    const startedAt = Date.now();

    // re-appear inside the bar shortly after start
    setTimeout(() => { pctState = STATE.active; setPctActive(p); }, DUR.labelDelay);

    progressTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed < DUR.extraCreepAfter){
        // Slow creep up to 87% while waiting
        p = Math.min(PROGRESS.creepCeil, p + Math.max(1, Math.floor((90 - p) * 0.03)));
      } else {
        // After a few seconds, glide toward 99% so it doesn't feel stuck
        p = Math.min(99, p + Math.max(1, Math.floor((100 - p) * 0.08)));
      }
      setProgress(p);
    }, DUR.progressTick);
  }

  function endProgress(success){
    if (els.inputWrapper) els.inputWrapper.removeAttribute('data-darktext');
    clearInterval(progressTimer);
    setProgress(100);
    // Hide placeholder during 100% dwell so the bar fully covers it
    if (els.inputWrapper) els.inputWrapper.setAttribute('data-dwell', 'true');

    // Temporarily remove placeholder so nothing shows through the fill
    if (els.input) {
      const ph = els.input.getAttribute('placeholder');
      if (ph != null) els.input.dataset.originalPlaceholder = ph;
      els.input.setAttribute('placeholder', '');
      // Preserve accessibility during dwell
      if (!els.input.hasAttribute('aria-label') && ph) {
        els.input.setAttribute('aria-label', ph);
      }
    }

    // Reveal result cards once we hit 100% if the request succeeded
    if (success) setCardsVisible(true);

    // Clear the input once we’ve reached 100%
    if (els.input) els.input.value = '';

    // settle back to 0 after a short moment
    setTimeout(() => {
      // Restore placeholder after dwell
      if (els.inputWrapper) els.inputWrapper.removeAttribute('data-dwell');
      if (els.input) {
        const ph = els.input.dataset.originalPlaceholder ?? 'Enter your job title…';
        els.input.setAttribute('placeholder', ph);
        // Clean up the a11y label if we added it
        if (els.input.getAttribute('aria-label') === ph) {
          els.input.removeAttribute('aria-label');
        }
      }
      setProgress(0);
      lastPct = 0;
      pctState = STATE.idle;
      setPctIdle();
    }, DUR.settle);
  }

  // ---------------------------------------------------------------------------
  // Networking & data shaping
  // ---------------------------------------------------------------------------
  async function fetchRoast(title){
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
      throw new Error('Unexpected response from worker');
    }
  }

  function normalize(payload){
    const obj = (payload && payload.roast) ? payload.roast : payload;
    const title = String(obj?.title ?? '').trim();
    const rawScore = obj?.score ?? obj?.risk ?? '';
    const score = rawScore === '' ? '' : Number(rawScore);
    const body = String(obj?.body ?? obj?.analysis ?? obj?.message ?? '');
    const post = String(obj?.post ?? obj?.headline ?? '');
    const tip  = obj?.tip ?? obj?.tips ?? [];
    const tips = Array.isArray(tip) ? tip : (typeof tip === 'string' ? [tip] : []);
    return { title, score, body, post, tips };
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  // Render Tips as a plain UL with plain LIs (no inline margins/classes)
  function renderTips(tips){
    if (!els.tips) return;
    const items = Array.isArray(tips) ? tips.filter(Boolean) : [];
    if (!items.length){ els.tips.textContent = '—'; return; }
    const html = `<ul>${items.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
    els.tips.innerHTML = html;
  }

  // Typewriter Tips (character-by-character per <li>, no extra wrappers)
  async function typeTips(items, token){
    if (!els.tips) return;
    const list = Array.isArray(items) ? items.filter(Boolean).map(String) : [];
    if (!list.length){ els.tips.textContent = '—'; return; }

    const prefersReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const allow = document.body && document.body.hasAttribute('data-allow-reduced');

    els.tips.innerHTML = '';
    els.tips.classList.add('typewriter');
    const ul = document.createElement('ul');
    els.tips.appendChild(ul);

    for (const t of list){
      if (token != null && token !== renderSeq) return; // a new render started — abort
      const li = document.createElement('li');
      ul.appendChild(li);

      // show caret on the active line
      li.classList.add('typing');

      if (prefersReduce && !allow){
        li.textContent = t;
        li.classList.remove('typing');
        continue;
      }
      for (const ch of t){
        if (token != null && token !== renderSeq) return;
        li.textContent += ch;
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, DUR.typewriter));
      }
      li.classList.remove('typing');
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, Math.min(200, DUR.typewriter * 2)));
    }
    els.tips.classList.remove('typing');
  }

  async function typewriterEffect(el, text, token) {
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const allow = document.body && document.body.hasAttribute('data-allow-reduced');
    if (reduce && !allow) { el.textContent = text; return; }

    // Ensure caret blink even if DOM has no class
    el.classList.add('typewriter');
    el.classList.add('typing');
    el.textContent = '';
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++){
      if (token != null && token !== renderSeq) return; // a new render started — abort
      el.textContent += chars[i];
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, DUR.typewriter));
    }
    el.classList.remove('typing');
  }

  function renderGauge(score){
    const gaugeEl = els.gaugeFill ? els.gaugeFill.closest('.gauge') : els.gauge;

    if (typeof score !== 'number' || isNaN(score)){
      if (els.gaugeFill){
        els.gaugeFill.style.width = '0%';
        els.gaugeFill.style.background = 'var(--ink-muted)';
      }
      if (gaugeEl){
        gaugeEl.style.setProperty('--gauge-frac', '0');
        setAriaNow(gaugeEl, 0);
        gaugeEl.removeAttribute('aria-valuetext');
      }
      if (els.score) els.score.textContent = '—';
      return;
    }

    const pct = Math.max(0, Math.min(100, score));

    if (els.gaugeFill){
      els.gaugeFill.style.width = pct + '%';
      let color = 'var(--ink-muted)';
      let label = 'Low';
      if (pct < 45){ color = '#32D296'; label = 'Low'; }
      else if (pct <= 80){ color = '#F2E85C'; label = 'Medium'; }
      else { color = 'var(--danger)'; label = 'High'; }
      els.gaugeFill.style.background = color;

      if (gaugeEl){
        gaugeEl.style.setProperty('--gauge-frac', String(pct / 100));
        setAriaNow(gaugeEl, pct);
        gaugeEl.setAttribute('aria-valuetext', label + ' risk');
      }
    }

    if (els.score) els.score.textContent = String(pct);
  }

  async function typeBody(text){
    if (!els.body) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce){ els.body.textContent = text; return; }

    els.body.classList.add('typing');
    els.body.textContent = '';
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++){
      els.body.textContent += chars[i];
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, DUR.typewriter));
    }
    els.body.classList.remove('typing');
  }

  async function render(data){
    const token = ++renderSeq;
    if (els.titleHdr){
      await typewriterEffect(els.titleHdr, data.title || '—');
    }

    renderGauge(data.score);

    await typewriterEffect(els.body, data.body || '—');

    if (els.post){
      await typewriterEffect(els.post, data.post || '—');
    }

    if (els.tips){
      if (data.tips && data.tips.length){
        await typeTips(data.tips, token);
      } else {
        els.tips.textContent = '—';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // UX niceties & hydration
  // ---------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'k'){
      e.preventDefault();
      els.input?.focus();
    } else if (k === 'escape'){
      if (document.activeElement === els.input) {
        els.input.value = '';
      }
    }
  });

  try { localStorage.removeItem(LS_LAST_TITLE); } catch {}
  if (els.input) els.input.value = '';

  // ---------------------------------------------------------------------------
  // Submit flow
  // ---------------------------------------------------------------------------
  async function onSubmit(e){
    e.preventDefault();
    els.input?.blur();
    let success = false;
    const title = (els.input?.value || '').trim();
    // Removed localStorage.setItem(LS_LAST_TITLE, title);
    if (!title) return;

    hideErr();
    beginProgress();
    setStatus('Working…');
    els.btn.disabled = true;

    try {
      const raw = await fetchRoast(title);
      const data = normalize(raw);
      await render(data);
      success = true;
      setStatus('Done.');
    } catch (err) {
      console.error(err);
      showErr(err.message, (err && err.stack) ? String(err.stack) : '');
      setStatus('Error.');
    } finally {
      els.btn.disabled = false;
      endProgress(success);
    }
  }

  if (els.form) els.form.addEventListener('submit', onSubmit);

  // Copy post
  if (els.copyBtn){
    els.copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(els.post?.textContent || '');
        if (els.copyStatus) els.copyStatus.textContent = 'Copied.';
        setTimeout(() => { if (els.copyStatus) els.copyStatus.textContent = ''; }, 1200);
      } catch {
        if (els.copyStatus) els.copyStatus.textContent = 'Copy failed.';
        setTimeout(() => { if (els.copyStatus) els.copyStatus.textContent = ''; }, 1500);
      }
    });
  }
})();
