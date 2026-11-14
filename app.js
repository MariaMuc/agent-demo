"use strict";

/* ------------------------------------------------------------------
   Agent conversationnel – 100 % côté navigateur (aucun serveur).
   Tous les fournisseurs listés exposent une API compatible OpenAI :
   GET {base}/models  et  POST {base}/chat/completions
------------------------------------------------------------------- */

const PROVIDERS = {
  groq:       { name: "Groq",         base: "https://api.groq.com/openai/v1",                          model: "llama-3.3-70b-versatile",  keyUrl: "https://console.groq.com/keys",               ph: "gsk_..." },
  openai:     { name: "OpenAI",       base: "https://api.openai.com/v1",                               model: "gpt-4o-mini",              keyUrl: "https://platform.openai.com/api-keys",        ph: "sk-..." },
  openrouter: { name: "OpenRouter",   base: "https://openrouter.ai/api/v1",                            model: "openai/gpt-4o-mini",       keyUrl: "https://openrouter.ai/keys",                  ph: "sk-or-..." },
  mistral:    { name: "Mistral AI",   base: "https://api.mistral.ai/v1",                               model: "mistral-small-latest",     keyUrl: "https://console.mistral.ai/api-keys",         ph: "..." },
  gemini:     { name: "Google Gemini",base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash",         keyUrl: "https://aistudio.google.com/apikey",          ph: "AIza..." },
  together:   { name: "Together AI",  base: "https://api.together.xyz/v1",                             model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", keyUrl: "https://api.together.ai/settings/api-keys", ph: "..." },
  deepseek:   { name: "DeepSeek",     base: "https://api.deepseek.com/v1",                             model: "deepseek-chat",            keyUrl: "https://platform.deepseek.com/api_keys",      ph: "sk-..." },
  custom:     { name: "Autre (compatible OpenAI)", base: "",                                           model: "",                         keyUrl: "",                                            ph: "..." },
};

const STORE = "agent-demo-v1";
const $ = (id) => document.getElementById(id);

const state = {
  provider: "groq", base: "", key: "", model: "",
  history: [],            // [{role, content}]
  controller: null,       // AbortController de la réponse en cours
  busy: false,
};

/* ---------- Utilitaires ---------- */

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Mini-rendu Markdown (le texte est échappé AVANT tout traitement : pas de HTML injectable)
function renderMarkdown(text) {
  const blocks = [];
  let t = text.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  t = escapeHtml(t);
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>")
       .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
       .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
       .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const out = [];
  let list = null; // "ul" | "ol"
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of t.split("\n")) {
    let m;
    if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${m[1]}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${m[1]}</li>`);
    } else if ((m = line.match(/^#{1,6}\s+(.*)/))) {
      closeList(); out.push(`<p><strong>${m[1]}</strong></p>`);
    } else if (line.trim() === "") {
      closeList();
    } else if (/^\u0000\d+\u0000$/.test(line.trim())) {
      closeList(); out.push(line.trim());
    } else {
      closeList(); out.push(`<p>${line}</p>`);
    }
  }
  closeList();
  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}

function apiBase() {
  return (state.base || "").replace(/\/+$/, "");
}

function friendlyError(status, detail) {
  const d = detail ? ` (${detail})` : "";
  if (status === 401 || status === 403) return "Clé API refusée : vérifiez qu'elle est correcte et active." + d;
  if (status === 404) return "Modèle ou URL introuvable : vérifiez le nom du modèle / l'URL de base." + d;
  if (status === 429) return "Trop de requêtes ou quota atteint : patientez un moment puis réessayez." + d;
  if (status >= 500) return "Le fournisseur rencontre un problème, réessayez dans un instant." + d;
  return `Erreur ${status}.` + d;
}

async function readError(res) {
  try {
    const j = await res.json();
    return j.error?.message || j.message || "";
  } catch { return ""; }
}

/* ---------- Écran de connexion ---------- */

function fillProviders() {
  const sel = $("provider");
  for (const [id, p] of Object.entries(PROVIDERS)) {
    sel.add(new Option(p.name, id));
  }
  sel.value = "groq";
  onProviderChange();
}

function onProviderChange() {
  const id = $("provider").value;
  const p = PROVIDERS[id];
  $("customBox").hidden = id !== "custom";
  $("apiKey").placeholder = p.ph;
  const link = $("keyLink");
  link.hidden = !p.keyUrl;
  link.href = p.keyUrl || "#";
  link.textContent = p.keyUrl ? `Obtenir une clé ${p.name}` : "";
}

function showSetupError(msg) {
  const el = $("setupError");
  el.textContent = msg;
  el.hidden = !msg;
}

async function connect() {
  showSetupError("");
  const id = $("provider").value;
  const key = $("apiKey").value.trim();
  const base = id === "custom" ? $("baseUrl").value.trim() : PROVIDERS[id].base;

  if (!key) return showSetupError("Veuillez coller votre clé API.");
  if (!/^https:\/\//.test(base)) return showSetupError("L'URL de base doit commencer par https://");

  const btn = $("connectBtn");
  btn.disabled = true; btn.textContent = "Vérification…";
  Object.assign(state, { provider: id, key, base });

  let models = [];
  try {
    const res = await fetch(`${apiBase()}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) {
      throw new Error(friendlyError(res.status, await readError(res)));
    }
    if (res.ok) {
      const j = await res.json();
      models = (j.data || j.models || [])
        .map((m) => (typeof m === "string" ? m : m.id || m.name || ""))
        .map((n) => n.replace(/^models\//, ""))
        .filter((n) => n && !/whisper|tts|embed|guard|moderation|dall|image|transcri|speech|rerank/i.test(n))
        .sort();
    }
    // Autre statut (CORS, pas d'endpoint /models…) : on continue avec le modèle par défaut
  } catch (e) {
    if (e instanceof TypeError) {
      // erreur réseau / CORS : on laisse passer, la vraie erreur apparaîtra à l'envoi
    } else {
      btn.disabled = false; btn.textContent = "Se connecter";
      return showSetupError(e.message);
    }
  }

  const preferred = PROVIDERS[id].model;
  if (!models.length && preferred) models = [preferred];
  if (!models.length) {
    const typed = prompt("Impossible de lister les modèles. Saisissez le nom du modèle à utiliser :");
    if (!typed) { btn.disabled = false; btn.textContent = "Se connecter"; return; }
    models = [typed.trim()];
  }
  state.model = models.includes(preferred) ? preferred : models[0];

  if ($("remember").checked) {
    localStorage.setItem(STORE, JSON.stringify({ id, key, base, model: state.model }));
  } else {
    localStorage.removeItem(STORE);
  }
  sessionStorage.setItem(STORE, JSON.stringify({ id, key, base, model: state.model }));

  btn.disabled = false; btn.textContent = "Se connecter";
  openChat(models);
}

/* ---------- Écran de discussion ---------- */

function openChat(models) {
  $("setup").hidden = true;
  $("chat").hidden = false;
  $("providerLabel").textContent = PROVIDERS[state.provider].name;
  const sel = $("modelSelect");
  sel.innerHTML = "";
  models.forEach((m) => sel.add(new Option(m, m)));
  sel.value = state.model;
  resetConversation();
  $("input").focus();
}

function resetConversation() {
  if (state.controller) state.controller.abort();
  state.history = [];
  $("messages").innerHTML = '<div class="empty">Posez votre première question 👇</div>';
  setBusy(false);
}

function addMessage(role, html, asText) {
  const box = $("messages");
  const empty = box.querySelector(".empty");
  if (empty) empty.remove();
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  if (asText) el.textContent = html; else el.innerHTML = html;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function setBusy(busy) {
  state.busy = busy;
  const b = $("sendBtn");
  b.textContent = busy ? "Arrêter" : "Envoyer";
  b.type = busy ? "button" : "submit";
}

async function send() {
  const input = $("input");
  const text = input.value.trim();
  if (!text || state.busy) return;
  input.value = ""; autoGrow();

  state.history.push({ role: "user", content: text });
  addMessage("user", text, true);

  const sys = $("systemPrompt").value.trim();
  const messages = (sys ? [{ role: "system", content: sys }] : []).concat(state.history);

  const bubble = addMessage("assistant", "", false);
  bubble.classList.add("typing");
  state.controller = new AbortController();
  setBusy(true);

  let answer = "";
  try {
    const res = await fetch(`${apiBase()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.key}` },
      body: JSON.stringify({ model: $("modelSelect").value, messages, stream: true }),
      signal: state.controller.signal,
    });
    if (!res.ok) throw new Error(friendlyError(res.status, await readError(res)));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) {
            answer += delta;
            bubble.innerHTML = renderMarkdown(answer);
            $("messages").scrollTop = $("messages").scrollHeight;
          }
        } catch { /* ligne partielle ignorée */ }
      }
    }
    if (!answer) { bubble.remove(); addMessage("error", "Réponse vide du modèle.", true); }
    else state.history.push({ role: "assistant", content: answer });
  } catch (e) {
    if (e.name === "AbortError") {
      if (answer) state.history.push({ role: "assistant", content: answer });
      else bubble.remove();
    } else {
      bubble.remove();
      const msg = e instanceof TypeError
        ? "Connexion impossible (réseau ou blocage CORS). Vérifiez votre connexion et le fournisseur choisi."
        : e.message;
      addMessage("error", msg, true);
      state.history.pop(); // on retire la question restée sans réponse
    }
  } finally {
    bubble.classList.remove("typing");
    setBusy(false);
    state.controller = null;
  }
}

