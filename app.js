(() => {
  // Hardcoded worker endpoint — no button, no localStorage nonsense.
  const WORKER_URL = "https://firemebot-api.nat-1fa.workers.dev/api/roast";

  const els = {
    form: document.getElementById("job-form"),
    input: document.getElementById("job-input"),
    btn: document.getElementById("submit-btn"),
    status: document.getElementById("status"),
    title: document.getElementById("out-title"),
    score: document.getElementById("out-score"),
    body: document.getElementById("out-body"),
    post: document.getElementById("out-post"),
    tips: document.getElementById("out-tips"),
    errCard: document.getElementById("errorCard"),
    errMsg: document.getElementById("errorMsg"),
    errDetails: document.getElementById("errorDetails"),
  };

  function setStatus(msg){ if (els.status) els.status.textContent = msg || ""; }
  function showErr(msg, details){
    if (!els.errCard) return;
    els.errMsg.textContent = msg || "Unknown error";
    els.errDetails.textContent = details || "";
    els.errCard.style.display = "block";
  }
  function hideErr(){ if (els.errCard) els.errCard.style.display = "none"; }

  async function fetchRoast(title){
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    if (!res.ok){
      const txt = await res.text().catch(()=> "");
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${txt}`);
    }
    return await res.json();
  }

  function normalize(obj){
    if (!obj || typeof obj !== "object") return { title: "", score: null, body: "", post: "", tip: [] };
    const base = obj.roast ?? obj;
    const out = {};
    out.title = typeof base.title === "string" ? base.title : "";
    const n = Number(base.score); out.score = Number.isFinite(n) ? n : null;
    out.body = typeof base.body === "string" ? base.body.trim() : "";
    out.post = typeof base.post === "string" ? base.post.trim() : "";
    if (Array.isArray(base.tip)) out.tip = base.tip.map(x => String(x));
    else if (typeof base.tip === "string") out.tip = base.tip.split(",").map(s => s.trim()).filter(Boolean);
    else out.tip = [];
    return out;
  }

  function render(data){
    els.title.textContent = data.title || "";
    els.score.textContent = (data.score ?? "–");
    els.body.textContent  = data.body || "";
    els.post.textContent  = data.post || "";
    els.tips.innerHTML    = data.tip.map(t => `<li>${escapeHtml(String(t))}</li>`).join("");
  }

  function escapeHtml(s){
    return s.replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c] || c));
  }

  async function onSubmit(e){
    e.preventDefault();
    const title = (els.input.value || "").trim();
    if (!title){ setStatus("Enter a job title."); els.input.focus(); return; }
    hideErr();
    setStatus("Loading…");
    els.btn.disabled = true;
    try {
      const raw = await fetchRoast(title);
      const data = normalize(raw);
      render(data);
      setStatus("Done.");
    } catch (err){
      console.error(err);
      showErr(err.message, (err && err.stack) ? String(err.stack) : "");
      setStatus("Error.");
    } finally {
      els.btn.disabled = false;
    }
  }

  if (els.form) els.form.addEventListener("submit", onSubmit);
})();