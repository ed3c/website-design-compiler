export const OBSERVED_VISUAL_FIXTURE_HTML = `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { margin: 0; color: #172033; background: #f7f8fa; font: 16px/1.5 Arial, sans-serif; }
    nav { height: 48px; display: flex; align-items: center; }
    main { width: min(720px, calc(100vw - 32px)); margin: 0 auto; }
    h1 { font-size: 40px; line-height: 48px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .card { min-height: 120px; padding: 24px; border: 1px solid #ccd2dc; transition: transform 200ms ease; }
    @media (max-width: 600px) {
      h1 { font-size: 30px; line-height: 36px; }
      .grid { grid-template-columns: 1fr; gap: 16px; }
    }
  </style>
</head>
<body>
  <nav><a href="#main">Reference navigation</a></nav>
  <main id="main">
    <h1>Browser observed hierarchy</h1>
    <section class="grid">
      <article class="card"><h2>Evidence A</h2><img alt="fixture" width="16" height="12" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAF0lEQVR4nGOsCDjBQApgIkn1qIYRpAEAsVkBqEXr8uYAAAAASUVORK5CYII="></article>
      <article class="card"><h2>Evidence B</h2></article>
    </section>
  </main>
</body>
</html>`;
