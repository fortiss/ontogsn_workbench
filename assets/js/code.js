import panes from "./panes.js";

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

const CODE_EXAMPLE = {
  codeLanguage: "python",
  codeUrl: "/assets/data/code_example.py"
};

function renderCodePanel() {
  const root = document.getElementById("code-root");
  if (!root) return;

  const ex = CODE_EXAMPLE;

  root.innerHTML = `<p>Loading code artefact…</p>`;

  fetch(ex.codeUrl)
    .then(resp => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    })
    .then(codeText => {
      root.innerHTML = `
        <section class="code-panel">
          <pre class="code-block">
<code class="language-${esc(ex.codeLanguage)}">${esc(codeText)}</code>
          </pre>
        </section>
      `;

      // ✅ highlight after we’ve inserted the code
      if (window.hljs) {
        root.querySelectorAll('pre code').forEach(block => {
          window.hljs.highlightElement(block);
        });
      }
    })
    .catch(err => {
      root.innerHTML = `
        <section class="code-panel">
          <p class="code-panel-error">
            Could not load code from
            <code>${esc(ex.codeUrl)}</code>: ${esc(err.message)}
          </p>
        </section>
      `;
    });
}

window.addEventListener("DOMContentLoaded", () => {
  panes.initLeftTabs();
  renderCodePanel();
});
