// FireMeBot — vanilla JS UI (LumonOS skin). No frameworks.
(() => {
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

  async function fetchRoast(title){
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title })
    });
    const text = await res.text();
    // Try parse as JSON; if model returns stringified JSON in a field, recover.
    try{
      const j = JSON.parse(text);
      return j;
    }catch{
      // best-effort: find first {...} block
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { return JSON.parse(m[0]); } catch {}
      }
      throw new Error("Unexpected response from worker");
    }
  }

  function normalize(payload){
    // Accept either {roast:{...}} or flat fields
    const obj = payload && payload.roast ? payload.roast : payload;
    const title = String(obj?.title ?? "").trim();
    const score = (obj?.score ?? obj?.risk ?? "").toString();
    const body = String(obj?.body ?? obj?.analysis ?? obj?.message ?? "");
    const post = String(obj?.post ?? obj?.headline ?? "");
    const tip  = obj?.tip ?? obj?.tips ?? [];
    const tips = Array.isArray(tip) ? tip : (typeof tip === "string" ? [tip] : []);
    return { title, score, body, post, tips };
  }

  function render(data){
    if (els.title) els.title.textContent = data.title || "—";
    if (els.score) els.score.textContent = data.score !== "" ? data.score : "—";
    if (els.body)  els.body.textContent  = data.body  || "—";
    if (els.post)  els.post.textContent  = data.post  || "—";
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
    }
  }

  if (els.form) els.form.addEventListener("submit", onSubmit);
})();
