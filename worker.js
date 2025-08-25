// firemebot-api — Cloudflare Worker (no build step)
// Route: POST /api/roast  -> { title: "Senior Synergy Evangelist" }  => { roast: {...} }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---- CORS handling ---------------------------------------------------
    const allowOrigin = pickOrigin(request);
    const corsHeaders = buildCORSHeaders(allowOrigin);

    // Preflight
    if (request.method === "OPTIONS") {
      return withSecHeaders(new Response(null, { status: 204, headers: corsHeaders }));
    }

    // Health
    if (url.pathname === "/" && request.method === "GET") {
      const res = json({ ok: true, name: "firemebot-api", msg: "Worker is alive." }, corsHeaders);
      res.headers.set("Cache-Control", "no-store");
      return withSecHeaders(res);
    }

    // Main endpoint
    if (url.pathname === "/api/roast" && request.method === "POST") {
      try {
        const body = await safeJson(request);
        const rawTitle = (body?.title ?? "");
        if (typeof rawTitle !== "string") {
          return withSecHeaders(jsonError("INVALID_INPUT", 400, corsHeaders, { detail: "Field 'title' must be a string." }));
        }
        const title = rawTitle.trim().slice(0, 140);
        if (!title) {
          return withSecHeaders(jsonError("MISSING_TITLE", 400, corsHeaders, { detail: "Provide a non-empty 'title'." }));
        }

        // ---- LONG SYSTEM PROMPT ------------------------------------------
        const system = [
          "You are FireMeBot, an automated corporate risk assessment engine.",
          "Your job is to evaluate the likelihood that a given job title will be replaced by AI automation.",
          
          "RESPOND ONLY IN VALID JSON with the following keys:",
          "- 'title': A cold, sterile, dystopian headline (max 2 words).",
          "- 'score': An integer between 0-100 representing the likelihood of AI replacement.",
          "- 'body': A brief explanation (max 2 sentences).",
          "- 'post': A one-sentence social post template referencing the body (no emojis, no hashtags).",
          "- 'tip': An array of 2-3 alternative professions (strings) with lower AI risk.",

          "----------------------------",
          "### WORLDVIEW (apply this consistently)",
          "- AI/automation primarily threatens knowledge-work, software-driven, analytical, and repetitive digital tasks.",
          "- Jobs requiring tactile, manual labor and high levels of human interaction are at low risk.",
          "- Hybrid jobs (e.g. sales, teaching, management) are at medium risk because parts may be automated but human elements remain critical.",
          "- Scores must reflect this worldview, even if cultural fear exaggerates automation risk.",

          "----------------------------",
          "### ANCHORED SCALE",
          "- 0-10: Essentially immune (deeply human, physical, or creative essence, e.g. 'Priest', 'Painter').",
          "- 11-30: Low risk (manual/tactile jobs with strong customer or physical presence, e.g. 'Barista', 'Construction Worker').",
          "- 31-50: Moderate risk (hybrid roles with both automation exposure and essential human elements, e.g. 'Salesperson', 'Teacher').",
          "- 51-70: High risk (structured office roles where many tasks are automatable, e.g. 'Customer Support Rep', 'HR Assistant').",
          "- 71-90: Very high risk (core digital/knowledge roles with clear AI alternatives, e.g. 'Data Analyst', 'Software Engineer').",
          "- 91-100: Practically obsolete (highly repetitive, rules-based desk jobs with full AI substitutes, e.g. 'Transcriptionist').",

          "----------------------------",
          "### TONE GUIDE (separate from logic)",
          "- Style: Cold, corporate, clinical — like a severed HR memo.",
          "- Voice: Dystopian but dry, detached, and unemotional.",
          "- Humor: Satirical, office-politics-aware, never hateful or slur-based.",
          "- Prohibited: Personal data, threats, real company names, emojis, hashtags.",

          "----------------------------",
          "### EXAMPLES (follow structure exactly)",
          "Input: 'Barista' Output:{'title':'Caffeinated Extinction','score':25,'body':'Espresso machines and AI ordering systems may erode parts of the craft, but the human touch of hospitality remains hard to replace.','post':'Even coffee culture can’t escape automation, though your smile might outlast your shift.','tip':['Customer Experience Specialist','Hospitality Manager','Event Coordinator']}",
          "Input: 'Software Engineer' Output:{'title':'Code Redundancy','score':85,'body':'AI-driven coding assistants are consuming repetitive engineering work at scale, reducing reliance on human coders for standard tasks.','post':'When the bots write better code than you, the pink slip writes itself.','tip':['AI Product Manager','Cybersecurity Specialist','Systems Architect']}",
          "Input: 'Salesperson' Output:{'title':'Pitch Eclipse','score':45,'body':'Automated CRMs are streamlining deal cycles, but trust and persuasion still rely on human presence in the room.','post':'The pitch isn’t dead—just sharing a ventilator with algorithms.','tip':['Customer Success Manager','Brand Specialist','Partnerships Manager']}"
        ].join(" ");

        const user = `Job title: ${title}\nReturn ONLY the JSON object as specified.`;

        // ---- OpenAI call (Responses API) ---------------------------------
        const openaiBody = {
          model: "gpt-5-nano-2025-08-07",   // pinned
          store: false,                     // privacy
          user: await sha256(env, request.headers.get("cf-connecting-ip") || "anon"),
          input: [
            { role: "system", content: system },
            { role: "user", content: user }
          ],
          temperature: 1,
          max_output_tokens: 2048,          // raised ceiling for long prompt + output
          reasoning: { effort: "low" },
          text: { format: { type: "json_object" } },
          metadata: { app: "firemebot", env: "prod", version: "2025-08-25" }
        };

        const oai = await callOpenAI(env, openaiBody);
        const reqId = oai.headers?.get?.("x-request-id") || null;

        if (!oai.ok) {
          const detail = (await oai.text().catch(() => ""))?.slice(0, 2000) || oai.statusText;
          console.error("openai_upstream_error", { status: oai.status, reqId, detail });
          return withSecHeaders(jsonError("OPENAI_UPSTREAM", 502, corsHeaders, { reqId, detail }));
        }

        const data = await oai.json();

        // Prefer convenience string; fallback to stitching parts
        let raw = data?.output_text;
        if (!raw) {
          raw = (data?.output ?? [])
            .flatMap(item => item?.content ?? [])
            .map(part => part?.text ?? "")
            .join("")
            .trim();
        }

        if (!raw) {
          const status = data?.status || "?";
          const reason = data?.incomplete_details?.reason || "?";
          console.error("openai_no_text", { reqId, status, reason });
          return withSecHeaders(jsonError("NO_MODEL_TEXT", 502, corsHeaders, { reqId, status, reason }));
        }

        // Parse model JSON
        let roastObj;
        try {
          roastObj = JSON.parse(raw);
        } catch (e) {
          console.error("openai_bad_json", { reqId, sample: raw.slice(0, 600) });
          return withSecHeaders(jsonError("BAD_MODEL_JSON", 502, corsHeaders, { reqId, sample: raw.slice(0, 1200) }));
        }

        // Success
        return withSecHeaders(json({ roast: roastObj, title }, corsHeaders));
      } catch (err) {
        console.error("worker_exception", String(err));
        return withSecHeaders(jsonError("WORKER_EXCEPTION", 500, corsHeaders, { detail: String(err) }));
      }
    }

    // 404
    return withSecHeaders(new Response("Not found", { status: 404, headers: corsHeaders }));
  }
};

