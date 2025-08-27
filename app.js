// FireMeBot — vanilla JS UI (LumonOS skin) with requested tweaks.
(() => {
  const WORKER_URL = "https://firemebot-api.nat-1fa.workers.dev/api/roast";

  const els = {
    form: document.getElementById("job-form"),
    input: document.getElementById("job-input"),
    btn: document.getElementById("submit-btn"),
    status: document.getElementById("status"),
    titleHdr: document.getElementById("h-output"),
    score: document.getElementById("out-score"),
    body: document.getElementById("out-body"),
    post: document.getElementById("out-post"),
    tips: document.getElementById("out-tips"),
    errCard: document.getElementById("errorCard"),
    errMsg: document.getElementById("errorMsg"),
    bar: document.getElementById("progress-bar"),
    pct: document.getElementById("progress-pct"),
    copyBtn: document.getElementById("copy-post"),
    copyStatus: document.getElementById("copy-status"),
    gaugeFill: document.getElementById("gauge-fill"),
  };

  const setStatus = (msg) => { if (els.status) els.status.textContent = msg; };

  function showErr(msg, details=""){
    if (!els.errCard || !els.errMsg) return;
    els.errMsg.textContent = [msg, details].filter(Boolean).join("\n");
    els.errCard.style.display = "block";
  }
  function hideErr(){
    if (els.errCard) els.errCard.style.display = "none";
    if (els.errMsg) els.errMsg.textContent = "";
  }

  // Progress handling — determinate feel with gentle ramp; completes on resolve
  let progressTimer = null;
  function setProgress(n){
    const v = Math.max(0, Math.min(100, Math.floor(n)));
    if (els.bar) els.bar.style.width = v + "%";
    if (els.pct) els.pct.textContent = v + "% Complete";
  }
  function beginProgress(){
    setProgress(3);
    clearInterval(progressTimer);
    let p = 3;
    progressTimer = setInterval(() => {
      // Slow creep up to 87% while waiting
      p = Math.min(87, p + Math.max(1, Math.floor((90-p)*0.06)));
      setProgress(p);
    }, 200);
  }
  function endProgress(){
    clearInterval(progressTimer);
    setProgress(100);
    // settle back to 0 after a short moment
    setTimeout(() => setProgress(0), 800);
  }

  // Fetch
  async function fetchRoast(title){
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title })
    });
    const text = await res.text();
    try{
      return JSON.parse(text);
    }catch{
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch {} }
      throw new Error("Unexpected response from worker");
    }
  }

  function normalize(payload){
    const obj = payload && payload.roast ? payload.roast : payload;
    const title = String(obj?.title ?? "").trim();
    const rawScore = obj?.score ?? obj?.risk ?? "";
    const score = rawScore === "" ? "" : Number(rawScore);
    const body = String(obj?.body ?? obj?.analysis ?? obj?.message ?? "");
    const post = String(obj?.post ?? obj?.headline ?? "");
    const tip  = obj?.tip ?? obj?.tips ?? [];
    const tips = Array.isArray(tip) ? tip : (typeof tip === "string" ? [tip] : []);
    return { title, score, body, post, tips };
  }

  // Gauge coloring + width
  function renderGauge(score){
    if (typeof score !== "number" || isNaN(score)){
      els.gaugeFill.style.width = "0%";
      els.gaugeFill.style.background = "var(--ink-muted)";
      if (els.score) els.score.textContent = "—";
      return;
    }
    const pct = Math.max(0, Math.min(100, score));
    els.gaugeFill.style.width = pct + "%";
    let color = "var(--ink-muted)";
    if (pct < 45) color = "#32D296";          // green-ish within palette spirit
    else if (pct <= 80) color = "#F2E85C";    // yellow
    else color = "var(--danger)";             // red from palette
    els.gaugeFill.style.background = color;
    if (els.score) els.score.textContent = String(pct);
  }

  // Typewriter for body
  async function typeBody(text){
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!els.body) return;
    if (reduce){ els.body.textContent = text; return; }
    els.body.classList.add("typing");
    els.body.textContent = "";
    const chars = Array.from(text);
    for (let i=0;i<chars.length;i++){
      els.body.textContent += chars[i];
      await new Promise(r => setTimeout(r, 8)); // restrained speed
    }
    els.body.classList.remove("typing");
  }

  function render(data){
    if (els.titleHdr) els.titleHdr.textContent = data.title || "—";
    renderGauge(data.score);
    // body typed
    typeBody(data.body || "—");
    if (els.post) els.post.textContent = data.post || "—";
    if (els.tips){
      els.tips.innerHTML = "";
      if (data.tips && data.tips.length){
        const ul = document.createElement("ul");
        for (const t of data.tips){
          const li = document.createElement("li");
          li.textContent = t;
          ul.appendChild(li);
        }
        els.tips.appendChild(ul);
      } else {
        els.tips.textContent = "—";
      }
    }
  }

  async function onSubmit(e){
    e.preventDefault();
    const title = (els.input?.value || "").trim();
    if (!title){ return; }
    hideErr();
    beginProgress();
    setStatus("Working…");
    els.btn.disabled = true;
    try{
      const raw = await fetchRoast(title);
      const data = normalize(raw);
      render(data);
      setStatus("Done.");
    }catch(err){
      console.error(err);
      showErr(err.message, (err && err.stack) ? String(err.stack) : "");
      setStatus("Error.");
    }finally{
      els.btn.disabled = false;
      endProgress();
    }
  }

  if (els.form) els.form.addEventListener("submit", onSubmit);

  // Copy post
  if (els.copyBtn){
    els.copyBtn.addEventListener("click", async () => {
      try{
        await navigator.clipboard.writeText(els.post?.textContent || "");
        if (els.copyStatus) els.copyStatus.textContent = "Copied.";
        setTimeout(() => { if (els.copyStatus) els.copyStatus.textContent = ""; }, 1200);
      }catch{
        if (els.copyStatus) els.copyStatus.textContent = "Copy failed.";
        setTimeout(() => { if (els.copyStatus) els.copyStatus.textContent = ""; }, 1500);
      }
    });
  }
})();
