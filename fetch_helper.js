// ==UserScript==
// @name         Neopets Fetch! Helper
// @namespace    GreaseMonkey
// @version      1.1
// @description  Highlights recommended compass direction and displays mini-map for Neopets Fetch! Also supports WASD.
// @author       @willnjohnson
// @match        *://*.neopets.com/games/maze/maze.phtml*
// @grant        none
// @license      MIT
// @downloadURL  https://update.greasyfork.org/scripts/580694/Neopets%20Fetch%21%20Helper.user.js
// @updateURL    https://update.greasyfork.org/scripts/580694/Neopets%20Fetch%21%20Helper.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // USER CONFIGURATION
    // ==========================================
    const CONFIG = {
        UNKNOWN_TILE_COST: 3,    // penalty for stepping into unmapped tiles
        SHOW_MINIMAP: true,      // toggle rendering of the HUD minimap
        SHOW_COMPASS_HINT: true  // toggle magenta compass move recommendations
    };
    // ==========================================

    const NORTH = 1;
    const WEST = 2;
    const SOUTH = 4;
    const EAST = 8;
    const ALL_DIRS = [NORTH, WEST, SOUTH, EAST];

    const STEP = {
        [NORTH]: { dc: 0, dr: -1, moveId: 0 },
        [WEST]: { dc: -1, dr: 0, moveId: 2 },
        [SOUTH]: { dc: 0, dr: 1, moveId: 1 },
        [EAST]: { dc: 1, dr: 0, moveId: 3 },
    };

    const OPPOSITE = {
        [NORTH]: SOUTH, [WEST]: EAST, [SOUTH]: NORTH, [EAST]: WEST,
    };

    const GRID_SIZE = { '1': 10, '2': 15, '3': 20, '4': 25, '5': 30 };

    const TILE_PASSAGES = {
        'path_iso': 0,
        'path_u': NORTH,
        'path_d': SOUTH,
        'path_l': WEST,
        'path_r': EAST,
        'path_lu': NORTH | WEST,
        'path_ud': NORTH | SOUTH,
        'path_ru': NORTH | EAST,
        'path_ld': WEST | SOUTH,
        'path_lr': WEST | EAST,
        'path_rd': SOUTH | EAST,
        'path_t_u': NORTH | WEST | EAST,
        'path_t_l': WEST | NORTH | SOUTH,
        'path_t_d': SOUTH | WEST | EAST,
        'path_t_r': EAST | NORTH | SOUTH,
        'path_x': NORTH | WEST | SOUTH | EAST,
    };

    const COMPASS_REGION = {
        0: { left: 57, top: 0, width: 34, height: 57 },
        1: { left: 64, top: 91, width: 34, height: 58 },
        2: { left: 0, top: 58, width: 64, height: 33 },
        3: { left: 97, top: 56, width: 52, height: 33 },
    };

    const STORAGE_KEY = 'neopets_fetch_state';
    const PREF_KEY = 'neopets_fetch_pref';
    const OVERLAY_ID = 'fetch-helper-highlight';
    const MINIMAP_ID = 'fetch-helper-minimap';
    const CELL_PX = 10;

    const KEY_MAP = {
        'ArrowUp': 0, 'w': 0, 'W': 0,
        'ArrowDown': 1, 's': 1, 'S': 1,
        'ArrowLeft': 2, 'a': 2, 'A': 2,
        'ArrowRight': 3, 'd': 3, 'D': 3,
    };

    function attachKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            const tag = document.activeElement && document.activeElement.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            const moveId = KEY_MAP[e.key];
            if (moveId === undefined) return;

            e.preventDefault();
            const link = document.querySelector(`area[href*="movedir=${moveId}"]`);
            if (link) window.location.href = link.href;
        });
    }

    function helper() {
        const html = document.body.innerHTML;

        if (html.includes('Success! You fetched the item and reached the exit!') ||
            html.includes('Your master is very displeased!')) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }

        const diffLinks = document.querySelectorAll('a[href*="create=1&diff="]');
        if (diffLinks.length > 0) {
            handleDiffPage(diffLinks);
            return;
        }

        const enterBtn = document.querySelector('input[value="Enter the Maze!"]');
        if (enterBtn) {
            initState();
            return;
        }

        if (!/Moves Remaining:\s*<b>(\d+)/.test(html)) return;

        attachKeyboardControls();
        takeTurn(html);
    }

    function handleDiffPage(diffLinks) {
        const prefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');

        diffLinks.forEach(link => {
            const match = link.href.match(/diff=(\d)/);
            if (!match) return;
            const diff = match[1];

            link.addEventListener('click', () => {
                const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
                p.difficulty = diff;
                localStorage.setItem(PREF_KEY, JSON.stringify(p));
            });
        });
    }

    function initState() {
        const params = new URLSearchParams(window.location.search);
        const prefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
        const level = params.get('diff') || prefs.difficulty || '3';
        const size = GRID_SIZE[level] || 20;

        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            grid: {},
            col: 0, row: 0,
            colMin: -size + 1, colMax: size - 1,
            rowMin: -size + 1, rowMax: size - 1,
            gridSize: size,
            itemPos: null,
            exitPos: null,
        }));
    }

    function takeTurn(html) {
        let raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) { initState(); raw = localStorage.getItem(STORAGE_KEY); }

        const state = JSON.parse(raw);

        let tileTable = null;
        for (const t of document.querySelectorAll('table[width="400"]')) {
            if (t.querySelectorAll('td').length === 25) {
                tileTable = t; break;
            }
        }
        if (!tileTable) return;

        const cells = tileTable.querySelectorAll('td');
        const viewport = [];
        for (let i = 0; i < 25; i++) {
            const cell = cells[i];
            const hit = (cell.getAttribute('background') || '').match(/games\/maze\/([^.\/]+)\.gif/i);
            viewport.push({ tileName: hit ? hit[1] : null, cellHTML: cell.innerHTML });
        }

        let posCol = state.col, posRow = state.row;
        for (const [oc, or] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            let ok = true, vi = 0;
            for (let vr = -2; vr <= 2; vr++) {
                for (let vc = -2; vc <= 2; vc++) {
                    const { tileName } = viewport[vi++];
                    const stored = state.grid[`${posCol + oc + vc},${posRow + or + vr}`];
                    const current = tileName !== null ? TILE_PASSAGES[tileName] : undefined;
                    if (stored !== undefined && current !== undefined && stored !== current) ok = false;
                }
            }
            if (ok) { posCol += oc; posRow += or; break; }
        }

        state.col = posCol;
        state.row = posRow;

        let vi = 0;
        for (let vr = -2; vr <= 2; vr++) {
            for (let vc = -2; vc <= 2; vc++) {
                const { tileName, cellHTML } = viewport[vi++];
                const gc = posCol + vc;
                const gr = posRow + vr;
                const passages = (tileName && TILE_PASSAGES[tileName] !== undefined) ? TILE_PASSAGES[tileName] : -1;

                state.grid[`${gc},${gr}`] = passages;

                if (cellHTML.includes('images.neopets.com/games/maze/item_')) {
                    state.itemPos = [gc, gr];
                }

                if (passages === 0) {
                    if (vc === 0) {
                        if (vr < 0) { state.rowMin = Math.max(state.rowMin, posRow + vr + 1); state.rowMax = state.rowMin + state.gridSize - 1; }
                        else if (vr > 0) { state.rowMax = Math.min(state.rowMax, posRow + vr - 1); state.rowMin = state.rowMax - state.gridSize + 1; }
                    }
                    if (vr === 0) {
                        if (vc < 0) { state.colMin = Math.max(state.colMin, posCol + vc + 1); state.colMax = state.colMin + state.gridSize - 1; }
                        else if (vc > 0) { state.colMax = Math.min(state.colMax, posCol + vc - 1); state.colMin = state.colMax - state.gridSize + 1; }
                    }
                    
                    if (state.colMin > state.colMax) { const tmp = state.colMin; state.colMin = state.colMax; state.colMax = tmp; }
                    if (state.rowMin > state.rowMax) { const tmp = state.rowMin; state.rowMin = state.rowMax; state.rowMax = tmp; }
                }

                if (gc >= state.colMin && gc <= state.colMax && gr >= state.rowMin && gr <= state.rowMax) {
                    for (const dir of ALL_DIRS) {
                        const nc = gc + STEP[dir].dc, nr = gr + STEP[dir].dr;
                        const outside = !(nc >= state.colMin && nc <= state.colMax && nr >= state.rowMin && nr <= state.rowMax);
                        if ((passages & dir) && outside) {
                            state.exitPos = [gc, gr];
                        }
                    }
                }
            }
        }

        const targets = computeTargets(state, !html.includes('Searching for:'));

        const margin = 3;
        for (const key of Object.keys(state.grid)) {
            const [gc, gr] = key.split(',').map(Number);
            if (gc < state.colMin - margin || gc > state.colMax + margin ||
                gr < state.rowMin - margin || gr > state.rowMax + margin) {
                delete state.grid[key];
            }
        }

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                localStorage.removeItem(STORAGE_KEY);
                return;
            }
            throw e;
        }

        if (CONFIG.SHOW_MINIMAP) {
            renderMinimap(state, posCol, posRow);
        } else {
            const canvas = document.getElementById(MINIMAP_ID);
            if (canvas) canvas.remove();
        }

        const nextCell = findNextStep(posCol, posRow, targets, state);
        if (!nextCell) return;

        if (CONFIG.SHOW_COMPASS_HINT) {
            const dc = nextCell[0] - posCol, dr = nextCell[1] - posRow;
            let moveId = null;
            for (const dir of ALL_DIRS) {
                if (STEP[dir].dc === dc && STEP[dir].dr === dr) { moveId = STEP[dir].moveId; break; }
            }
            if (moveId !== null) highlightCompass(moveId);
        } else {
            const old = document.getElementById(OVERLAY_ID);
            if (old) old.remove();
        }
    }

    function highlightCompass(moveId) {
        const compass = document.getElementById('thecompass') || document.querySelector('img[usemap="#navmap"]');
        if (!compass) return;

        const old = document.getElementById(OVERLAY_ID);
        if (old) old.remove();

        const region = COMPASS_REGION[moveId];
        if (!region) return;

        const parent = compass.parentElement;
        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = [
            'position:absolute',
            `left:${compass.offsetLeft + region.left}px`,
            `top:${compass.offsetTop + region.top}px`,
            `width:${region.width}px`,
            `height:${region.height}px`,
            'border:3px solid magenta',
            'background:rgba(255,0,255,0.18)',
            'pointer-events:none',
            'box-sizing:border-box',
            'z-index:9999',
        ].join(';');

        parent.appendChild(overlay);
    }

    function renderMinimap(state, posCol, posRow) {
        let canvas = document.getElementById(MINIMAP_ID);
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = MINIMAP_ID;
            canvas.style.cssText = [
                'position:fixed',
                'bottom:16px',
                'right:16px',
                'z-index:99999',
                'border:2px solid #2d3139',
                'border-radius:6px',
                'image-rendering:pixelated',
                'background:#121418',
            ].join(';');
            document.body.appendChild(canvas);
        }

        const rawCols = state.colMax - state.colMin + 1;
        const rawRows = state.rowMax - state.rowMin + 1;
        if (rawCols <= 0 || rawRows <= 0) return;

        const dim = Math.min(rawCols, rawRows);
        canvas.width  = dim * CELL_PX;
        canvas.height = dim * CELL_PX;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#121418';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Determine if specific outer boundaries have been established
        const defaultMinMax = state.gridSize - 1;
        const leftFound   = state.colMin !== -defaultMinMax;
        const rightFound  = state.colMax !== defaultMinMax;
        const topFound    = state.rowMin !== -defaultMinMax;
        const bottomFound = state.rowMax !== defaultMinMax;

        // Dynamic Camera Viewport Window Math
        let renderColMin, renderRowMin;
        const halfDim = Math.floor(dim / 2);

        // Calculate dynamic viewport pinning offset for horizontal axis
        if (leftFound) {
            renderColMin = state.colMin;
        } else if (rightFound) {
            renderColMin = state.colMax - dim + 1;
        } else {
            renderColMin = posCol - halfDim;
        }

        // Calculate dynamic viewport pinning offset for vertical axis
        if (topFound) {
            renderRowMin = state.rowMin;
        } else if (bottomFound) {
            renderRowMin = state.rowMax - dim + 1;
        } else {
            renderRowMin = posRow - halfDim;
        }

        for (const [key, passages] of Object.entries(state.grid)) {
            const [gc, gr] = key.split(',').map(Number);

            if (gc < renderColMin || gc >= renderColMin + dim || gr < renderRowMin || gr >= renderRowMin + dim) {
                continue;
            }

            const px = (gc - renderColMin) * CELL_PX;
            const py = (gr - renderRowMin) * CELL_PX;

            if (passages === 0) {
                ctx.fillStyle = '#1a1d24';
                ctx.fillRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2);
            } else if (passages > 0) {
                const isDeadEnd = (passages & (passages - 1)) === 0;
                ctx.fillStyle = isDeadEnd ? '#3a4454' : '#e2e8f0';

                ctx.fillRect(px + 1, py + 1, CELL_PX - 2, CELL_PX - 2);

                if (passages & NORTH) ctx.fillRect(px + 1, py, CELL_PX - 2, 1);
                if (passages & SOUTH) ctx.fillRect(px + 1, py + CELL_PX - 1, CELL_PX - 2, 1);
                if (passages & WEST)  ctx.fillRect(px, py + 1, 1, CELL_PX - 2);
                if (passages & EAST)  ctx.fillRect(px + CELL_PX - 1, py + 1, 1, CELL_PX - 2);
            }
        }

        if (state.exitPos) {
            const [ec, er] = state.exitPos;
            if (ec >= renderColMin && ec < renderColMin + dim && er >= renderRowMin && er < renderRowMin + dim) {
                ctx.fillStyle = '#ffb703';
                ctx.fillRect((ec - renderColMin) * CELL_PX + 1, (er - renderRowMin) * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2);
            }
        }

        if (state.itemPos) {
            const [ic, ir] = state.itemPos;
            if (ic >= renderColMin && ic < renderColMin + dim && ir >= renderRowMin && ir < renderRowMin + dim) {
                ctx.fillStyle = '#06d6a0';
                ctx.fillRect((ic - renderColMin) * CELL_PX + 1, (ir - renderRowMin) * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2);
            }
        }

        if (posCol >= renderColMin && posCol < renderColMin + dim && posRow >= renderRowMin && posRow < renderRowMin + dim) {
            ctx.fillStyle = '#ef476f';
            ctx.fillRect((posCol - renderColMin) * CELL_PX + 1, (posRow - renderRowMin) * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2);
        }
    }

    function computeTargets(state, hasItem) {
        const targets = [];

        if (hasItem) {
            if (state.exitPos) {
                targets.push(state.exitPos);
            } else {
                const edge = [];
                if (state.colMin === 0) for (let r = state.rowMin; r <= state.rowMax; r++) edge.push([state.colMax, r]);
                if (state.colMax === 0) for (let r = state.rowMin; r <= state.rowMax; r++) edge.push([state.colMin, r]);
                if (state.rowMin === 0) for (let c = state.colMin; c <= state.colMax; c++) edge.push([c, state.rowMax]);
                if (state.rowMax === 0) for (let c = state.colMin; c <= state.colMax; c++) edge.push([c, state.rowMin]);

                for (const [ec, er] of edge) {
                    let viable = false;
                    for (const dir of ALL_DIRS) {
                        const nc = ec + STEP[dir].dc, nr = er + STEP[dir].dr;
                        const outside = !(nc >= state.colMin && nc <= state.colMax && nr >= state.rowMin && nr <= state.rowMax);
                        if (outside && (state.grid[`${ec},${er}`] ?? -1) & dir && (state.grid[`${nc},${nr}`] ?? -1) & OPPOSITE[dir]) {
                            viable = true; break;
                        }
                    }
                    if (viable) targets.push([ec, er]);
                }
            }
        } else {
            if (state.itemPos) {
                targets.push(state.itemPos);
            } else {
                const inset = Math.floor(state.gridSize / 2) - 1;
                for (let c = state.colMin + inset; c <= state.colMax - inset; c++)
                    for (let r = state.rowMin + inset; r <= state.rowMax - inset; r++)
                        if (state.grid[`${c},${r}`] === undefined) targets.push([c, r]);
            }
        }

        return targets;
    }

    function findNextStep(startCol, startRow, targets, state) {
        if (targets.length === 0) return null;

        const open = [{ cost: 0, col: startCol, row: startRow, from: null }];
        const cameFrom = {};
        let goalCell = null;
        let iterations = 0;

        while (open.length > 0) {
            open.sort((a, b) => a.cost - b.cost);
            const { cost, col, row, from } = open.shift();
            const key = `${col},${row}`;
            if (key in cameFrom) continue;

            const inBounds = col >= state.colMin && col <= state.colMax && row >= state.rowMin && row <= state.rowMax;
            if (!(key in state.grid) && !inBounds) continue;

            cameFrom[key] = from ? `${from[0]},${from[1]}` : null;

            if (targets.some(([tc, tr]) => tc === col && tr === row)) { goalCell = [col, row]; break; }

            const passages = state.grid[key] ?? -1;
            const stepCost = passages === -1 ? CONFIG.UNKNOWN_TILE_COST : 1;

            for (const dir of ALL_DIRS) {
                const nc = col + STEP[dir].dc, nr = row + STEP[dir].dr;
                if ((passages & dir) && ((state.grid[`${nc},${nr}`] ?? -1) & OPPOSITE[dir])) {
                    open.push({ cost: cost + stepCost, col: nc, row: nr, from: [col, row] });
                }
            }

            if (++iterations > 15000) break;
        }

        if (!goalCell) return null;

        let currentKey = `${goalCell[0]},${goalCell[1]}`;
        let previous = goalCell;
        const startKey = `${startCol},${startRow}`;

        while (currentKey && currentKey !== startKey) {
            const prevStr = cameFrom[currentKey];
            if (!prevStr) break;
            previous = currentKey.split(',').map(Number);
            currentKey = prevStr;
        }
        return previous;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', helper);
    } else {
        helper();
    }
})();
