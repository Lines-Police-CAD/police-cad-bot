(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STATE = {
    commands: [],
    query: "",
    category: "All",
  };

  /* ---------- theme ---------- */
  const themeToggle = $("#theme-toggle");
  themeToggle?.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || "dark";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("lpc-docs-theme", next); } catch (_) {}
  });

  /* ---------- mobile nav ---------- */
  const sidebar = $("#sidebar");
  const menuBtn = $("#menu-btn");
  menuBtn?.addEventListener("click", () => {
    const open = sidebar.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", String(open));
  });
  $$(".sidenav a").forEach((a) =>
    a.addEventListener("click", () => sidebar.classList.remove("open"))
  );

  /* ---------- active section highlighting ---------- */
  const navLinks = $$("[data-nav]");
  const sectionIds = navLinks.map((a) => a.getAttribute("data-nav"));
  const sectionEls = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);

  const setActive = (id) => {
    navLinks.forEach((a) =>
      a.classList.toggle("active", a.getAttribute("data-nav") === id)
    );
  };

  const isNearBottom = () =>
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;

  const lastSectionId = sectionEls.length ? sectionEls[sectionEls.length - 1].id : null;

  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver(
      (entries) => {
        // When the page is scrolled to the bottom, the last section can sit
        // below the observer's active band (rootMargin) and never be flagged
        // as visible. Force it active in that case.
        if (lastSectionId && isNearBottom()) {
          setActive(lastSectionId);
          return;
        }
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0.1, 0.5, 0.9] }
    );
    sectionEls.forEach((el) => obs.observe(el));
  }

  // Scroll/resize fallback for the bottom edge — IntersectionObserver may not
  // re-fire if you scroll the last few pixels into view.
  const onScrollEdge = () => {
    if (lastSectionId && isNearBottom()) setActive(lastSectionId);
  };
  window.addEventListener("scroll", onScrollEdge, { passive: true });
  window.addEventListener("resize", onScrollEdge);

  /* ---------- footer year ---------- */
  const yearEl = document.getElementById("copyright-year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- search keyboard shortcut ---------- */
  const searchInput = $("#search");
  const searchKbd = $("#search-kbd");
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (e.key === "Escape") {
        e.target.blur();
      }
      return;
    }
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      searchInput?.focus();
    }
  });
  searchInput?.addEventListener("focus", () => searchKbd?.setAttribute("hidden", ""));
  searchInput?.addEventListener("blur", () => searchKbd?.removeAttribute("hidden"));
  searchInput?.addEventListener("input", (e) => {
    STATE.query = e.target.value.trim().toLowerCase();
    render();
  });

  /* ---------- load commands ---------- */
  fetch("./commands.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((data) => {
      STATE.commands = (data.commands || []).filter((c) => !c.debug);
      $("#stat-commands").textContent = STATE.commands.length;
      $("#nav-count").textContent = STATE.commands.length;
      buildChips();
      render();
    })
    .catch((err) => {
      console.error("Failed to load commands.json", err);
      const list = $("#cmd-list");
      if (list) list.innerHTML = `<p class="empty">Couldn't load commands. Try refreshing.</p>`;
    });

  /* ---------- chips ---------- */
  function buildChips() {
    const counts = STATE.commands.reduce((acc, c) => {
      acc[c.category] = (acc[c.category] || 0) + 1;
      return acc;
    }, {});
    const order = ["All", "Account", "Community", "Dispatch", "Economy", "Lookup", "Admin", "Info"];
    const chips = $("#chips");
    chips.innerHTML = "";
    order.forEach((cat) => {
      if (cat !== "All" && !counts[cat]) return;
      const n = cat === "All" ? STATE.commands.length : counts[cat];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", cat === STATE.category ? "true" : "false");
      btn.innerHTML = `${cat}<span class="chip-count">${n}</span>`;
      btn.addEventListener("click", () => {
        STATE.category = cat;
        $$(".chip", chips).forEach((c) =>
          c.setAttribute("aria-selected", c === btn ? "true" : "false")
        );
        render();
      });
      chips.appendChild(btn);
    });
  }

  /* ---------- render ---------- */
  function flattenOptionNames(opts) {
    if (!Array.isArray(opts)) return [];
    const out = [];
    for (const o of opts) {
      out.push(o.name);
      out.push(...flattenOptionNames(o.options));
    }
    return out;
  }

  function match(cmd) {
    if (STATE.category !== "All" && cmd.category !== STATE.category) return false;
    if (!STATE.query) return true;
    const hay = (
      cmd.name +
      " " +
      cmd.description +
      " " +
      flattenOptionNames(cmd.options).join(" ")
    ).toLowerCase();
    return hay.includes(STATE.query);
  }

  function render() {
    const list = $("#cmd-list");
    const empty = $("#empty");
    list.innerHTML = "";
    const visible = STATE.commands.filter(match);
    if (visible.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    const tpl = $("#cmd-card-tpl");
    const frag = document.createDocumentFragment();
    visible.forEach((cmd) => frag.appendChild(renderCard(cmd, tpl)));
    list.appendChild(frag);
  }

  function renderCard(cmd, tpl) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.name = cmd.name;
    node.dataset.category = cmd.category;
    node.style.setProperty("--cat", `var(--cat-${cmd.category})`);

    $(".cmd-name", node).textContent = cmd.name;
    $(".cmd-desc", node).textContent = cmd.description || "—";
    $(".cmd-cat", node).textContent = cmd.category;

    const optionCount = countOptions(cmd.options);
    const meta = [
      optionCount ? `${optionCount} opt${optionCount === 1 ? "" : "s"}` : "no options",
    ].join(" · ");
    $(".cmd-meta", node).textContent = meta;

    // options
    const optTree = $(".opt-tree", node);
    if (cmd.options && cmd.options.length) {
      cmd.options.forEach((o) => optTree.appendChild(renderOption(o)));
    } else {
      const empty = document.createElement("p");
      empty.className = "perm-empty";
      empty.textContent = "This command takes no options.";
      optTree.appendChild(empty);
    }

    // permissions
    const perms = $(".perm-chips", node);
    const allPerms = [
      ...(cmd.permissions.channel || []).map((p) => ({ label: p, scope: "Channel" })),
      ...(cmd.permissions.member || []).map((p) => ({ label: p, scope: "Member" })),
    ];
    if (allPerms.length === 0) {
      const empty = document.createElement("p");
      empty.className = "perm-empty";
      empty.textContent = "No extra Discord permissions required.";
      perms.appendChild(empty);
    } else {
      allPerms.forEach((p) => {
        const chip = document.createElement("span");
        chip.className = "perm-chip";
        chip.textContent = p.label.replace(/_/g, " ").toLowerCase();
        chip.title = `${p.scope} permission`;
        perms.appendChild(chip);
      });
    }

    // expand toggle
    const head = $(".cmd-head", node);
    const body = $(".cmd-body", node);
    head.addEventListener("click", () => {
      const open = node.hasAttribute("open");
      if (open) {
        node.removeAttribute("open");
        body.hidden = true;
        head.setAttribute("aria-expanded", "false");
      } else {
        node.setAttribute("open", "");
        body.hidden = false;
        head.setAttribute("aria-expanded", "true");
      }
    });

    return node;
  }

  function countOptions(opts) {
    if (!Array.isArray(opts)) return 0;
    // Count top-level options + subcommand options
    let n = 0;
    for (const o of opts) {
      n += 1;
      if (o.options) n += o.options.length;
    }
    return n;
  }

  function renderOption(opt) {
    const tpl = $("#opt-row-tpl");
    const node = tpl.content.firstElementChild.cloneNode(true);
    $(".opt-name", node).textContent = opt.name;
    $(".opt-type", node).textContent = opt.type;
    const reqEl = $(".opt-req", node);
    reqEl.textContent = opt.required ? "REQUIRED" : "OPTIONAL";
    reqEl.classList.add(opt.required ? "req-yes" : "req-no");
    $(".opt-desc", node).textContent = opt.description || "";

    const choicesEl = $(".opt-choices", node);
    if (opt.choices && opt.choices.length) {
      opt.choices.forEach((c) => {
        const span = document.createElement("span");
        span.className = "choice";
        span.textContent = c.name;
        choicesEl.appendChild(span);
      });
    }

    const childrenEl = $(".opt-children", node);
    if (opt.options && opt.options.length) {
      opt.options.forEach((c) => childrenEl.appendChild(renderOption(c)));
    }

    return node;
  }
})();
