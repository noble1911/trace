// trace homepage: theme toggle, OS-aware download button, and videos that load
// lazily and play only while on screen (posters with a play button instead when
// the visitor prefers reduced motion). No trackers, no framework.

(() => {
  const root = document.documentElement;
  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
  };

  // Theme: follow the OS until the visitor picks one.
  const themeBtn = document.getElementById("theme");
  const osDark = window.matchMedia("(prefers-color-scheme: dark)");
  const current = () => root.dataset.theme || (osDark.matches ? "dark" : "light");
  const label = () => {
    const next = current() === "dark" ? "light" : "dark";
    themeBtn?.setAttribute("aria-label", `Switch to ${next} theme`);
    themeBtn?.setAttribute("title", `Switch to ${next} theme`);
  };
  themeBtn?.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    store.set("trace-site-theme", next);
    label();
  });
  osDark.addEventListener?.("change", label);
  label();

  // Download: pick the visitor's OS for the primary button.
  const ua = navigator.userAgent;
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  const os = /win/i.test(platform) || /Windows/.test(ua)
    ? "windows"
    : /mac/i.test(platform) || /Mac OS X/.test(ua)
      ? /iPhone|iPad/.test(ua) ? null : "macos"
      : /linux/i.test(platform) || /Linux/.test(ua)
        ? /Android/.test(ua) ? null : "linux"
        : null;
  const names = { macos: "macOS", windows: "Windows", linux: "Linux" };
  const primary = document.getElementById("primary-download");
  if (os && primary) {
    primary.querySelector("[data-os-label]").textContent = `Download for ${names[os]}`;
    primary.dataset.os = os;
    primary.href = "https://github.com/noble1911/trace/releases/latest";
    document.querySelector(`.platform[data-os="${os}"]`)?.classList.add("current");
  }

  // Point each button at the newest release that has its file. A release is
  // published first and its builds upload the files 20-30 minutes later, so the
  // newest release can have none yet (or lack one platform's, if its build
  // failed): each platform then gets the newest release that does have its file.
  // The links already go to the latest release page, so this is only an upgrade:
  // if GitHub's API is unreachable (or rate-limited) nothing changes.
  const pick = {
    macos: (n) => n.endsWith("-macos.dmg"),
    windows: (n) => n.endsWith("-windows-x86_64-setup.exe"),
    appimage: (n) => n.endsWith(".AppImage"),
    deb: (n) => n.endsWith(".deb"),
  };
  fetch("https://api.github.com/repos/noble1911/trace/releases?per_page=20", {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((list) => {
      const releases = (Array.isArray(list) ? list : [])
        .filter((rel) => !rel.draft && !rel.prerelease && rel.published_at)
        .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
      /** The newest release's file of this kind, with that release's tag. */
      const newest = (kind) => {
        for (const rel of releases) {
          const asset = (rel.assets || []).find((a) => pick[kind](a.name));
          if (asset) return { url: asset.browser_download_url, tag: rel.tag_name };
        }
        return null;
      };
      for (const a of document.querySelectorAll("[data-asset]")) {
        const found = newest(a.dataset.asset);
        if (found) {
          a.href = found.url;
          a.title = found.tag;
        }
      }
      // The version shown is the one this visitor's button downloads, or the
      // newest release anyone can download.
      const mine = os ? newest(os === "linux" ? "appimage" : os) : null;
      if (primary && mine) primary.href = mine.url;
      const shown = mine ?? Object.keys(pick).map(newest).find(Boolean);
      if (shown) {
        for (const el of document.querySelectorAll("[data-version]")) el.textContent = shown.tag;
      }
    })
    .catch(() => {});

  // Videos.
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const playIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
  const pauseIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg>';

  const load = (v) => {
    if (v.dataset.loaded) return;
    for (const s of v.querySelectorAll("source[data-src]")) s.src = s.dataset.src;
    v.dataset.loaded = "1";
    v.load();
  };

  for (const v of document.querySelectorAll("video[data-clip]")) {
    const frame = v.closest(".frame");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toggle";
    frame.append(btn);
    const name = v.getAttribute("aria-label") || "clip";
    v.userPaused = reduce.matches;
    const sync = () => {
      const playing = !v.paused;
      btn.innerHTML = playing ? pauseIcon : playIcon;
      btn.setAttribute("aria-label", `${playing ? "Pause" : "Play"} video: ${name}`);
      btn.classList.toggle("big", !playing && v.userPaused && !v.dataset.played);
    };
    btn.addEventListener("click", () => {
      if (v.paused) {
        v.userPaused = false;
        load(v);
        v.play().catch(() => {});
        v.dataset.played = "1";
      } else {
        v.userPaused = true;
        v.pause();
      }
    });
    v.addEventListener("play", sync);
    v.addEventListener("pause", sync);
    sync();
  }

  const onScreen = new IntersectionObserver(
    (entries) => {
      for (const { target: v, isIntersecting } of entries) {
        if (isIntersecting) {
          // A paused clip (reduced motion, or paused by hand) keeps its poster
          // and downloads nothing until someone presses play.
          if (!v.userPaused) {
            load(v);
            v.play().catch(() => {});
          }
        } else if (!v.paused) {
          v.pause();
        }
      }
    },
    { rootMargin: "200px 0px", threshold: 0.25 },
  );
  for (const v of document.querySelectorAll("video[data-clip]")) onScreen.observe(v);
})();
