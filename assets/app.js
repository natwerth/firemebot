// FireMeBot front-end
(() => {
  // Detect API from ?api=... or Advanced input; fallback to relative path.
  const params = new URLSearchParams(location.search);
  const DEFAULT_API = "/api/roast";
  let API_URL = params.get("api") || DEFAULT_API;

  const $ = (s) => document.querySelector(s);
  const form = $("#roastForm");
  const input = $("#titleInput");
  const btn = $("#fireBtn");
  const status = $("#status");
  const card = $("#resultCard");

  const outTitle = $("#outTitle");
  const scoreFill = $("#scoreFill");
  const scoreValue = $("#scoreValue");
  const outBody = $("#outBody");
  const outPost = $("#outPost");
  const outTips = $("#outTips");
  const rawJson = $("#rawJson");

  const copyJsonBtn = $("#copyJsonBtn");
  const againBtn = $("#againBtn");
  const apiInput = $("#apiInput");
  const year = $("#year");

  if (year) year.textContent = new Date().getFullYear();
  if (apiInput) apiInput.value = API_URL;

  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  async function postJSON(url, data){
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} — ${text}`);
    }
    return res.json();
  }

  function renderRoast(roast){
    // Roast is already JSON object with {title, score, body, post, tip}
    const { title, score, body, post, tip } = roast || {};

    outTitle.textContent = title || "—";
    const s = clamp(Number(score||0), 0, 100);
    scoreFill.style.width = s + "%";
    scoreValue.textContent = String(s);
    scoreValue.setAttribute("aria-valuenow", String(s));

    outBody.textContent = body || "—";
    outPost.textContent = post || "—";

    outTips.innerHTML = "";
    (Array.isArray(tip) ? tip : []).forEach(t => {
      const li = document.createElement("li");
      li.textContent = t;
      outTips.appendChild(li);
    });

    rawJson.textContent = JSON.stringify(roast, null, 2);
    card.classList.remove("hidden");
  }

  function setBusy(isBusy, msg){
    btn.disabled = isBusy;
    status.textContent = msg || "";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    let title = (input.value || "").trim();
    if (!title) return;

    // Apply API override if user edited the field in Advanced
    if (apiInput && apiInput.value.trim()) API_URL = apiInput.value.trim();

    setBusy(true, "Drafting your termination letter…");
    card.classList.add("hidden");
    rawJson.textContent = "";

    try {
      const { roast } = await postJSON(API_URL, { title });
      renderRoast(roast);
      setBusy(false, "");
    } catch (err) {
      setBusy(false, "");
      card.classList.add("hidden");
      status.textContent = "Error: " + String(err.message || err);
    }
  });

  // Copy buttons with data-copy attribute
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;

    let text = "";
    const which = btn.getAttribute("data-copy");
    if (which === "body") text = outBody.textContent || "";
    else if (which === "post") text = outPost.textContent || "";
    else if (which === "tips") {
      const tips = [...outTips.querySelectorAll("li")].map(li => li.textContent.trim());
      text = tips.join(", ");
    }

    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = old), 900);
    } catch {}
  });

  if (copyJsonBtn) {
    copyJsonBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(rawJson.textContent || "{}");
        const old = copyJsonBtn.textContent;
        copyJsonBtn.textContent = "Copied!";
        setTimeout(() => (copyJsonBtn.textContent = old), 900);
      } catch {}
    });
  }

  if (againBtn) {
    againBtn.addEventListener("click", () => {
      input.focus();
      input.select();
      card.classList.add("hidden");
      status.textContent = "";
    });
  }
})();