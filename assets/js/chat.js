// /assets/js/chat.js
import app from "./queries.js"; // re-use your Oxigraph Store

// --- tiny helpers -----------------------------------------------------------
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Grab or persist the key/model locally
const KEY_K = "openrouter_api_key";
const MODEL_K = "openrouter_model";

const keyEl   = document.querySelector("#chat-key");
const modelEl = document.querySelector("#chat-model");

if (keyEl)   keyEl.value   = localStorage.getItem("openrouter_api_key") || "";
if (modelEl) modelEl.value = localStorage.getItem("openrouter_model") || modelEl.value;


// Make sure Oxigraph is ready
async function ensureStore() {
  if (!app.store) await app.init?.(); // no-op if already initialized
  return app.store;
}

// Naive keyword extraction (keep 3–5 useful tokens)
function keywords(q) {
  return Array.from(new Set(
    q.toLowerCase().split(/[^a-z0-9_:\-]+/i)
      .filter(w => w.length > 2 && w !== "the" && w !== "and")
  )).slice(0, 5);
}

// Build a tiny SPARQL to fetch a) matched nodes and b) their immediate edges
function makeContextQuery(words) {
  // up to 5 words → disjunction of regex tests over id/label/comment + IRIs
  const re = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const RX = re.map(w =>
    `regex(str(?s), "${w}", "i") || regex(str(?label), "${w}", "i") || regex(str(?id), "${w}", "i") || regex(str(?o), "${w}", "i")`
  ).join(" || ");

  return `
PREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema:<https://schema.org/>
PREFIX gsn:   <https://w3id.org/OntoGSN/ontology#>

# 1) Candidate nodes by keyword
SELECT DISTINCT ?s ?label ?id ?statement
WHERE {
  OPTIONAL { ?s rdfs:label ?label }
  OPTIONAL { ?s schema:identifier ?id }
  OPTIONAL { ?s gsn:statement ?statement}
  #FILTER(STRSTARTS(STR(?s), "https://w3id.org/OntoGSN/cases/ACT-FAST-robust-llm#"))
  FILTER(${RX})
}
LIMIT 30`;
}

// Expand immediate graph around the top N candidates
function makeNeighborhoodQuery(ids) {
  const vals = ids.map(i => `<${i}>`).join(" ");
  return `
SELECT ?s ?p ?o
WHERE {
  VALUES ?s { ${vals} }
  ?s ?p ?o .
}
LIMIT 200`;
}

// Turn bindings into plain JS rows (same as queries.js)
function bindingsToRows(iter) {
  const rows = [];
  for (const b of iter) {
    const obj = {};
    for (const [k, v] of b) {
      switch (v.termType) {
        case "NamedNode": obj[k] = v.value; break;
        case "BlankNode": obj[k] = "_:" + v.value; break;
        case "Literal": {
          const dt = v.datatype?.value, lg = v.language;
          obj[k] = lg ? `"${v.value}"@${lg}` :
                   (dt && dt !== "http://www.w3.org/2001/XMLSchema#string") ? `"${v.value}"^^${dt}` :
                   v.value;
          break;
        }
        default: obj[k] = v.value ?? String(v);
      }
    }
    rows.push(obj);
  }
  return rows;
}

// Query store for context block
async function gatherContext(question) {
  const store = await ensureStore();
  const kws = keywords(question);
  if (!kws.length) return { synopsis: "", triples: [] };

  const q1 = makeContextQuery(kws);
  const r1 = store.query(q1);
  const rows1 = bindingsToRows(r1);
  const ids = rows1.map(r => r.s).filter(Boolean).slice(0, 12);

  let triples = [];
  if (ids.length) {
    const q2 = makeNeighborhoodQuery(ids);
    const r2 = store.query(q2);
    triples = bindingsToRows(r2).map(({ s, p, o }) => ({ s, p, o }));
  }

  // Short, LLM-friendly synopsis
  const topLines = rows1.slice(0, 12).map(r =>
    `• ${r.id ?? r.label ?? r.s}  [${r.s}]`
  ).join("\n");

  return {
    synopsis: topLines,
    triples
  };
}

// Call OpenRouter (non-streaming for simplicity)
// Docs: POST https://openrouter.ai/api/v1/chat/completions + headers. :contentReference[oaicite:2]{index=2}
async function askOpenRouter({ apiKey, model, messages }) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": location.origin, // optional attribution
      "X-Title": "OntoGSN Chat (local)" // optional attribution
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 10000,
      //stream: true
      // You can set stream: true and handle SSE later if you want typing. :contentReference[oaicite:3]{index=3}
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${t}`);
  }
  const data = await res.json();
  const c = data?.choices?.[0]?.message?.content || "";
  return c;
}

// --- UI wiring --------------------------------------------------------------
function appendMsg(role, html) {
  const el = document.createElement("div");
  el.className = role === "user" ? "msg user" : "msg bot";
  el.style.cssText = "margin:.25rem 0;padding:.35rem .5rem;border-radius:.5rem;background:#f7f7f7;";
  el.innerHTML = html;
  $("#chat-log").appendChild(el);
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
}

$("#chat-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();

  const apiKey = $("#chat-key").value.trim();
  const model  = $("#chat-model").value.trim() || "openai/gpt-4o-mini";
  const q      = $("#chat-input").value.trim();

  if (!apiKey) { alert("Paste your OpenRouter API key first."); return; }
  if (!q) return;

  // persist locally
  localStorage.setItem(KEY_K, apiKey);
  localStorage.setItem(MODEL_K, model);

  appendMsg("user", esc(q));
  $("#chat-input").value = "";
  $("#chat-send").disabled = true;

  try {
    const { synopsis, triples } = await gatherContext(q);
    const contextBlock =
`You are the OntoGSN assistant. Use the provided *Knowledge Graph context* to answer briefly and accurately.
- Prefer concrete node identifiers (like G1, C1, Sn1) when relevant.
- If the answer is not supported by the context, say you don't know and why (for example, you received no context data).
- Key relations: gsn:supportedBy, gsn:inContextOf, gsn:challenges, prov:Collection links.

[Knowledge Graph context — nodes]
${synopsis || "(no close matches)"}

[Knowledge Graph context — triples]
${triples.slice(0, 120).map(t => `${t.s}  ${t.p}  ${t.o}`).join("\n")}`;

    const messages = [
      { role: "system", content: "You answer questions about an assurance case represented in a GSN-like ontology." },
      { role: "user", content: `${q}\n\n${contextBlock}` }
    ];

    const answer = await askOpenRouter({ apiKey, model, messages });
    appendMsg("bot", esc(answer));
  } catch (e) {
    appendMsg("bot", `<em>${esc(e.message)}</em>`);
  } finally {
    $("#chat-send").disabled = false;
  }
});
