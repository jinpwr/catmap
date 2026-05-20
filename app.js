/* ═══════════════════════════════════════════════════════════════
   Boardflow — app.js  (v2 – full feature build)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── tiny helpers ── */
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ══════════════════════════════════════════════════════════════
     MULTI-BOARD STORAGE SCHEMA
     localStorage key: 'boardflow_boards'  → { [boardId]: boardRecord }
     localStorage key: 'boardflow_active'  → boardId
  ══════════════════════════════════════════════════════════════ */
  const BOARDS_KEY  = 'boardflow_boards';
  const ACTIVE_KEY  = 'boardflow_active';

  function loadAllBoards() {
    try { return JSON.parse(localStorage.getItem(BOARDS_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveAllBoards(boards) {
    try { localStorage.setItem(BOARDS_KEY, JSON.stringify(boards)); } catch {}
  }
  function getActiveId() {
    return localStorage.getItem(ACTIVE_KEY) || null;
  }
  function setActiveId(id) {
    localStorage.setItem(ACTIVE_KEY, id);
  }

  /* ══════════════════════════════════════════════════════════════
     APP STATE  (current board in memory)
  ══════════════════════════════════════════════════════════════ */
  const S = {
    boardId:      null,
    boardName:    'Untitled Board',
    elements:     {},      // id → {type,x,y,w,h,color,icon,title,tags,content}
    connections:  [],      // [{id,fromId,toId,color,style}]
    lineInstances:{},      // connId → LeaderLine
    mode:         'select',
    selected:     [],
    lineStyle:    'arrow', // 'arrow' | 'dot'
    activeColor:  '#3B82F6',
    theme:        'dark',
    pz:           null,
    // connection-mode wiring state
    wiring: {
      active:  false,
      fromId:  null,
      fromAnchor: null,
      dragging:   false,
      startClientX: 0,
      startClientY: 0,
    },
  };

  /* ══════════════════════════════════════════════════════════════
     DOM REFS
  ══════════════════════════════════════════════════════════════ */
  const canvasCont   = $('#canvas-container');
  const canvas       = $('#canvas');
  const statusMode   = $('#status-mode');
  const statusZoom   = $('#status-zoom');
  const statusHint   = $('#status-hint');
  const ctxMenu      = $('#context-menu');
  const connOverlay  = $('#connection-overlay');
  const connBannerTx = $('#connection-banner-text');
  const previewLine  = $('#preview-line');
  const previewSVG   = $('#preview-svg');
  const boardNameEl  = $('#board-name');
  const iconPopup    = $('#icon-picker-popup');
  const iconGrid     = $('#icon-picker-grid');
  const dashboard    = $('#dashboard');
  const dashGrid     = $('#dash-board-grid');

  /* ══════════════════════════════════════════════════════════════
     THEME
  ══════════════════════════════════════════════════════════════ */
  const themeIconSun   = $('#theme-icon-sun');
  const themeIconMoon  = $('#theme-icon-moon');
  const dashSun  = $('#dash-theme-icon-sun');
  const dashMoon = $('#dash-theme-icon-moon');

  function applyTheme(t) {
    S.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    const isDark = t === 'dark';
    themeIconSun.style.display  = isDark ? '' : 'none';
    themeIconMoon.style.display = isDark ? 'none' : '';
    dashSun.style.display  = isDark ? '' : 'none';
    dashMoon.style.display = isDark ? 'none' : '';
    try { localStorage.setItem('boardflow_theme', t); } catch {}
    // Re-draw lines so they pick up new colours correctly
    setTimeout(redrawAllLines, 80);
  }

  function toggleTheme() { applyTheme(S.theme === 'dark' ? 'light' : 'dark'); }

  $('#btn-theme').addEventListener('click', toggleTheme);
  $('#dash-theme-toggle').addEventListener('click', toggleTheme);

  /* ══════════════════════════════════════════════════════════════
     ICONS
  ══════════════════════════════════════════════════════════════ */
  const ICONS = ['📌','⭐','💡','🔥','✅','❌','📝','🔗','🎯','📊','💬','🚀',
                 '⚠️','🏷️','🔒','📁','🎨','⚙️','🔍','📅','💎','🧩','📐','🌐'];

  function buildIconPicker() {
    iconGrid.innerHTML = '';
    ICONS.forEach(icon => {
      const btn = document.createElement('button');
      btn.className = 'icon-picker-btn';
      btn.textContent = icon;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (S._iconTarget) {
          const id = S._iconTarget.closest('[data-id]')?.dataset.id;
          const slot = S._iconTarget;
          slot.textContent = icon;
          if (id && S.elements[id]) {
            S.elements[id].icon = icon;
            saveCurrentBoard();
          }
        }
        hideIconPicker();
      });
      iconGrid.appendChild(btn);
    });
  }
  buildIconPicker();

  let _iconPickerCloseHandler = null;
  function showIconPicker(slotEl, event) {
    event.stopPropagation();
    S._iconTarget = slotEl;
    const r = slotEl.getBoundingClientRect();
    iconPopup.style.left = (r.right + 8) + 'px';
    iconPopup.style.top  = r.top + 'px';
    iconPopup.classList.remove('hidden');
    setTimeout(() => {
      if (_iconPickerCloseHandler) document.removeEventListener('click', _iconPickerCloseHandler);
      _iconPickerCloseHandler = () => hideIconPicker();
      document.addEventListener('click', _iconPickerCloseHandler, { once: true });
    }, 0);
  }
  function hideIconPicker() {
    iconPopup.classList.add('hidden');
    S._iconTarget = null;
  }

  /* ══════════════════════════════════════════════════════════════
     PANZOOM INIT
  ══════════════════════════════════════════════════════════════ */
  function initPanzoom() {
    const pz = window.Panzoom(canvas, {
      maxScale: 4, minScale: 0.15, step: 0.08,
      canvas: true, contain: false, excludeClass: 'no-pan',
    });
    S.pz = pz;

    canvasCont.addEventListener('wheel', e => {
      e.preventDefault();
      pz.zoomWithWheel(e);
      updateZoomStatus();
      scheduleLineUpdate();
    }, { passive: false });

    // Middle-click + Space-drag panning
    let spaceDown = false, midDrag = false, midStart = null, panStart = null;

    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && !e.target.isContentEditable && e.target.tagName !== 'INPUT') {
        e.preventDefault(); spaceDown = true;
        canvasCont.style.cursor = 'grab';
      }
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'Space') { spaceDown = false; canvasCont.style.cursor = ''; }
    });

    canvasCont.addEventListener('mousedown', e => {
      if (e.button === 1 || spaceDown) {
        e.preventDefault(); midDrag = true;
        midStart = { x: e.clientX, y: e.clientY };
        panStart  = { x: pz.getPan().x, y: pz.getPan().y };
        canvasCont.classList.add('panning');
      }
    });
    document.addEventListener('mousemove', e => {
      if (!midDrag) return;
      pz.pan(panStart.x + e.clientX - midStart.x, panStart.y + e.clientY - midStart.y);
      scheduleLineUpdate();
    });
    document.addEventListener('mouseup', e => {
      if (midDrag || e.button === 1) {
        midDrag = false; midStart = null; panStart = null;
        canvasCont.classList.remove('panning');
      }
    });

    pz.zoom(1, { animate: false });
    updateZoomStatus();
  }

  function updateZoomStatus() {
    if (!S.pz) return;
    statusZoom.textContent = Math.round(S.pz.getScale() * 100) + '%';
  }

  function canvasPoint(cx, cy) {
    const scale = S.pz.getScale();
    const pan   = S.pz.getPan();
    const r     = canvasCont.getBoundingClientRect();
    return { x: (cx - r.left - pan.x) / scale, y: (cy - r.top - pan.y) / scale };
  }

  /* ══════════════════════════════════════════════════════════════
     MODE MANAGEMENT
  ══════════════════════════════════════════════════════════════ */
  const MODE_LABELS = { select:'● Select', card:'◆ Card', text:'◎ Text', line:'⟜ Connect' };

  function setMode(mode) {
    S.mode = mode;
    $$('.tool-btn[data-mode]').forEach(b => b.classList.remove('active'));
    const btn = $(`[data-mode="${mode}"]`);
    if (btn) btn.classList.add('active');
    statusMode.textContent = MODE_LABELS[mode] || '● Select';

    if (mode === 'line') {
      startWiringMode();
    } else {
      exitWiringMode();
      canvasCont.classList.remove('connect-mode');
    }
    if (mode !== 'line' && mode !== 'card' && mode !== 'text') {
      statusHint.textContent = 'Shift+click to multi-select · Right-click to connect';
    }
  }

  $('#btn-select').addEventListener('click', () => setMode('select'));
  $('#btn-card').addEventListener('click', () => { setMode('card'); statusHint.textContent = 'Click canvas to place card'; });
  $('#btn-text').addEventListener('click', () => { setMode('text'); statusHint.textContent = 'Click canvas to place text'; });
  $('#btn-line').addEventListener('click', () => setMode('line'));

  document.addEventListener('keydown', e => {
    if (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'v' || e.key === 'V') setMode('select');
    if (e.key === 'c' || e.key === 'C') { setMode('card'); statusHint.textContent = 'Click canvas to place card'; }
    if (e.key === 't' || e.key === 'T') { setMode('text'); statusHint.textContent = 'Click canvas to place text'; }
    if (e.key === 'l' || e.key === 'L') setMode('line');
    if (e.key === 'Delete') deleteSelected();
    if (e.key === 'Escape') { clearSelection(); setMode('select'); hideCtxMenu(); }
  });

  /* ══════════════════════════════════════════════════════════════
     LINE STYLE
  ══════════════════════════════════════════════════════════════ */
  const lineStyleMenu = $('#line-style-menu');
  $('#btn-line-style').addEventListener('click', e => {
    e.stopPropagation();
    lineStyleMenu.classList.toggle('open');
  });
  $$('[data-style]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.lineStyle = btn.dataset.style;
      $$('[data-style]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      lineStyleMenu.classList.remove('open');
      // re-draw all lines with new style
      rebuildAllLines();
    });
  });

  /* ══════════════════════════════════════════════════════════════
     CANVAS CLICK → spawn elements / deselect
  ══════════════════════════════════════════════════════════════ */
  canvasCont.addEventListener('click', e => {
    if (e.target !== canvasCont && e.target !== canvas) return;
    // Blur any active contenteditable
    if (document.activeElement && document.activeElement.isContentEditable) {
      document.activeElement.blur();
    }
    if (S.mode === 'line') return;
    if (S.mode === 'select') { clearSelection(); return; }
    const pos = canvasPoint(e.clientX, e.clientY);
    if (S.mode === 'card') spawnCard(pos.x, pos.y);
    if (S.mode === 'text') spawnText(pos.x, pos.y);
    setMode('select');
  });

  // Also blur on canvas direct click
  canvasCont.addEventListener('mousedown', e => {
    if (e.target === canvasCont || e.target === canvas) {
      if (document.activeElement && document.activeElement.isContentEditable) {
        document.activeElement.blur();
      }
    }
    hideCtxMenu();
    closeAllDropdowns();
    hideIconPicker();
  });

  /* ══════════════════════════════════════════════════════════════
     D3-FORCE PHYSICS SIMULATION
  ══════════════════════════════════════════════════════════════ */
  let simulation = null;

  function initSimulation() {
    if (simulation) { simulation.stop(); }
    simulation = d3.forceSimulation()
      .force('link', d3.forceLink().id(d => d.id).distance(180).strength(0.12))
      .force('charge', d3.forceManyBody().strength(-60).distanceMax(300))
      .alphaDecay(0.04)
      .on('tick', onSimTick);
    simulation.stop(); // only runs on drag
  }

  function buildSimNodes() {
    const nodes = Object.values(S.elements).map(el => ({
      id: el.id,
      x:  el.x + (el.w || 100) / 2,
      y:  el.y + (el.h || 50)  / 2,
      fx: null, fy: null,
    }));
    const links = S.connections.map(c => ({ source: c.fromId, target: c.toId }));
    simulation.nodes(nodes);
    simulation.force('link').links(links);
    return nodes;
  }

  function onSimTick() {
    if (!simulation) return;
    simulation.nodes().forEach(node => {
      if (node.fx !== null) return; // pinned (dragging element)
      const el = S.elements[node.id];
      if (!el) return;
      const domEl = canvas.querySelector(`[data-id="${node.id}"]`);
      if (!domEl) return;
      el.x = node.x - (el.w || 100) / 2;
      el.y = node.y - (el.h || 50)  / 2;
      domEl.style.left = el.x + 'px';
      domEl.style.top  = el.y + 'px';
    });
    redrawAllLines();
  }

  function reheatSimulation() {
    if (!simulation) return;
    buildSimNodes();
    simulation.alpha(0.3).restart();
    setTimeout(() => { if (simulation) simulation.stop(); }, 1500);
  }

  function pinNodeInSim(id, x, y) {
    if (!simulation) return;
    const node = simulation.nodes().find(n => n.id === id);
    if (node) { node.fx = x; node.fy = y; }
  }

  function unpinNodeInSim(id) {
    if (!simulation) return;
    const node = simulation.nodes().find(n => n.id === id);
    if (node) { node.fx = null; node.fy = null; }
  }

  /* ══════════════════════════════════════════════════════════════
     SPAWN CARD
  ══════════════════════════════════════════════════════════════ */
  function spawnCard(cx, cy, data = null) {
    const id = data?.id || uid();
    if (!data) {
      data = {
        id, type: 'card',
        x: cx - 120, y: cy - 80,
        w: 250, h: 170,
        color: S.activeColor,
        icon: '📌',
        title: '', tags: '', content: '',
      };
      S.elements[id] = data;
    } else {
      S.elements[id] = data;
    }

    const el = document.createElement('div');
    el.className = 'board-card no-pan';
    el.dataset.id = id;
    el.style.cssText = `left:${data.x}px;top:${data.y}px;width:${data.w}px;height:${data.h}px;`;

    el.innerHTML = `
      <div class="card-header" style="background:${hexRgba(data.color, 0.13)}">
        <div class="card-icon-slot" title="Change icon">${data.icon || '📌'}</div>
        <div class="card-title no-pan" contenteditable="true" spellcheck="false">${esc(data.title)}</div>
      </div>
      <div class="card-tags no-pan">
        <span class="card-tag" contenteditable="true" spellcheck="false">${esc(data.tags)}</span>
      </div>
      <div class="card-body no-pan" contenteditable="true" spellcheck="false">${esc(data.content)}</div>
      <div class="resize-handle no-pan" data-resize="true"></div>
      <div class="anchor-dot top"    data-anchor="top"></div>
      <div class="anchor-dot bottom" data-anchor="bottom"></div>
      <div class="anchor-dot left"   data-anchor="left"></div>
      <div class="anchor-dot right"  data-anchor="right"></div>
    `;

    canvas.appendChild(el);
    setupDrag(el);
    setupCardResize(el);
    setupElementEvents(el);

    // Icon picker
    el.querySelector('.card-icon-slot').addEventListener('click', e => {
      e.stopPropagation();
      if (S.mode === 'line') return;
      showIconPicker(el.querySelector('.card-icon-slot'), e);
    });

    // Content editable events — stop drag from interfering
    el.querySelectorAll('[contenteditable]').forEach(ce => {
      ce.addEventListener('mousedown', e => { e.stopPropagation(); });
      ce.addEventListener('click',     e => { e.stopPropagation(); });
      ce.addEventListener('input', () => syncElementData(id));
      ce.addEventListener('blur',  () => { syncElementData(id); saveCurrentBoard(); });
    });

    return el;
  }

  /* ══════════════════════════════════════════════════════════════
     SPAWN TEXT
  ══════════════════════════════════════════════════════════════ */
  function spawnText(cx, cy, data = null) {
    const id = data?.id || uid();
    if (!data) {
      data = {
        id, type: 'text',
        x: cx - 60, y: cy - 14,
        w: 200, h: 40,
        color: S.activeColor, content: '',
      };
      S.elements[id] = data;
    } else {
      S.elements[id] = data;
    }

    const el = document.createElement('div');
    el.className = 'board-text no-pan';
    el.dataset.id = id;
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.style.cssText = `left:${data.x}px;top:${data.y}px;min-width:${data.w}px;color:${data.color};`;
    el.innerText = data.content;

    // Anchor dots
    ['top','bottom','left','right'].forEach(pos => {
      const dot = document.createElement('div');
      dot.className = `anchor-dot ${pos}`;
      dot.dataset.anchor = pos;
      el.appendChild(dot);
    });

    canvas.appendChild(el);
    setupDrag(el);
    setupElementEvents(el);

    el.addEventListener('mousedown', e => { e.stopPropagation(); });
    el.addEventListener('input',  () => syncElementData(id));
    el.addEventListener('blur',   () => { syncElementData(id); saveCurrentBoard(); });

    if (!data.content) setTimeout(() => el.focus(), 40);
    return el;
  }

  /* ══════════════════════════════════════════════════════════════
     INTERACT.JS — DRAG (full-surface)
  ══════════════════════════════════════════════════════════════ */
  function setupDrag(el) {
    const id = el.dataset.id;
    const isCard = el.classList.contains('board-card');

    interact(el).draggable({
      ignoreFrom: '[contenteditable], .resize-handle, .anchor-dot, .card-icon-slot',
      listeners: {
        start() {
          el.classList.add('dragging');
          bringToFront(el);
          // Pin in sim
          const s = S.elements[id];
          if (s && simulation) {
            pinNodeInSim(id, s.x + (s.w||100)/2, s.y + (s.h||50)/2);
            simulation.alpha(0.4).restart();
          }
        },
        move(e) {
          const s = S.elements[id];
          if (!s) return;
          const scale = S.pz.getScale();
          s.x += e.dx / scale;
          s.y += e.dy / scale;
          el.style.left = s.x + 'px';
          el.style.top  = s.y + 'px';
          // Update physics pin
          if (simulation) pinNodeInSim(id, s.x + (s.w||100)/2, s.y + (s.h||50)/2);
          scheduleLineUpdate();
        },
        end() {
          el.classList.remove('dragging');
          if (simulation) {
            unpinNodeInSim(id);
            simulation.alpha(0.25).restart();
            setTimeout(() => { if (simulation) simulation.stop(); }, 1200);
          }
          scheduleLineUpdate();
          saveCurrentBoard();
        },
      },
    });
  }

  /* ══════════════════════════════════════════════════════════════
     INTERACT.JS — CARD RESIZE
  ══════════════════════════════════════════════════════════════ */
  function setupCardResize(el) {
    const id = el.dataset.id;
    interact(el).resizable({
      edges: { bottom: true, right: true, bottomRight: '.resize-handle' },
      listeners: {
        move(e) {
          const s = S.elements[id];
          if (!s) return;
          s.w = Math.max(180, e.rect.width);
          s.h = Math.max(100, e.rect.height);
          el.style.width  = s.w + 'px';
          el.style.height = s.h + 'px';
          scheduleLineUpdate();
        },
        end() { saveCurrentBoard(); },
      },
      modifiers: [interact.modifiers.restrictSize({ min: { width: 180, height: 100 } })],
    });
  }

  /* ══════════════════════════════════════════════════════════════
     ELEMENT MOUSE EVENTS (selection + wiring anchors)
  ══════════════════════════════════════════════════════════════ */
  function setupElementEvents(el) {
    el.addEventListener('mousedown', handleElementMousedown);
    el.addEventListener('mouseenter', () => {
      if (S.wiring.active) showAnchors(el);
    });
    el.addEventListener('mouseleave', () => {
      if (S.wiring.active && !S.wiring.dragging) hideAnchors(el);
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      const id = el.dataset.id;
      if (!S.selected.includes(id)) { clearSelection(); selectEl(id); }
      showCtxMenu(e.clientX, e.clientY);
    });

    // Anchor dot events
    el.querySelectorAll('.anchor-dot').forEach(dot => {
      dot.addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
        if (S.wiring.active) {
          beginWireDrag(el.dataset.id, dot.dataset.anchor, e);
        }
      });
    });
  }

  function handleElementMousedown(e) {
    if (e.target.isContentEditable || e.target.dataset.resize || e.target.classList.contains('anchor-dot') || e.target.classList.contains('card-icon-slot')) return;
    const id = this.dataset.id;
    if (S.wiring.active) {
      // In connection mode: clicking element directly also selects as source
      if (!S.wiring.fromId) {
        S.wiring.fromId = id;
        this.classList.add('connect-source');
        connBannerTx.textContent = 'Now click or drag an anchor on the target element';
      } else if (id !== S.wiring.fromId) {
        finalizeWire(id);
      }
      return;
    }
    if (e.shiftKey) {
      toggleSelectEl(id);
    } else {
      if (!S.selected.includes(id)) { clearSelection(); selectEl(id); }
    }
    updateSelectionHint();
  }

  /* ══════════════════════════════════════════════════════════════
     SELECTION
  ══════════════════════════════════════════════════════════════ */
  function selectEl(id) {
    if (!S.selected.includes(id)) S.selected.push(id);
    const el = canvas.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.add('selected');
  }
  function deselectEl(id) {
    S.selected = S.selected.filter(s => s !== id);
    const el = canvas.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.remove('selected');
  }
  function toggleSelectEl(id) {
    if (S.selected.includes(id)) deselectEl(id);
    else if (S.selected.length < 2) selectEl(id);
    updateSelectionHint();
  }
  function clearSelection() {
    [...S.selected].forEach(id => deselectEl(id));
    S.selected = [];
    updateSelectionHint();
  }
  function updateSelectionHint() {
    const n = S.selected.length;
    if (n === 0) statusHint.textContent = 'Shift+click to multi-select · Right-click to connect';
    else if (n === 1) statusHint.textContent = 'Shift+click another element to multi-select';
    else statusHint.textContent = `${n} selected — right-click to connect`;
  }
  function bringToFront(el) {
    const max = $$('.board-card,.board-text').reduce((m,e) => Math.max(m, parseInt(e.style.zIndex||0)), 0);
    el.style.zIndex = max + 1;
  }

  function syncElementData(id) {
    const el = canvas.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    const s = S.elements[id];
    if (!s) return;
    if (s.type === 'card') {
      s.title   = el.querySelector('.card-title')?.innerText   || '';
      s.tags    = el.querySelector('.card-tag')?.innerText     || '';
      s.content = el.querySelector('.card-body')?.innerText    || '';
    } else {
      s.content = el.innerText || '';
    }
  }

  /* ══════════════════════════════════════════════════════════════
     WIRING MODE (Line button → anchor-dot drag-to-connect)
  ══════════════════════════════════════════════════════════════ */
  function startWiringMode() {
    S.wiring = { active: true, fromId: null, fromAnchor: null, dragging: false, startClientX:0, startClientY:0 };
    canvasCont.classList.add('connect-mode');
    connOverlay.classList.remove('hidden');
    connBannerTx.textContent = 'Hover an element to see anchors — drag an anchor to connect';
  }
  function exitWiringMode() {
    S.wiring.active = false;
    canvasCont.classList.remove('connect-mode');
    connOverlay.classList.add('hidden');
    // clear visuals
    $$('.connect-source').forEach(el => el.classList.remove('connect-source'));
    $$('.anchor-dot.visible').forEach(d => d.classList.remove('visible'));
    hidePreviewLine();
  }

  $('#cancel-connect-mode').addEventListener('click', () => { setMode('select'); });

  function showAnchors(el) {
    el.querySelectorAll('.anchor-dot').forEach(d => d.classList.add('visible'));
  }
  function hideAnchors(el) {
    el.querySelectorAll('.anchor-dot').forEach(d => d.classList.remove('visible'));
  }

  /* Drag-to-connect wire logic */
  function beginWireDrag(fromId, anchor, e) {
    S.wiring.fromId = fromId;
    S.wiring.fromAnchor = anchor;
    S.wiring.dragging = true;
    S.wiring.startClientX = e.clientX;
    S.wiring.startClientY = e.clientY;

    const fromEl = canvas.querySelector(`[data-id="${fromId}"]`);
    if (fromEl) fromEl.classList.add('connect-source');
    connBannerTx.textContent = 'Drag to target element and release';

    const start = anchorClientPos(fromEl, anchor);
    showPreviewLine(start.x, start.y, e.clientX, e.clientY);

    const onMove = ev => {
      const start2 = anchorClientPos(canvas.querySelector(`[data-id="${fromId}"]`), anchor);
      showPreviewLine(start2.x, start2.y, ev.clientX, ev.clientY);
    };
    const onUp = ev => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      hidePreviewLine();
      S.wiring.dragging = false;

      // Find element under cursor
      const els = document.elementsFromPoint(ev.clientX, ev.clientY);
      let toEl = null;
      for (const candidate of els) {
        const cardOrText = candidate.closest('.board-card, .board-text');
        if (cardOrText && cardOrText.dataset.id !== fromId) { toEl = cardOrText; break; }
        if ((candidate.classList.contains('board-card') || candidate.classList.contains('board-text')) && candidate.dataset.id !== fromId) {
          toEl = candidate; break;
        }
      }
      if (toEl) finalizeWire(toEl.dataset.id);
      else {
        // Reset wiring source
        S.wiring.fromId = null;
        if (fromEl) fromEl.classList.remove('connect-source');
        connBannerTx.textContent = 'Hover an element to see anchors — drag an anchor to connect';
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function finalizeWire(toId) {
    const fromId = S.wiring.fromId;
    if (!fromId || fromId === toId) return;
    createConnection(fromId, toId);
    // reset source marker
    const fromEl = canvas.querySelector(`[data-id="${fromId}"]`);
    if (fromEl) fromEl.classList.remove('connect-source');
    S.wiring.fromId = null;
    connBannerTx.textContent = 'Connection created! Hover for more';
  }

  function anchorClientPos(el, anchor) {
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const mid = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    if (anchor === 'top')    return { x: mid.x, y: r.top };
    if (anchor === 'bottom') return { x: mid.x, y: r.bottom };
    if (anchor === 'left')   return { x: r.left, y: mid.y };
    if (anchor === 'right')  return { x: r.right, y: mid.y };
    return mid;
  }

  function showPreviewLine(x1, y1, x2, y2) {
    previewLine.setAttribute('x1', x1);
    previewLine.setAttribute('y1', y1);
    previewLine.setAttribute('x2', x2);
    previewLine.setAttribute('y2', y2);
    previewLine.setAttribute('opacity', '0.8');
    previewLine.setAttribute('stroke', S.activeColor);
  }
  function hidePreviewLine() {
    previewLine.setAttribute('opacity', '0');
  }

  /* ══════════════════════════════════════════════════════════════
     CONTEXT MENU
  ══════════════════════════════════════════════════════════════ */
  canvasCont.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (e.target === canvasCont || e.target === canvas) {
      showCtxMenu(e.clientX, e.clientY);
    }
  });

  function showCtxMenu(x, y) {
    const canConnect = S.selected.length === 2;
    $('#ctx-connect').style.display = canConnect ? '' : 'none';
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top  = y + 'px';
    ctxMenu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', hideCtxMenu, { once: true }), 0);
  }
  function hideCtxMenu() { ctxMenu.classList.add('hidden'); }

  $('#ctx-connect').addEventListener('click', () => {
    hideCtxMenu();
    if (S.selected.length === 2) createConnection(S.selected[0], S.selected[1]);
  });
  $('#ctx-delete').addEventListener('click', () => { hideCtxMenu(); deleteSelected(); });
  $('#ctx-cancel').addEventListener('click', hideCtxMenu);

  /* ══════════════════════════════════════════════════════════════
     LEADER LINE CONNECTION MANAGEMENT
  ══════════════════════════════════════════════════════════════ */
  function createConnection(fromId, toId) {
    // no duplicates
    const dup = S.connections.find(c =>
      (c.fromId === fromId && c.toId === toId) ||
      (c.fromId === toId   && c.toId === fromId));
    if (dup) return;

    const connId = uid();
    const conn = { id: connId, fromId, toId, color: S.activeColor, style: S.lineStyle };
    S.connections.push(conn);
    drawLine(conn);
    reheatSimulation();
    saveCurrentBoard();
  }

  function drawLine(conn) {
    const fromEl = canvas.querySelector(`[data-id="${conn.fromId}"]`);
    const toEl   = canvas.querySelector(`[data-id="${conn.toId}"]`);
    if (!fromEl || !toEl) return;

    // remove existing
    if (S.lineInstances[conn.id]) {
      try { S.lineInstances[conn.id].remove(); } catch {}
      delete S.lineInstances[conn.id];
    }

    const style = conn.style || 'arrow';
    const color = conn.color || '#3B82F6';

    try {
      const opts = {
        color,
        size: 1.8,
        path: 'fluid',
        dropShadow: false,
      };

      if (style === 'dot') {
        opts.startPlug = 'disc';
        opts.endPlug   = 'disc';
        opts.startPlugSize = 1.6;
        opts.endPlugSize   = 1.6;
      } else {
        // arrow: open arrow (no fill polygon)
        opts.startPlug = 'disc';
        opts.endPlug   = 'arrow3';   // arrow3 = open chevron style
        opts.startPlugSize = 1.3;
        opts.endPlugSize   = 2.2;
        opts.startPlugOutline = false;
        opts.endPlugOutline   = false;
      }

      const line = new LeaderLine(fromEl, toEl, opts);
      S.lineInstances[conn.id] = line;
    } catch (err) {
      console.warn('LeaderLine draw error:', err);
    }
  }

  function redrawAllLines() {
    S.connections.forEach(conn => {
      if (S.lineInstances[conn.id]) {
        try { S.lineInstances[conn.id].position(); } catch {}
      }
    });
  }

  function rebuildAllLines() {
    S.connections.forEach(conn => {
      if (S.lineInstances[conn.id]) {
        try { S.lineInstances[conn.id].remove(); } catch {}
        delete S.lineInstances[conn.id];
      }
      drawLine(conn);
    });
  }

  let _lineTimer = null;
  function scheduleLineUpdate() {
    if (_lineTimer) cancelAnimationFrame(_lineTimer);
    _lineTimer = requestAnimationFrame(redrawAllLines);
  }

  function removeConnectionsFor(id) {
    const dead = S.connections.filter(c => c.fromId === id || c.toId === id);
    dead.forEach(c => {
      if (S.lineInstances[c.id]) {
        try { S.lineInstances[c.id].remove(); } catch {}
        delete S.lineInstances[c.id];
      }
    });
    S.connections = S.connections.filter(c => c.fromId !== id && c.toId !== id);
  }

  /* ══════════════════════════════════════════════════════════════
     DELETE
  ══════════════════════════════════════════════════════════════ */
  $('#btn-delete').addEventListener('click', deleteSelected);

  function deleteSelected() {
    const ids = [...S.selected];
    ids.forEach(deleteElement);
    S.selected = [];
    reheatSimulation();
    saveCurrentBoard();
    updateSelectionHint();
  }

  function deleteElement(id) {
    removeConnectionsFor(id);
    canvas.querySelector(`[data-id="${id}"]`)?.remove();
    delete S.elements[id];
  }

  /* ══════════════════════════════════════════════════════════════
     COLOR
  ══════════════════════════════════════════════════════════════ */
  $('#color-picker').addEventListener('input', e => {
    S.activeColor = e.target.value;
    applyColorToSelected(e.target.value);
    $$('.swatch').forEach(s => s.classList.remove('active-swatch'));
  });

  $$('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const c = sw.dataset.color;
      S.activeColor = c;
      $('#color-picker').value = c;
      applyColorToSelected(c);
      $$('.swatch').forEach(s => s.classList.remove('active-swatch'));
      sw.classList.add('active-swatch');
    });
  });

  function applyColorToSelected(color) {
    S.selected.forEach(id => {
      const s = S.elements[id];
      if (!s) return;
      s.color = color;
      const el = canvas.querySelector(`[data-id="${id}"]`);
      if (!el) return;
      if (s.type === 'card') {
        el.querySelector('.card-header').style.background = hexRgba(color, 0.13);
      } else {
        el.style.color = color;
      }
    });
    // colour lines attached to selected
    S.connections.forEach(conn => {
      if (S.selected.includes(conn.fromId) || S.selected.includes(conn.toId)) {
        conn.color = color;
        if (S.lineInstances[conn.id]) {
          try { S.lineInstances[conn.id].color = color; } catch {}
        }
      }
    });
    saveCurrentBoard();
  }

  /* ══════════════════════════════════════════════════════════════
     EXPORT / IMPORT
  ══════════════════════════════════════════════════════════════ */
  const exportMenu = $('#export-menu');
  $('#btn-export').addEventListener('click', e => {
    e.stopPropagation();
    exportMenu.classList.toggle('open');
  });

  $('#export-json').addEventListener('click', () => {
    exportMenu.classList.remove('open');
    exportJSON();
  });
  $('#export-svg').addEventListener('click', () => {
    exportMenu.classList.remove('open');
    exportSVG();
  });
  $('#import-json-btn').addEventListener('click', () => {
    exportMenu.classList.remove('open');
    $('#import-file-input').click();
  });
  $('#import-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        importBoardData(data);
      } catch { alert('Invalid JSON file'); }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  function exportJSON() {
    const data = currentBoardData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${S.boardName || 'board'}.json`);
  }

  function exportSVG() {
    const elements = Object.values(S.elements);
    if (!elements.length) { alert('Nothing to export.'); return; }
    const padding = 40;
    const xs = elements.map(e => e.x), ys = elements.map(e => e.y);
    const x2s = elements.map(e => e.x + (e.w || 200));
    const y2s = elements.map(e => e.y + (e.h || 60));
    const minX = Math.min(...xs) - padding, minY = Math.min(...ys) - padding;
    const maxX = Math.max(...x2s) + padding, maxY = Math.max(...y2s) + padding;
    const W = maxX - minX, H = maxY - minY;

    let svgParts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${minX} ${minY} ${W} ${H}">`];
    svgParts.push(`<rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#111113"/>`);

    elements.forEach(el => {
      if (el.type === 'card') {
        svgParts.push(`<rect x="${el.x}" y="${el.y}" width="${el.w||240}" height="${el.h||160}" rx="10" fill="#1e1e22" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`);
        svgParts.push(`<rect x="${el.x}" y="${el.y}" width="${el.w||240}" height="38" rx="10" fill="${hexRgba(el.color||'#3B82F6',0.18)}"/>`);
        svgParts.push(`<text x="${el.x+36}" y="${el.y+24}" fill="#e4e4ec" font-family="Helvetica Neue,Arial,sans-serif" font-size="12" font-weight="600">${esc(el.title||'')}</text>`);
        svgParts.push(`<text x="${el.x+12}" y="${el.y+60}" fill="#8888a0" font-family="Helvetica Neue,Arial,sans-serif" font-size="11">${esc(el.content||'')}</text>`);
      } else {
        svgParts.push(`<text x="${el.x+8}" y="${el.y+20}" fill="${el.color||'#e4e4ec'}" font-family="Helvetica Neue,Arial,sans-serif" font-size="15">${esc(el.content||'')}</text>`);
      }
    });

    S.connections.forEach(conn => {
      const a = S.elements[conn.fromId], b = S.elements[conn.toId];
      if (!a || !b) return;
      const x1 = a.x + (a.w||240)/2, y1 = a.y + (a.h||160)/2;
      const x2 = b.x + (b.w||240)/2, y2 = b.y + (b.h||160)/2;
      svgParts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${conn.color||'#3B82F6'}" stroke-width="1.8" stroke-linecap="round" opacity="0.85"/>`);
    });

    svgParts.push('</svg>');
    const blob = new Blob([svgParts.join('\n')], { type: 'image/svg+xml' });
    downloadBlob(blob, `${S.boardName||'board'}.svg`);
  }

  function importBoardData(data) {
    // Create as new board or overwrite current
    clearBoard();
    if (data.boardName) S.boardName = data.boardName;
    boardNameEl.textContent = S.boardName;
    if (data.elements) {
      Object.values(data.elements).forEach(el => {
        if (el.type === 'card') spawnCard(0, 0, el);
        if (el.type === 'text') spawnText(0, 0, el);
      });
    }
    if (data.connections) {
      data.connections.forEach(conn => {
        S.connections.push(conn);
        setTimeout(() => drawLine(conn), 120);
      });
    }
    setTimeout(() => { initSimulation(); reheatSimulation(); }, 150);
    saveCurrentBoard();
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  /* ══════════════════════════════════════════════════════════════
     BOARD PERSISTENCE (multi-board)
  ══════════════════════════════════════════════════════════════ */
  function currentBoardData() {
    return {
      id: S.boardId,
      boardName: S.boardName,
      updatedAt: Date.now(),
      elements: S.elements,
      connections: S.connections.map(c => ({ id:c.id, fromId:c.fromId, toId:c.toId, color:c.color, style:c.style })),
    };
  }

  function saveCurrentBoard() {
    if (!S.boardId) return;
    const boards = loadAllBoards();
    boards[S.boardId] = currentBoardData();
    saveAllBoards(boards);
  }

  function loadBoard(boardId) {
    clearBoard();
    const boards = loadAllBoards();
    const data = boards[boardId];
    if (!data) return;

    S.boardId   = boardId;
    S.boardName = data.boardName || 'Untitled Board';
    boardNameEl.textContent = S.boardName;
    setActiveId(boardId);

    if (data.elements) {
      Object.values(data.elements).forEach(el => {
        if (el.type === 'card') spawnCard(0, 0, el);
        if (el.type === 'text') spawnText(0, 0, el);
      });
    }
    if (data.connections) {
      data.connections.forEach(conn => {
        S.connections.push(conn);
        setTimeout(() => drawLine(conn), 100);
      });
    }
    setTimeout(() => { initSimulation(); reheatSimulation(); }, 150);
  }

  function clearBoard() {
    // destroy all lines
    Object.values(S.lineInstances).forEach(l => { try { l.remove(); } catch {} });
    S.lineInstances = {};
    S.connections   = [];
    S.elements      = {};
    S.selected      = [];
    canvas.innerHTML = '';
    if (simulation) { simulation.stop(); simulation = null; }
  }

  function createNewBoard() {
    const id   = uid();
    const name = 'Untitled Board';
    const boards = loadAllBoards();
    boards[id] = { id, boardName: name, updatedAt: Date.now(), elements: {}, connections: [] };
    saveAllBoards(boards);
    return id;
  }

  /* ══════════════════════════════════════════════════════════════
     HOME DASHBOARD
  ══════════════════════════════════════════════════════════════ */
  $('#btn-home').addEventListener('click', openDashboard);
  $('#dash-close').addEventListener('click', closeDashboard);

  function openDashboard() {
    saveCurrentBoard();
    renderDashboard();
    dashboard.classList.remove('hidden');
  }
  function closeDashboard() {
    dashboard.classList.add('hidden');
  }

  function renderDashboard() {
    const boards = loadAllBoards();
    const sorted = Object.values(boards).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    dashGrid.innerHTML = '';

    // New board card (always first)
    const newCard = document.createElement('div');
    newCard.className = 'dash-new-card';
    newCard.innerHTML = `<div class="dash-new-plus">+</div><span>New Board</span>`;
    newCard.addEventListener('click', () => {
      const id = createNewBoard();
      closeDashboard();
      clearBoard();
      S.boardId   = id;
      S.boardName = 'Untitled Board';
      boardNameEl.textContent = S.boardName;
      setActiveId(id);
      initSimulation();
      saveCurrentBoard();
      // welcome card
      setTimeout(() => addWelcomeCard(), 100);
    });
    dashGrid.appendChild(newCard);

    // Existing boards
    sorted.forEach(data => {
      const card = document.createElement('div');
      card.className = 'dash-board-card';
      const isActive = data.id === S.boardId;
      const elemCount = Object.keys(data.elements || {}).length;
      const date = data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : '—';

      // Mini preview
      const previewEl = document.createElement('div');
      previewEl.className = 'dash-card-preview';
      const elems = Object.values(data.elements || {}).slice(0, 5);
      if (elems.length === 0) {
        previewEl.innerHTML = '<span>Empty board</span>';
      } else {
        // Scale elements to fit preview (130×130 viewport)
        const xs = elems.map(e => e.x), ys = elems.map(e => e.y);
        const minX = Math.min(...xs), minY = Math.min(...ys);
        const maxX = Math.max(...elems.map(e => e.x + (e.w||180)));
        const maxY = Math.max(...elems.map(e => e.y + (e.h||120)));
        const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
        const scaleF = Math.min(200/rangeX, 130/rangeY, 0.5);

        elems.forEach(el => {
          const miniEl = document.createElement('div');
          miniEl.className = 'mini-card';
          const px = (el.x - minX) * scaleF + 10;
          const py = (el.y - minY) * scaleF + 5;
          const pw = (el.w||180) * scaleF;
          const ph = (el.h||100) * scaleF;
          miniEl.style.cssText = `left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;`;
          if (el.type === 'card') {
            miniEl.innerHTML = `<div class="mini-card-header" style="background:${el.color||'#3B82F6'}"></div>${esc(el.title||'').slice(0,12)}`;
          } else {
            miniEl.style.background = 'transparent';
            miniEl.style.border = 'none';
            miniEl.style.color = el.color || '#e4e4ec';
            miniEl.textContent = (el.content||'').slice(0, 10);
          }
          previewEl.appendChild(miniEl);
        });
      }

      const infoEl = document.createElement('div');
      infoEl.className = 'dash-card-info';
      infoEl.innerHTML = `
        <div class="dash-card-name">${esc(data.boardName || 'Untitled Board')}</div>
        <div class="dash-card-meta">
          <span>${elemCount} element${elemCount !== 1 ? 's' : ''}</span>
          <span>${date}</span>
        </div>`;

      const delBtn = document.createElement('button');
      delBtn.className = 'dash-delete-btn';
      delBtn.title = 'Delete board';
      delBtn.innerHTML = '✕';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`Delete "${data.boardName || 'Untitled Board'}"?`)) return;
        const allBoards = loadAllBoards();
        delete allBoards[data.id];
        saveAllBoards(allBoards);
        card.remove();
        // If deleting active board, create a new one
        if (data.id === S.boardId) {
          const remaining = Object.keys(allBoards);
          if (remaining.length) loadBoard(remaining[0]);
          else {
            clearBoard();
            const newId = createNewBoard();
            S.boardId = newId; S.boardName = 'Untitled Board';
            boardNameEl.textContent = S.boardName;
            setActiveId(newId);
            initSimulation();
          }
        }
      });

      card.appendChild(previewEl);
      card.appendChild(infoEl);
      card.appendChild(delBtn);
      if (isActive) {
        card.style.borderColor = 'var(--accent)';
        card.style.boxShadow = 'var(--shadow-sm), 0 0 0 2px var(--accent-soft)';
      }

      card.addEventListener('click', () => {
        closeDashboard();
        if (data.id !== S.boardId) {
          saveCurrentBoard();
          loadBoard(data.id);
        }
      });

      dashGrid.appendChild(card);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     BOARD NAME EDITING
  ══════════════════════════════════════════════════════════════ */
  boardNameEl.addEventListener('blur', () => {
    S.boardName = boardNameEl.textContent.trim() || 'Untitled Board';
    boardNameEl.textContent = S.boardName;
    saveCurrentBoard();
  });
  boardNameEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); boardNameEl.blur(); }
  });

  /* ══════════════════════════════════════════════════════════════
     CLOSE DROPDOWNS ON OUTSIDE CLICK
  ══════════════════════════════════════════════════════════════ */
  function closeAllDropdowns() {
    $$('.tool-dropdown.open').forEach(d => d.classList.remove('open'));
  }
  document.addEventListener('click', closeAllDropdowns);

  /* ══════════════════════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════════════════════ */
  function hexRgba(hex, a) {
    if (!hex || hex.length < 7) return `rgba(59,130,246,${a})`;
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }
  function esc(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function addWelcomeCard() {
    const rect = canvasCont.getBoundingClientRect();
    const pos = canvasPoint(rect.width / 2, rect.height / 2);
    const id = uid();
    const data = {
      id, type: 'card',
      x: pos.x - 125, y: pos.y - 90,
      w: 260, h: 190,
      color: '#3B82F6', icon: '🚀',
      title: 'Welcome to Boardflow',
      tags: 'start here',
      content: 'V/C/T/L for tools · Scroll to zoom · Middle-click to pan',
    };
    S.elements[id] = data;
    spawnCard(0, 0, data);
    saveCurrentBoard();
  }

  /* ══════════════════════════════════════════════════════════════
     BOOT
  ══════════════════════════════════════════════════════════════ */
  function boot() {
    // Theme
    const savedTheme = localStorage.getItem('boardflow_theme') || 'dark';
    applyTheme(savedTheme);

    // Panzoom
    initPanzoom();

    // Center view on large canvas
    const rect = canvasCont.getBoundingClientRect();
    S.pz.pan(rect.width / 2 - 3000, rect.height / 2 - 3000, { animate: false });

    // Load or create board
    const boards = loadAllBoards();
    let activeId  = getActiveId();

    if (!activeId || !boards[activeId]) {
      // Check for any existing boards
      const ids = Object.keys(boards);
      if (ids.length) {
        activeId = ids.sort((a,b) => (boards[b].updatedAt||0) - (boards[a].updatedAt||0))[0];
      } else {
        activeId = createNewBoard();
      }
    }

    S.boardId = activeId;
    loadBoard(activeId);

    // If brand new board with no elements, show welcome card
    if (Object.keys(S.elements).length === 0) {
      setTimeout(addWelcomeCard, 150);
    }

    // Continuous line sync (for panzoom)
    setInterval(redrawAllLines, 250);

    updateZoomStatus();
  }

  boot();

})();
