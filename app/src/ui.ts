export type CompanionUi = {
  setStatus(text: string): void
  setGlasses(text: string): void
  setError(text: string): void
}

export function mountUi(onInject: (text: string) => void): CompanionUi {
  const app = document.querySelector<HTMLDivElement>('#app')!
  const dev = import.meta.env.DEV
  app.innerHTML = `
    <main class="panel">
      <header>
        <h1>Kept</h1>
        <div id="status">Connecting…</div>
      </header>
      <pre id="glasses"></pre>
      <p id="error" hidden></p>
      ${
        dev
          ? `<form id="inject">
              <label for="inject-text">Inject a sentence (dev only)</label>
              <input id="inject-text" name="text" autocomplete="off" placeholder="I'll send the pricing by Friday" />
              <button type="submit">Show on glasses</button>
            </form>`
          : ''
      }
      <footer>localhost:8787 · double-press the idle screen to exit</footer>
    </main>
  `
  injectStyles()
  const status = app.querySelector<HTMLDivElement>('#status')!
  const glasses = app.querySelector<HTMLPreElement>('#glasses')!
  const error = app.querySelector<HTMLParagraphElement>('#error')!
  const form = app.querySelector<HTMLFormElement>('#inject')
  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = app.querySelector<HTMLInputElement>('#inject-text')
    const text = input?.value.trim() ?? ''
    if (!text) return
    onInject(text)
  })
  return {
    setStatus(text) {
      status.textContent = text
    },
    setGlasses(text) {
      glasses.textContent = text
    },
    setError(text) {
      error.hidden = !text
      error.textContent = text
    },
  }
}

function injectStyles() {
  const style = document.createElement('style')
  style.textContent = `
    :root { color-scheme: dark; }
    html, body { margin: 0; height: 100%; background: #232323; color: #e5e5e5;
      font: 16px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    #app { min-height: 100%; }
    .panel { box-sizing: border-box; width: min(640px, 100%); margin: 0 auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    h1 { margin: 0; font-size: 18px; letter-spacing: 0.12em; }
    #status { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #3cfa44; }
    #glasses { margin: 0; min-height: 140px; white-space: pre-wrap; background: #111; color: #b6ff9a;
      border-radius: 12px; padding: 16px; font: 14px/1.45 ui-monospace, monospace; }
    #error { margin: 0; color: #ff453a; }
    form { display: flex; flex-direction: column; gap: 8px; }
    label { font-size: 12px; color: #a7a7a7; }
    input { font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid #3e3e3e; background: #2e2e2e; color: inherit; }
    button { font: inherit; padding: 10px 12px; border: 0; border-radius: 10px; background: #3cfa44; color: #111; font-weight: 600; }
    footer { color: #7b7b7b; font-size: 12px; }
  `
  document.head.appendChild(style)
}
