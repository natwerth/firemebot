// FireMeBot — vanilla JS UI (LumonOS skin)
// Cleanup pass: same behavior, clearer structure, named constants, guard clauses.
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config & constants (no behavior change)
  // ---------------------------------------------------------------------------
  // The deployed Worker allows localhost for browser previews too.
  const API_BASE = 'https://firemebot-api.nat-1fa.workers.dev';

  const DUR = Object.freeze({
    labelEnter: 220,       // ms: % label one-shot entrance
    labelDelay: 120,       // ms: delay before label re-appears inside the bar
    progressTick: 200,     // ms: interval for faux progress
    settle: 2000,          // ms: time to rest at 100 before resetting to 0
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
    jobTitle: document.getElementById('out-job-title'),
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

  let lastUserTitle = '';
  let assessment = null;
  let busy = false;
  let appealComplete = false;
  let appealPost = '';
  const appeal = Object.fromEntries([
    'section', 'open', 'form', 'defense', 'count', 'submit', 'status',
    'result', 'verdict', 'score', 'ruling', 'post', 'copy', 'share', 'copy-status'
  ].map(name => [name, document.getElementById(`appeal-${name}`)]));
  const tryAnother = document.getElementById('try-another');

  // ---------------------------------------------------------------------------
  // Result card visibility helpers
  // ---------------------------------------------------------------------------
  const resultCards = (() => {
    const targets = [els.titleHdr, els.jobTitle, els.body, els.score, els.post, els.tips];
    const cards = new Set();
    for (const t of targets) {
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
        c.style.display = 'block'; // override CSS default of display:none
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
    els.errCard.hidden = false;
    els.errCard.style.display = 'block';
  }

  function hideErr(){
    if (els.errCard) { els.errCard.hidden = true; els.errCard.style.display = 'none'; }
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

  function setPctIdle(){
    if (!els.pct) return;
    els.pct.style.opacity = '1';
    els.pct.style.right = '12px';
    els.pct.style.left = 'auto';
    els.pct.style.transform = 'translateY(-50%)';
    els.pct.textContent = '0%';
  }

  function setPctFade(){
    if (els.pct) els.pct.style.opacity = '0';
  }

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
    // Show result cards immediately and apply loading state
    setCardsVisible(true);
    for (const c of resultCards){
      if (c) c.classList.add('card--loading');
    }

    // Clear previous text while keeping layout stable
    if (els.body) els.body.textContent = '';
    if (els.post) els.post.textContent = '';
    if (els.tips) els.tips.textContent = '';
    if (els.score) els.score.textContent = '—';

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
    setProgress(success ? 100 : 0);
    if (!success) {
      pctState = STATE.idle;
      setPctIdle();
      setCardsVisible(false);
      els.titleHdr.textContent = '—';
      return;
    }
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
  async function requestJSON(path, payload){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        throw new Error(data?.message || (res.status === 429
          ? 'Too many submissions. Please wait a minute and try again.'
          : 'The assessment office is temporarily unavailable. Please try again.'));
      }
      if (!data || typeof data !== 'object') throw new Error('The assessment office returned an unreadable response. Please try again.');
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The assessment office took too long. Please try again.');
      if (err instanceof TypeError) throw new Error('Could not reach the assessment office. Check your connection and try again.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function validScore(score) {
    return Number.isInteger(score) && score >= 0 && score <= 100;
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

  // Typewriter effect for parallel typing
  const typingTimers = new WeakMap();

  function typewriter(el, text, speed = 18) {
    if (!el) return;
    // Cancel any previous typing on this element
    const prev = typingTimers.get(el);
    if (prev) clearInterval(prev);

    el.textContent = '';
    if (!text) {
      typingTimers.delete(el);
      return;
    }

    let i = 0;
    const id = setInterval(() => {
      el.textContent += text[i];
      i++;
      if (i >= text.length) {
        clearInterval(id);
        typingTimers.delete(el);
      }
    }, speed);

    typingTimers.set(el, id);
  }

  // Render Tips as a plain UL with plain LIs (no inline margins/classes)
  function renderTips(tips){
    if (!els.tips) return;
    const items = Array.isArray(tips) ? tips.filter(Boolean) : [];
    if (!items.length){ els.tips.textContent = '—'; return; }
    const html = `<ul>${items.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
    els.tips.innerHTML = html;
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

  function render(data){
    setCardsVisible(true);
    // Clear loading state from cards
    for (const c of resultCards){
      if (c) c.classList.remove('card--loading');
    }

    // Titles: instant
    if (els.titleHdr){
      els.titleHdr.textContent = data.title || '—';
      els.titleHdr.classList.remove('typing', 'typewriter');
    }
    if (els.jobTitle){
      els.jobTitle.textContent = lastUserTitle || '—';
      els.jobTitle.classList.remove('typing', 'typewriter');
    }

    // Slight delay before the rest of the content (score, analysis, post, tips)
    const CONTENT_DELAY_MS = 800;

    setTimeout(() => {
      // Gauge (out-score)
      renderGauge(data.score);

      // Body: typewriter
      const bodyText = data.body || '—';
      if (els.body){
        els.body.classList.remove('typing', 'typewriter');
        typewriter(els.body, bodyText, 14);
      }

      // Post: typewriter
      const postText = data.post || '—';
      if (els.post){
        els.post.classList.remove('typing', 'typewriter');
        typewriter(els.post, postText, 14);
      }

      // Tips: typewriter as bullet block
      if (els.tips){
        const tipsArr = Array.isArray(data.tips) ? data.tips.filter(Boolean) : [];
        const tipsText = tipsArr.length
          ? '• ' + tipsArr.join('\n• ')
          : '—';
        els.tips.style.whiteSpace = 'pre-wrap';
        els.tips.classList.remove('typing', 'typewriter');
        typewriter(els.tips, tipsText, 16);
      }
    }, CONTENT_DELAY_MS);
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

  if (els.input) els.input.value = '';

  // ---------------------------------------------------------------------------
  // Submit flow
  // ---------------------------------------------------------------------------
  async function onSubmit(e){
    e.preventDefault();
    if (busy || assessment) return;
    els.input?.blur();
    let success = false;
    const title = (els.input?.value || '').trim();
    // Removed localStorage.setItem(LS_LAST_TITLE, title);
    if (!title) return;
    lastUserTitle = title;
    els.jobTitle.textContent = title;

    hideErr();
    beginProgress();
    setStatus('Working…');
    els.btn.disabled = true;
    els.input.disabled = true;
    busy = true;

    try {
      const raw = await requestJSON('/api/roast', { title });
      const data = normalize(raw);
      if (!validScore(data.score) || !data.body.trim()) throw new Error('The assessment was incomplete. Please try again.');
      assessment = { score: data.score, body: data.body };
      appeal.section.hidden = false;
      render(data); // don't await; let typewriter run while progress finishes
      success = true;
      setStatus('Done.');
    } catch (err) {
      console.error(err);
      showErr(err.message);
      setStatus('Error.');
    } finally {
      busy = false;
      els.btn.disabled = success;
      els.input.disabled = success;
      endProgress(success);
    }
  }

  if (els.form) els.form.addEventListener('submit', onSubmit);

  appeal.open.addEventListener('click', () => {
    if (!assessment || busy || appealComplete) return;
    appeal.form.hidden = false;
    appeal.open.setAttribute('aria-expanded', 'true');
    appeal.open.hidden = true;
    appeal.defense.focus();
  });
  tryAnother.addEventListener('click', () => {
    if (!busy) window.location.reload();
  });
  appeal.defense.addEventListener('input', () => {
    appeal.count.textContent = `${appeal.defense.value.length} / 300 characters`;
    appeal.defense.setCustomValidity('');
  });
  appeal.form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || !assessment || appealComplete) return;
    const defense = appeal.defense.value.trim();
    if (!defense || appeal.defense.value.length > 300) {
      appeal.defense.setCustomValidity('Make your case in 1–300 characters.');
      appeal.defense.reportValidity();
      return;
    }
    hideErr();
    busy = true;
    appeal.submit.disabled = true;
    appeal.defense.disabled = true;
    tryAnother.disabled = true;
    appeal.form.setAttribute('aria-busy', 'true');
    appeal.status.textContent = 'Reviewing your continued relevance…';
    setStatus('Appeal under review…');
    try {
      const { appeal: result } = await requestJSON('/api/appeal', {
        title: lastUserTitle, original: assessment, defense
      });
      if (!result || !validScore(result.score) ||
          !['Appeal denied', 'Sentence reduced', 'Position retained. For now.'].includes(result.verdict) ||
          typeof result.ruling !== 'string' || !result.ruling.trim() ||
          typeof result.post !== 'string' || !result.post.trim()) {
        throw new Error('The ruling was incomplete. Please submit your appeal again.');
      }
      appeal.verdict.textContent = result.verdict;
      appeal.score.textContent = `Risk score: ${assessment.score} → ${result.score}`;
      appeal.ruling.textContent = result.ruling;
      appeal.post.textContent = result.post;
      appealPost = result.post;
      appealComplete = true;
      appeal.form.hidden = true;
      appeal.result.hidden = false;
      appeal.verdict.focus();
      setStatus('Decision final.');
    } catch (err) {
      showErr(err.message);
      appeal.status.textContent = 'Your defense is saved here. Please try again.';
      setStatus('Appeal not submitted.');
    } finally {
      busy = false;
      appeal.form.removeAttribute('aria-busy');
      appeal.submit.disabled = false;
      appeal.defense.disabled = false;
      tryAnother.disabled = false;
    }
  });
  async function copyAppeal() {
    try {
      await navigator.clipboard.writeText(`${appealPost} https://firemebot.com`);
      appeal['copy-status'].textContent = 'Ruling copied.';
    } catch {
      appeal['copy-status'].textContent = 'Copy unavailable. Select the ruling text to copy it.';
    }
  }
  appeal.copy.addEventListener('click', copyAppeal);
  appeal.share.addEventListener('click', async () => {
    try {
      if (!navigator.share) { await copyAppeal(); return; }
      await navigator.share({ title: 'My FireMeBot appeal', text: appealPost, url: 'https://firemebot.com' });
    } catch (err) {
      if (err.name !== 'AbortError') await copyAppeal();
    }
  });

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