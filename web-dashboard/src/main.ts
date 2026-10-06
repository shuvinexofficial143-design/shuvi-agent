import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing app root");
}

app.innerHTML = `
  <main class="shell">
    <section class="card">
      <div class="mark">S</div>
      <p class="eyebrow">SHUVI CONTROL CENTER</p>
      <h1>Web dashboard scaffold is ready.</h1>
      <p class="muted">
        This web-only surface is intentionally separated from Shuvi's local Tauri,
        Rust, Adobe and computer-control runtime.
      </p>
      <div class="status">
        <span></span>
        ui-dashboard branch
      </div>
    </section>
  </main>
`;
