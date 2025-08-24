// FireMeBot front-end
(() => {
  const API_URL = "https://firemebot-api.nat-1fa.workers.dev/api/roast"; // your Worker URL

  const $ = (s) => document.querySelector(s);
  const form = $("#roastForm");
  const input = $("#titleInput");
  const btn = $("#fireBtn");
  const status = $("#status");
  const card = $("#resultCard");
  const out = $("#resultText");
  const copyBtn = $("#copyBtn");
  const againBtn = $("#againBtn");
  const year = $("#year");

  if (year) year.textContent = new Date().getFullYear();

  async function postJSON(url, data){
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if(!res.ok){
      let text = await res.text().catch(() => "");
      throw new Error(`Request failed (${res.status}) ${text}`);
    }
    return res.json();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;

    btn.disabled = true;
    status.textContent = "Drafting your termination letter…";
    card.classList.add("hidden");
    out.textContent = "";

    try {
      const { roast } = await postJSON(API_URL, { title });
      out.textContent = roast || "(No content returned)";
      card.classList.remove("hidden");
      status.textContent = "";
    } catch (err) {
      status.textContent = err.message.includes("429")
        ? "Rate limited or quota problem. Try again in a bit."
        : "Something went wrong. Check the Worker and CORS settings.";
    } finally {
      btn.disabled = false;
    }
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(out.textContent);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy"), 800);
    } catch {}
  });

  againBtn.addEventListener("click", () => {
    input.focus();
    input.select();
    card.classList.add("hidden");
  });
})();
