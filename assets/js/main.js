// Live GitHub numbers (the static values in the page are the fallback),
// copy buttons for install commands, and the footer year.
(() => {
  const fmt = new Intl.NumberFormat("en-US");
  const cells = document.querySelectorAll("[data-repo]");
  const repos = [...new Set([...cells].map((c) => c.dataset.repo))];
  repos.forEach((repo) => {
    fetch(`https://api.github.com/repos/sacridini/${repo}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        cells.forEach((c) => {
          if (c.dataset.repo === repo && typeof data[c.dataset.field] === "number")
            c.textContent = fmt.format(data[c.dataset.field]);
        });
      })
      .catch(() => {});
  });

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Select and copy";
      }
      setTimeout(() => (btn.textContent = "Copy"), 1600);
    });
  });

  const y = document.getElementById("yr");
  if (y) y.textContent = new Date().getFullYear();
})();
