// Extract [[wiki-links]] and build backlink / related-note data + SVG graph.
const LINK_RE = /\[\[([^\[\]\n]{1,200})\]\]/g;

export function extractLinks(content) {
  const out = new Set();
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(content || ""))) out.add(m[1].trim());
  return [...out];
}

/** Build mapping: for a note, which notes reference it (by title match). */
export function buildGraph(notes) {
  const byTitle = new Map();
  for (const n of notes) byTitle.set(n.title.trim().toLowerCase(), n);
  const linksOut = new Map(); // id -> [{title, id?}]
  const backlinks = new Map(); // id -> [{id, title}]
  for (const n of notes) backlinks.set(n.id, []);
  for (const n of notes) {
    const links = extractLinks(n.content).map((title) => {
      const target = byTitle.get(title.toLowerCase());
      return { title, id: target?.id || null };
    });
    linksOut.set(n.id, links);
    for (const l of links) if (l.id) backlinks.get(l.id).push({ id: n.id, title: n.title });
  }
  return { linksOut, backlinks, byTitle };
}

export function relatedNotes(note, notes, { limit = 8 } = {}) {
  const tagSet = new Set(note.tags || []);
  return notes
    .filter((n) => n.id !== note.id && !n.archived)
    .map((n) => {
      let score = 0;
      if (n.category && n.category === note.category) score += 2;
      if (n.projectId && n.projectId === note.projectId) score += 3;
      for (const t of n.tags || []) if (tagSet.has(t)) score += 1;
      return { note: n, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.note);
}

/** Render an interactive SVG force graph into a container. */
export function renderGraph(container, notes, projects, { onNodeClick, filter = {} } = {}) {
  const filtered = notes.filter((n) => {
    if (filter.onlyConnected && !hasAnyLink(n, notes)) return false;
    if (filter.category && n.category !== filter.category) return false;
    if (filter.projectId && n.projectId !== filter.projectId) return false;
    return true;
  });
  const { linksOut } = buildGraph(filtered);

  const width = container.clientWidth || 800;
  const height = container.clientHeight || 500;
  const padding = 25;

  // Initialize nodes
  const nodes = filtered.map((n, i) => ({
    id: n.id, title: n.title,
    x: width / 2 + (Math.random() - 0.5) * 100,
    y: height / 2 + (Math.random() - 0.5) * 100,
    vx: 0, vy: 0, ref: n,
  }));
  
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const n of filtered) {
    for (const l of linksOut.get(n.id) || []) {
      if (l.id && nodeById.has(l.id)) edges.push({ a: n.id, b: l.id });
    }
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "graph-canvas");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.cursor = "grab";
  
  const gRoot = document.createElementNS(svg.namespaceURI, "g");
  svg.append(gRoot);
  container.replaceChildren(svg);

  let time = 0;

  // --- 1. MAGNETIC & WEAVY PHYSICS TICK ---
  function tick() {
    if (!nodes.length) return;
    time += 0.05; // Animation speed

    // Repulsion (Push nodes apart like magnets)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx*dx + dy*dy || 1;
        
        // STRONG REPULSION: 15000 is a good balance for a 300px sidebar
        const rep = 15000 / d2; 
        
        a.vx += dx * rep * 0.5; a.vy += dy * rep * 0.5;
        b.vx -= dx * rep * 0.5; b.vy -= dy * rep * 0.5;
      }
    }

    // Attraction (Pull connected nodes together)
    for (const edge of edges) {
      const a = nodeById.get(edge.a), b = nodeById.get(edge.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const k = (dist - 80) * 0.01; 
      a.vx += (dx / dist) * k; a.vy += (dy / dist) * k;
      b.vx -= (dx / dist) * k; b.vy -= (dy / dist) * k;
    }

    // Apply velocity, Weavy Float, and Bounds
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      
      // Weavy floating effect
      const floatX = Math.sin(time + i) * 0.6;
      const floatY = Math.cos(time + i) * 0.6;

      n.vx *= 0.88; // Friction
      n.vy *= 0.88;
      
      n.x += n.vx + floatX;
      n.y += n.vy + floatY;

      // Keep inside bounds
      n.x = Math.max(padding, Math.min(width - padding, n.x));
      n.y = Math.max(padding, Math.min(height - padding, n.y));
    }
  }

  // --- 2. DRAWING ---
  function draw() {
    gRoot.replaceChildren();
    
    // Draw Edges (Lines that connect dots)
    edges.forEach(e => {
      const a = nodeById.get(e.a), b = nodeById.get(e.b);
      if (!a || !b) return;

      // Line color matches the target project
      let lineColor = "var(--border-2)";
      if (b.ref.projectId) {
        const proj = projects.find(p => p.id === b.ref.projectId);
        if (proj) lineColor = proj.color || "var(--primary)";
      }

      const line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
      line.setAttribute("stroke", lineColor);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("opacity", "0.6");
      gRoot.appendChild(line);
    });

    // Draw Nodes (Dots)
    nodes.forEach(n => {
      const c = document.createElementNS(svg.namespaceURI, "circle");
      c.setAttribute("cx", n.x); c.setAttribute("cy", n.y); c.setAttribute("r", 6);
      
      // Node Color Logic
      let fill = "var(--text-muted)";
      if (n.ref.projectId) {
        const proj = projects.find(p => p.id === n.ref.projectId);
        if (proj) fill = proj.color || "var(--primary)";
      } else if (n.ref.favourite) {
        fill = "var(--primary)";
      }
      
      c.setAttribute("fill", fill);
      c.style.cursor = "pointer";
      c.style.transition = "r 0.2s ease, filter 0.2s ease";

      // Hover Interaction (Magnetic Glow)
      c.addEventListener("mouseenter", () => {
        c.setAttribute("r", 10);
        c.style.filter = `drop-shadow(0 0 10px ${fill}) brightness(1.3)`;
      });
      c.addEventListener("mouseleave", () => {
        c.setAttribute("r", 6);
        c.style.filter = "none";
      });
      
      c.addEventListener("click", () => onNodeClick(n.ref));
      gRoot.appendChild(c);

      // Optional: Add title labels for the dots
      const label = document.createElementNS(svg.namespaceURI, "text");
      label.setAttribute("x", n.x + 12); label.setAttribute("y", n.y + 4);
      label.setAttribute("font-size", "10");
      label.setAttribute("fill", "var(--text-main)");
      label.style.pointerEvents = "none";
      label.textContent = n.title.length > 18 ? n.title.slice(0, 18) + "…" : n.title;
      gRoot.appendChild(label);
    });
  }

  // --- 3. ANIMATION LOOP ---
  let raf;
  function loop() {
    tick();
    draw();
    raf = requestAnimationFrame(loop);
  }
  loop();

  return { destroy: () => cancelAnimationFrame(raf) };
}

function hasAnyLink(note, notes) {
  if (extractLinks(note.content).length) return true;
  const { backlinks } = buildGraph(notes);
  return (backlinks.get(note.id) || []).length > 0;
}