function autoGrow() {
  const t = $("input");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 160) + "px";
}

function logout() {
  if (state.controller) state.controller.abort();
  localStorage.removeItem(STORE);
  sessionStorage.removeItem(STORE);
  state.key = ""; state.history = [];
  $("apiKey").value = "";
  $("chat").hidden = true;
  $("setup").hidden = false;
}

/* ---------- Démarrage ---------- */

function init() {
  fillProviders();
  $("provider").addEventListener("change", onProviderChange);
  $("connectBtn").addEventListener("click", connect);
  $("apiKey").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });

  $("composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  $("sendBtn").addEventListener("click", () => { if (state.busy && state.controller) state.controller.abort(); });
  $("input").addEventListener("input", autoGrow);
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $("modelSelect").addEventListener("change", (e) => { state.model = e.target.value; });
  $("settingsBtn").addEventListener("click", () => { $("settingsPanel").hidden = !$("settingsPanel").hidden; });
  $("clearBtn").addEventListener("click", resetConversation);
  $("logoutBtn").addEventListener("click", logout);

  $("systemPrompt").value = "Tu es un assistant utile et concis. Réponds en français sauf si l'utilisateur écrit dans une autre langue.";

  // Reconnexion automatique si la clé a été mémorisée (session ou appareil)
  const saved = JSON.parse(sessionStorage.getItem(STORE) || localStorage.getItem(STORE) || "null");
  if (saved?.key) {
    $("provider").value = saved.id; onProviderChange();
    if (saved.id === "custom") { $("customBox").hidden = false; $("baseUrl").value = saved.base; }
    $("apiKey").value = saved.key;
    $("remember").checked = !!localStorage.getItem(STORE);
    connect();
  }
}

document.addEventListener("DOMContentLoaded", init);