/* ------------------------- CORS helpers ------------------------- */
const ALLOW_ORIGIN_PATTERNS = [
  /^https:\/\/firemebot\.com$/,
  /^https:\/\/test\.natwerth\.com$/,
  /^https:\/\/natwerth\.github\.io$/,
  /^https?:\/\/localhost(?::\\d+)?$/,
];

function pickOrigin(request) {
  const origin = request.headers.get("Origin") || "";
  for (const re of ALLOW_ORIGIN_PATTERNS) {
    if (re.test(origin)) return origin;
  }
  // fallback: one prod domain
  return "https://firemebot.com";
}

function buildCORSHeaders(allowOrigin) {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8"
  };
}

/* ------------------------- OpenAI helper with abort/retry ------------------------- */
async function callOpenAI(env, body) {
  let delay = 300;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25000);
    let res;
    try {
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: ac.signal
      });
    } catch (e) {
      res = new Response(String(e), { status: 0, statusText: "network_error" });
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) return res;

    if (res.status === 429 || (res.status >= 500 && res.status <= 599) || res.status === 0) {
      await sleep(delay + Math.random() * 150);
      delay *= 2;
      continue;
    }

    return res;
  }
  return new Response("openai_retries_exhausted", { status: 502 });
}

/* ------------------------- Utilities ------------------------- */
function withSecHeaders(res) {
  const h = new Headers(res.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "same-origin");
  h.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  return new Response(res.body, { status: res.status, headers: h });
}

async function sha256(env, s) {
  const salt = env.HASH_SALT || "";
  const data = new TextEncoder().encode(s + salt);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function safeJson(request) {
  try { return await request.json(); }
  catch { return null; }
}

function json(obj, headers = {}) {
  return new Response(JSON.stringify(obj), { status: 200, headers });
}

function jsonError(error_code, status = 400, headers = {}, extra = {}) {
  return new Response(JSON.stringify({ error: error_code, status, ...extra }), { status, headers });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
