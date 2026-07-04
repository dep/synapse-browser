function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function errorPageHtml(desc: string, url: string): string {
  const safeDesc = escapeHtml(desc)
  const safeUrl = escapeHtml(url)
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Page failed to load</title>
    <style>
      body { font-family: -apple-system, sans-serif; background: #1e1f24; color: #e6e6ea;
             display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { text-align: center; max-width: 480px; padding: 24px; }
      h1 { font-size: 20px; margin-bottom: 8px; }
      code { color: #9a9aa3; word-break: break-all; }
      a { display: inline-block; margin-top: 16px; color: #7aa2f7; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <code>${safeDesc}</code>
      <br />
      <a href="${safeUrl}">Retry</a>
    </div>
  </body>
</html>`
}

export function errorPageDataUrl(desc: string, url: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(errorPageHtml(desc, url))}`
}
