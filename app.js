/* ═══════════════════════════════════════════════════════════
   Boardflow — app.js
   Infinite whiteboard with cards, text, connections
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Helpers ── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ── State ── */
  const state = {
    elements: {},   // id → { type, x, y, w, h, color, content, tags, title }
    connections: [], // [{ id, fromId, toId }]
    mode: 'select', // select | card | text | line
    selected: [],   // selected element ids
    lineInstances: {}, // connId → LeaderLine instance
    connectStep: 0, // 0=none, 1=first, 2=done
    connectFirst: null,
    panzoom: null,
    activeColor: '#4F7FFF',
  };

  /* ── DOM refs ── */
  const canvasContainer = $('#canvas-container');
  const canvas = $('#canvas');
  const colorPicker = $('#color-picker');
  const statusMode = $('#status-mode');
  const statusZoom = $('#status-zoom');
  const statusHint = $('#status-hint');
  const contextMenu = $('#context-menu');
  const connectionOverlay = $('#connection-overlay');
  const connectionBanner = $('.connection-banner');

  /* ════════════════════════════════════
     PANZOOM SETUP
  ════════════════════════════════════ */
  function initPanzoom() {
    const pz = window.Panzoom(canvas, {
      maxScale: 3,
      minScale: 0.2,
      step: 0.08,
      canvas: true,
      contain: false,
      excludeClass: 'no-pan',
    });
    state.panzoom = pz;

    // Wheel zoom
    canvasContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      pz.zoomWithWheel(e);
      updateZoomStatus();
      scheduleLineUpdate();
    }, { passive: false });

    // Middle-click / Space+drag panning
    let spaceDown = false;
    let midDrag = false;
    let midStart = null;
    let panStartXY = null;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.target.isContentEditable && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        spaceDown = true;
        canvasContainer.style.cursor = 'grab';
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        spaceDown = false;
        canvasContainer.style.cursor = '';
      }
    });

    canvasContainer.addEventListener('mousedown', (e) => {
      if (e.button === 1 || spaceDown) {
        e.preventDefault();
        midDrag = true;
        midStart = { x: e.clientX, y: e.clientY };
        panStartXY = { x: pz.getPan().x, y: pz.getPan().y };
        canvasContainer.classList.add('panning');
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!midDrag || !midStart) return;
      const dx = e.clientX - midStart.x;
      const dy = e.clientY - midStart.y;
      pz.pan(panStartXY.x + dx, panStartXY.y + dy);
      scheduleLineUpdate();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 1 || midDrag) {
        midDrag = false;
        midStart = null;
        panStartXY = null;
        canvasContainer.classList.remove('panning');
      }
    });

    pz.zoom(1, { animate: false });
    updateZoomStatus();
  }

  function updateZoomStatus() {
    if (!state.panzoom) return;
    const s = state.panzoom.getScale();
    statusZoom.textContent = Math.round(s * 100) + '%';
  }

  /* ════════════════════════════════════
     CANVAS CLICK → spawn element
  ════════════════════════════════════ */
  canvasContainer.addEventListener('click', (e) => {
    if (e.target !== canvasContainer && e.target !== canvas) return;
    if (state.mode === 'select') {
      clearSelection();
      return;
    }
    if (state.mode === 'line') return; // handled by connection mode
    const pos = canvasPoint(e.clientX, e.clientY);
    if (state.mode === 'card') spawnCard(pos.x, pos.y);
    if (state.mode === 'text') spawnText(pos.x, pos.y);
    setMode('select');
  });

  function canvasPoint(clientX, clientY) {
    const pz = state.panzoom;
    const scale = pz.getScale();
    const pan = pz.getPan();
    const rect = canvasContainer.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / scale,
      y: (clientY - rect.top - pan.y) / scale,
    };
  }

  /* ════════════════════════════════════
     MODE MANAGEMENT
  ════════════════════════════════════ */
  function setMode(mode) {
    state.mode = mode;
    $$('.tool-btn').forEach(b => b.classList.remove('active'));
    const btn = $(`[data-mode="${mode}"]`);
    if (btn) btn.classList.add('active');

    const modeLabels = {
      select: '● Select',
      card: '◆ Card',
      text: '◎ Text',
      line: '⟜ Connect',
    };
    statusMode.textContent = modeLabels[mode] || '● Select';

    if (mode === 'line') {
      startConnectionMode();
    } else {
      canvasContainer.classList.remove('connect-mode');
    }
  }

  $('#btn-select').addEventListener('click', () => setMode('select'));
  $('#btn-card').addEventListener('click', () => {
    setMode('card');
    statusHint.textContent = 'Click on canvas to place card';
  });
  $('#btn-text').addEventListener('click', () => {
    setMode('text');
    statusHint.textContent = 'Click on canvas to place text';
  });
  $('#btn-line').addEventListener('click', () => setMode('line'));

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
    if (e.key === 'v' || e.key === 'V') setMode('select');
    if (e.key === 'c' || e.key === 'C') { setMode('card'); statusHint.textContent = 'Click on canvas to place card'; }
    if (e.key === 't' || e.key === 'T') { setMode('text'); statusHint.textContent = 'Click on canvas to place text'; }
    if (e.key === 'l' || e.key === 'L') setMode('line');
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    if (e.key === 'Escape') {
      clearSelection();
      setMode('select');
      cancelConnectionMode();
      hideContextMenu();
    }
  });

  /* ════════════════════════════════════
     SPAWN CARD
  ════════════════════════════════════ */
  function spawnCard(x, y, data = null) {
    const id = data?.id || uid();
    const elData = data || {
      id, type: 'card',
      x: x - 110, y: y - 70,
      w: 240, h: 160,
      color: state.activeColor,
      title: '',
      tags: '',
      content: '',
    };
    if (!data) state.elements[id] = elData;

    const el = document.createElement('div');
    el.className = 'board-card no-pan';
    el.dataset.id = id;
    el.style.cssText = `left:${elData.x}px;top:${elData.y}px;width:${elData.w}px;height:${elData.h}px;`;

    el.innerHTML = `
      <div class="card-header" style="background:${colorToHeaderBg(elData.color)}">
        <div class="card-header-dot" style="background:${elData.color}"></div>
        <div class="card-title" contenteditable="true" spellcheck="false">${escHtml(elData.title)}</div>
      </div>
      <div class="card-tags">
        <span class="card-tag" contenteditable="true" spellcheck="false">${escHtml(elData.tags)}</span>
      </div>
      <div class="card-body no-pan" contenteditable="true" spellcheck="false">${escHtml(elData.content)}</div>
      <div class="resize-handle" data-resize="true"></div>
    `;

    canvas.appendChild(el);
    setupCardInteract(el);
    setupCardEvents(el);

    // Inline editing: don't select element on content click
    el.querySelectorAll('[contenteditable]').forEach(ed => {
      ed.addEventListener('mousedown', e => e.stopPropagation());
      ed.addEventListener('click', e => e.stopPropagation());
      ed.addEventListener('input', () => saveElementContent(id));
      ed.addEventListener('blur', () => saveElementContent(id));
    });

    return el;
  }

  function colorToHeaderBg(color) {
    return hexToRgba(color, 0.12);
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function saveElementContent(id) {
    const el = canvas.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    const s = state.elements[id];
    if (!s) return;
    if (s.type === 'card') {
      s.title = el.querySelector('.card-title')?.innerText || '';
      s.tags = el.querySelector('.card-tag')?.innerText || '';
      s.content = el.querySelector('.card-body')?.innerText || '';
    } else if (s.type === 'text') {
      s.content = el.innerText || '';
    }
    saveState();
  }

  /* ════════════════════════════════════
     SPAWN TEXT
  ════════════════════════════════════ */
  function spawnText(x, y, data = null) {
    const id = data?.id || uid();
    const elData = data || {
      id, type: 'text',
      x: x - 60, y: y - 15,
      w: 200, h: 40,
      color: state.activeColor,
      content: '',
    };
    if (!data) state.elements[id] = elData;

    const el = document.createElement('div');
    el.className = 'board-text no-pan';
    el.dataset.id = id;
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.style.cssText = `left:${elData.x}px;top:${elData.y}px;min-width:${elData.w}px;color:${elData.color};`;
    el.innerText = elData.content;

    canvas.appendChild(el);
    setupTextInteract(el);
    setupTextEvents(el);

    el.addEventListener('mousedown', e => e.stopPropagation());
    el.addEventListener('click', e => e.stopPropagation());
    el.addEventListener('input', () => saveElementContent(id));
    el.addEventListener('blur', () => saveElementContent(id));

    if (!data) {
      setTimeout(() => { el.focus(); }, 50);
    }
    return el;
  }

  /* ════════════════════════════════════
     INTERACT.JS — DRAG & RESIZE
  ════════════════════════════════════ */
  function setupCardInteract(el) {
    const id = el.dataset.id;

    interact(el)
      .draggable({
        ignoreFrom: '[contenteditable], .resize-handle',
        listeners: {
          start() { el.classList.add('dragging'); bringToFront(el); },
          move(e) {
            const s = state.elements[id];
            if (!s) return;
            const scale = state.panzoom.getScale();
            s.x += e.dx / scale;
            s.y += e.dy / scale;
            el.style.left = s.x + 'px';
            el.style.top = s.y + 'px';
            scheduleLineUpdate();
          },
          end() {
            el.classList.remove('dragging');
            saveState();
            scheduleLineUpdate();
          },
        },
      })
      .resizable({
        edges: { right: true, bottom: true, bottomRight: '.resize-handle' },
        listeners: {
          move(e) {
            const s = state.elements[id];
            if (!s) return;
            s.w = Math.max(180, e.rect.width);
            s.h = Math.max(100, e.rect.height);
            el.style.width = s.w + 'px';
            el.style.height = s.h + 'px';
            scheduleLineUpdate();
          },
          end() { saveState(); },
        },
        modifiers: [interact.modifiers.restrictSize({ min: { width: 180, height: 100 } })],
      });
  }

  function setupTextInteract(el) {
    const id = el.dataset.id;

    interact(el)
      .draggable({
        ignoreFrom: '[contenteditable]',
        listeners: {
          start() { el.classList.add('dragging'); bringToFront(el); },
          move(e) {
            const s = state.elements[id];
            if (!s) return;
            const scale = state.panzoom.getScale();
            s.x += e.dx / scale;
            s.y += e.dy / scale;
            el.style.left = s.x + 'px';
            el.style.top = s.y + 'px';
            scheduleLineUpdate();
          },
          end() {
            el.classList.remove('dragging');
            saveState();
          },
        },
      });
  }

  /* ════════════════════════════════════
     SELECTION
  ════════════════════════════════════ */
  function setupCardEvents(el) {
    el.addEventListener('mousedown', (e) => {
      if (e.target.isContentEditable || e.target.dataset.resize) return;
      handleElementClick(el, e);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!state.selected.includes(el.dataset.id)) {
        handleElementClick(el, { shiftKey: false });
      }
      showContextMenu(e.clientX, e.clientY);
    });
  }

  function setupTextEvents(el) {
    el.addEventListener('mousedown', (e) => {
      handleElementClick(el, e);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!state.selected.includes(el.dataset.id)) {
        handleElementClick(el, { shiftKey: false });
      }
      showContextMenu(e.clientX, e.clientY);
    });
  }

  function handleElementClick(el, e) {
    const id = el.dataset.id;

    if (state.mode === 'line') {
      handleConnectionClick(id);
      return;
    }

    if (e.shiftKey) {
      // Multi-select
      if (state.selected.includes(id)) {
        state.selected = state.selected.filter(s => s !== id);
        el.classList.remove('selected');
      } else {
        if (state.selected.length < 2) {
          state.selected.push(id);
          el.classList.add('selected');
        }
      }
    } else {
      // Single select
      clearSelection();
      state.selected = [id];
      el.classList.add('selected');
    }

    updateSelectionHint();
  }

  function clearSelection() {
    state.selected = [];
    $$('.board-card.selected, .board-text.selected').forEach(el => el.classList.remove('selected'));
    updateSelectionHint();
  }

  function updateSelectionHint() {
    const n = state.selected.length;
    if (n === 0) statusHint.textContent = 'Shift+click to multi-select · Right-click to connect';
    else if (n === 1) statusHint.textContent = 'Shift+click another to multi-select · Right-click for options';
    else if (n === 2) statusHint.textContent = '2 selected — Right-click to connect';
  }

  function bringToFront(el) {
    const all = $$('.board-card, .board-text');
    const maxZ = all.reduce((m, e) => Math.max(m, parseInt(e.style.zIndex || 0)), 0);
    el.style.zIndex = maxZ + 1;
  }

  /* ════════════════════════════════════
     CONTEXT MENU
  ════════════════════════════════════ */
  canvasContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (e.target === canvasContainer || e.target === canvas) {
      showContextMenu(e.clientX, e.clientY);
    }
  });

  function showContextMenu(x, y) {
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.remove('hidden');

    const canConnect = state.selected.length === 2;
    $('#ctx-connect').style.display = canConnect ? '' : 'none';

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', hideContextMenu, { once: true });
    }, 0);
  }

  function hideContextMenu() {
    contextMenu.classList.add('hidden');
  }

  $('#ctx-connect').addEventListener('click', () => {
    hideContextMenu();
    if (state.selected.length === 2) {
      createConnection(state.selected[0], state.selected[1]);
    }
  });

  $('#ctx-delete').addEventListener('click', () => {
    hideContextMenu();
    deleteSelected();
  });

  $('#ctx-cancel').addEventListener('click', () => {
    hideContextMenu();
  });

  /* ════════════════════════════════════
     CONNECTION MODE (Line button)
  ════════════════════════════════════ */
  function startConnectionMode() {
    state.connectStep = 1;
    state.connectFirst = null;
    canvasContainer.classList.add('connect-mode');
    connectionOverlay.classList.remove('hidden');
    connectionBanner.textContent = '';
    connectionBanner.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="3" cy="3" r="2" fill="currentColor" opacity="0.7"/>
        <circle cx="13" cy="13" r="2" fill="currentColor" opacity="0.7"/>
        <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>
      </svg>
      Connection Mode — click first element
      <button id="cancel-connect-mode">✕ Cancel</button>
    `;
    $('#cancel-connect-mode').addEventListener('click', cancelConnectionMode);
  }

  function cancelConnectionMode() {
    state.connectStep = 0;
    state.connectFirst = null;
    canvasContainer.classList.remove('connect-mode');
    connectionOverlay.classList.add('hidden');
    $$('.connect-source').forEach(el => el.classList.remove('connect-source'));
    if (state.mode === 'line') setMode('select');
  }

  function handleConnectionClick(id) {
    if (state.connectStep === 1) {
      state.connectFirst = id;
      state.connectStep = 2;
      const el = canvas.querySelector(`[data-id="${id}"]`);
      if (el) el.classList.add('connect-source');
      connectionBanner.classList.add('second-click');
      connectionBanner.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="3" cy="3" r="2" fill="currentColor" opacity="0.7"/>
          <circle cx="13" cy="13" r="2" fill="currentColor" opacity="0.7"/>
          <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>
        </svg>
        Now click the second element
        <button id="cancel-connect-mode">✕ Cancel</button>
      `;
      $('#cancel-connect-mode').addEventListener('click', cancelConnectionMode);
    } else if (state.connectStep === 2 && id !== state.connectFirst) {
      createConnection(state.connectFirst, id);
      cancelConnectionMode();
    }
  }

  /* ════════════════════════════════════
     LEADER LINE CONNECTIONS
  ════════════════════════════════════ */
  function createConnection(fromId, toId) {
    // Avoid duplicate
    const exists = state.connections.find(
      c => (c.fromId === fromId && c.toId === toId) || (c.fromId === toId && c.toId === fromId)
    );
    if (exists) return;

    const connId = uid();
    state.connections.push({ id: connId, fromId, toId, color: state.activeColor });
    drawLine(connId, fromId, toId, state.activeColor);
    saveState();
  }

  function drawLine(connId, fromId, toId, color) {
    const fromEl = canvas.querySelector(`[data-id="${fromId}"]`);
    const toEl = canvas.querySelector(`[data-id="${toId}"]`);
    if (!fromEl || !toEl) return;

    // Remove existing if any
    if (state.lineInstances[connId]) {
      try { state.lineInstances[connId].remove(); } catch(e) {}
      delete state.lineInstances[connId];
    }

    try {
      const line = new LeaderLine(fromEl, toEl, {
        color: color || '#4F7FFF',
        size: 2,
        path: 'fluid',
        startPlug: 'disc',
        endPlug: 'arrow2',
        startPlugSize: 1.5,
        endPlugSize: 1.8,
        gradient: false,
        dropShadow: { dx: 0, dy: 1, blur: 4, color: 'rgba(0,0,0,0.3)' },
      });
      state.lineInstances[connId] = line;
    } catch (e) {
      console.warn('LeaderLine error:', e);
    }
  }

  function redrawAllLines() {
    state.connections.forEach(conn => {
      if (state.lineInstances[conn.id]) {
        try { state.lineInstances[conn.id].position(); } catch(e) {}
      }
    });
  }

  let lineUpdateTimer = null;
  function scheduleLineUpdate() {
    if (lineUpdateTimer) cancelAnimationFrame(lineUpdateTimer);
    lineUpdateTimer = requestAnimationFrame(redrawAllLines);
  }

  function removeConnectionsForElement(id) {
    const toRemove = state.connections.filter(c => c.fromId === id || c.toId === id);
    toRemove.forEach(conn => {
      if (state.lineInstances[conn.id]) {
        try { state.lineInstances[conn.id].remove(); } catch(e) {}
        delete state.lineInstances[conn.id];
      }
    });
    state.connections = state.connections.filter(c => c.fromId !== id && c.toId !== id);
  }

  /* ════════════════════════════════════
     DELETE
  ════════════════════════════════════ */
  $('#btn-delete').addEventListener('click', deleteSelected);

  function deleteSelected() {
    state.selected.forEach(id => deleteElement(id));
    state.selected = [];
    saveState();
    updateSelectionHint();
  }

  function deleteElement(id) {
    removeConnectionsForElement(id);
    const el = canvas.querySelector(`[data-id="${id}"]`);
    if (el) el.remove();
    delete state.elements[id];
  }

  $('#btn-clear').addEventListener('click', () => {
    if (!confirm('Clear the entire board? This cannot be undone.')) return;
    // Remove all lines
    Object.values(state.lineInstances).forEach(line => {
      try { line.remove(); } catch(e) {}
    });
    state.lineInstances = {};
    state.connections = [];
    state.elements = {};
    state.selected = [];
    canvas.innerHTML = '';
    saveState();
  });

  /* ════════════════════════════════════
     COLOR
  ════════════════════════════════════ */
  colorPicker.addEventListener('input', (e) => {
    state.activeColor = e.target.value;
    applyColorToSelected(e.target.value);
    clearSwatchActive();
  });

  $$('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const color = sw.dataset.color;
      state.activeColor = color;
      colorPicker.value = color;
      applyColorToSelected(color);
      clearSwatchActive();
      sw.classList.add('active-swatch');
    });
  });

  function clearSwatchActive() {
    $$('.swatch').forEach(s => s.classList.remove('active-swatch'));
  }

  function applyColorToSelected(color) {
    state.selected.forEach(id => {
      const s = state.elements[id];
      if (!s) return;
      s.color = color;

      if (s.type === 'card') {
        const el = canvas.querySelector(`[data-id="${id}"]`);
        if (el) {
          el.querySelector('.card-header').style.background = colorToHeaderBg(color);
          el.querySelector('.card-header-dot').style.background = color;
        }
      } else if (s.type === 'text') {
        const el = canvas.querySelector(`[data-id="${id}"]`);
        if (el) el.style.color = color;
      }
    });

    // Also color selected connections
    state.connections.forEach(conn => {
      if (state.selected.includes(conn.fromId) || state.selected.includes(conn.toId)) {
        conn.color = color;
        if (state.lineInstances[conn.id]) {
          try { state.lineInstances[conn.id].color = color; } catch(e) {}
        }
      }
    });

    saveState();
  }

  /* ════════════════════════════════════
     PERSISTENCE (localStorage)
  ════════════════════════════════════ */
  const STORAGE_KEY = 'boardflow_v2';

  function saveState() {
    const data = {
      elements: state.elements,
      connections: state.connections.map(c => ({ id: c.id, fromId: c.fromId, toId: c.toId, color: c.color })),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) {
      console.warn('localStorage save failed:', e);
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);

      if (data.elements) {
        Object.entries(data.elements).forEach(([id, el]) => {
          state.elements[id] = el;
          if (el.type === 'card') spawnCard(0, 0, el);
          if (el.type === 'text') spawnText(0, 0, el);
        });
      }

      if (data.connections) {
        data.connections.forEach(conn => {
          state.connections.push(conn);
          setTimeout(() => drawLine(conn.id, conn.fromId, conn.toId, conn.color), 100);
        });
      }
    } catch(e) {
      console.warn('localStorage load failed:', e);
    }
  }

  /* ════════════════════════════════════
     BOOT
  ════════════════════════════════════ */
  function boot() {
    initPanzoom();
    loadState();
    setMode('select');

    // Center the panzoom view on initial canvas midpoint
    const pz = state.panzoom;
    const rect = canvasContainer.getBoundingClientRect();
    pz.pan(rect.width / 2 - 2000, rect.height / 2 - 2000, { animate: false });

    // If empty, show a welcome card
    if (Object.keys(state.elements).length === 0) {
      setTimeout(() => {
        const cx = 2000;
        const cy = 2000;
        const welcomeId = uid();
        const s = {
          id: welcomeId,
          type: 'card',
          x: cx - 130,
          y: cy - 90,
          w: 280,
          h: 200,
          color: '#4F7FFF',
          title: 'Welcome to Boardflow',
          tags: 'start here',
          content: 'Drag to move · Scroll to zoom · V/C/T/L for tools',
        };
        state.elements[welcomeId] = s;
        spawnCard(0, 0, s);
        saveState();
      }, 200);
    }

    // Continuous line update during any animation
    setInterval(redrawAllLines, 200);
  }

  boot();

})();
