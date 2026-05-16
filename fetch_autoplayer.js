// ==UserScript==
// @name         Neopets Fetch! Autoplayer
// @namespace    GreaseMonkey
// @version      1.0
// @description  Autoplayer for Neopets Fetch!
// @author       @willnjohnson
// @match        *://*.neopets.com/games/maze/maze.phtml*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // USER CONFIGURATION (MODIFY TO YOUR DIFFICULTY)
    // ==========================================
    const CONFIG = {
        // Difficulty (1: Easy, 2: Medium, 3: Hard, 4: Fiendish, 5: Insane)
        DIFFICULTY: '4', // CHANGE HERE

        // Navigation delays (ms)
        MOVE_DELAY_MIN: 1000,     // min delay before next move
        MOVE_DELAY_RANDOM: 800,   // random variance added to min delay

        // Game state delays (ms)
        RESTART_DELAY: 2000,      // delay before restarting after win/loss
        START_GAME_DELAY: 1000,   // delay before clicking "Enter the Maze!"
        IDLE_NEW_GAME_DELAY: 1000,// delay before creating new game when idle

        // Pathfinding
        UNKNOWN_TILE_COST: 3      // penalty for stepping into unmapped tiles
    };
    // ==========================================

    // Cardinal direction bitmasks
    const NORTH = 1;
    const WEST = 2;
    const SOUTH = 4;
    const EAST = 8;
    const ALL_DIRS = [NORTH, WEST, SOUTH, EAST];

    // Per-direction: col/row delta and movedir URL id
    const STEP = {
        [NORTH]: { dc: 0, dr: -1, moveId: 0 },
        [WEST]:  { dc: -1, dr: 0, moveId: 2 },
        [SOUTH]: { dc: 0, dr: 1,  moveId: 1 },
        [EAST]:  { dc: 1, dr: 0,  moveId: 3 },
    };

    const OPPOSITE = {
        [NORTH]: SOUTH, [WEST]: EAST, [SOUTH]: NORTH, [EAST]: WEST,
    };

    // Grid width/height per difficulty level
    const GRID_SIZE = { '1': 10, '2': 15, '3': 20, '4': 25, '5': 30 };

    // Tile image name -> open-passage bitmask
    const TILE_PASSAGES = {
        'path_iso': 0,
        'path_u':   NORTH,
        'path_d':   SOUTH,
        'path_l':   WEST,
        'path_r':   EAST,
        'path_lu':  NORTH | WEST,
        'path_ud':  NORTH | SOUTH,
        'path_ru':  NORTH | EAST,
        'path_ld':  WEST  | SOUTH,
        'path_lr':  WEST  | EAST,
        'path_rd':  SOUTH | EAST,
        'path_t_u': NORTH | WEST  | EAST,
        'path_t_l': WEST  | NORTH | SOUTH,
        'path_t_d': SOUTH | WEST  | EAST,
        'path_t_r': EAST  | NORTH | SOUTH,
        'path_x':   NORTH | WEST  | SOUTH | EAST,
    };

    const STORAGE_KEY = 'neopets_fetch_state';
    const MINIMAP_ID  = 'fetch-helper-minimap';
    const CELL_PX     = 10;

    function autoplay() {
        const html = document.body.innerHTML;

        if (html.includes('Success! You fetched the item and reached the exit!')) {
            localStorage.removeItem(STORAGE_KEY);
            setTimeout(() => { window.location.href = 'maze.phtml?deletegame=1'; }, CONFIG.RESTART_DELAY);
            return;
        }

        if (html.includes('Your master is very displeased!')) {
            localStorage.removeItem(STORAGE_KEY);
            setTimeout(() => { window.location.href = 'maze.phtml?deletegame=1'; }, CONFIG.RESTART_DELAY);
            return;
        }

        const enterBtn = document.querySelector('input[value="Enter the Maze!"]');
        if (enterBtn) { beginNewGame(enterBtn); return; }

        if (!/Moves Remaining:\s*<b>(\d+)/.test(html)) { handleIdleState(); return; }

        takeTurn(html);
    }

    function beginNewGame(enterBtn) {
        const params = new URLSearchParams(window.location.search);
        const level = params.get('diff') || CONFIG.DIFFICULTY;
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

        setTimeout(() => enterBtn.click(), CONFIG.START_GAME_DELAY);
    }

    function handleIdleState() {
        const href = window.location.href;
        if (href.includes('deletegame=1') || (!href.includes('create=1') && !href.includes('action='))) {
            setTimeout(() => {
                window.location.href = `maze.phtml?create=1&diff=${CONFIG.DIFFICULTY}`;
            }, CONFIG.IDLE_NEW_GAME_DELAY);
        }
    }

    function takeTurn(html) {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            setTimeout(() => { window.location.href = 'maze.phtml?deletegame=1'; }, CONFIG.RESTART_DELAY);
            return;
        }

        const state = JSON.parse(raw);

        // Find 5x5 tile table
        let tileTable = null;
        for (const t of document.querySelectorAll('table[width="400"]')) {
            if (t.querySelectorAll('td[background*="games/maze"]').length === 25) {
                tileTable = t; break;
            }
        }
        if (!tileTable) return;

        // Read 25 viewport tiles
        const cells = tileTable.querySelectorAll('td');
        const viewport = [];
        for (let i = 0; i < 25; i++) {
            const cell = cells[i];
            const hit = (cell.getAttribute('background') || '').match(/games\/maze\/([^.\/]+)\.gif/i);
            viewport.push({ tileName: hit ? hit[1] : null, cellHTML: cell.innerHTML });
        }

        // Align position against stored map using small candidate offsets
        let posCol = state.col, posRow = state.row, aligned = false;
        for (const [oc, or] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            let ok = true, vi = 0;
            for (let vr = -2; vr <= 2; vr++) {
                for (let vc = -2; vc <= 2; vc++) {
                    const { tileName } = viewport[vi++];
                    const stored  = state.grid[`${posCol + oc + vc},${posRow + or + vr}`];
                    const current = tileName !== null ? TILE_PASSAGES[tileName] : undefined;
                    if (stored !== undefined && current !== undefined && stored !== current) ok = false;
                }
            }
            if (ok) { posCol += oc; posRow += or; aligned = true; break; }
        }

        state.col = posCol;
        state.row = posRow;

        // Ingest viewport into map
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

                // Void tiles tighten known boundary
                if (passages === 0) {
                    if (vc === 0) {
                        if (vr < 0) { state.rowMin = Math.max(state.rowMin, posRow + vr + 1); state.rowMax = state.rowMin + state.gridSize - 1; }
                        else if (vr > 0) { state.rowMax = Math.min(state.rowMax, posRow + vr - 1); state.rowMin = state.rowMax - state.gridSize + 1; }
                    }
                    if (vr === 0) {
                        if (vc < 0) { state.colMin = Math.max(state.colMin, posCol + vc + 1); state.colMax = state.colMin + state.gridSize - 1; }
                        else if (vc > 0) { state.colMax = Math.min(state.colMax, posCol + vc - 1); state.colMin = state.colMax - state.gridSize + 1; }
                    }
                }

                // Passage leading out of bounds marks exit tile
                if (gc >= state.colMin && gc <= state.colMax && gr >= state.rowMin && gr <= state.rowMax) {
                    for (const dir of ALL_DIRS) {
                        const nc = gc + STEP[dir].dc, nr = gr + STEP[dir].dr;
                        if ((passages & dir) && !(nc >= state.colMin && nc <= state.colMax && nr >= state.rowMin && nr <= state.rowMax)) {
                            state.exitPos = [gc, gr];
                        }
                    }
                }
            }
        }

        const targets = computeTargets(state, !html.includes('Searching for:'));

        // Prune drifted cells outside bounds to prevent storage growth
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
                setTimeout(() => { window.location.href = 'maze.phtml?deletegame=1'; }, CONFIG.RESTART_DELAY);
                return;
            }
            throw e;
        }

        const nextCell = findNextStep(posCol, posRow, targets, state);

        renderMinimap(state, posCol, posRow);

        if (!nextCell) return;

        const dc = nextCell[0] - posCol, dr = nextCell[1] - posRow;
        let moveId = null;
        for (const dir of ALL_DIRS) {
            if (STEP[dir].dc === dc && STEP[dir].dr === dr) { moveId = STEP[dir].moveId; break; }
        }

        if (moveId !== null) {
            const link = document.querySelector(`area[href*="movedir=${moveId}"]`);
            if (link) setTimeout(() => { window.location.href = link.href; },
                CONFIG.MOVE_DELAY_MIN + Math.random() * CONFIG.MOVE_DELAY_RANDOM);
        }
    }

    function renderMinimap(state, posCol, posRow) {
        let canvas = document.getElementById(MINIMAP_ID);
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = MINIMAP_ID;
            canvas.style.cssText = [
                'position:fixed',
                'bottom:10px',
                'right:10px',
                'z-index:99999',
                'border:2px solid #444',
                'image-rendering:pixelated',
                'background:#000',
            ].join(';');
            document.body.appendChild(canvas);
        }

        const cols = state.colMax - state.colMin + 1;
        const rows = state.rowMax - state.rowMin + 1;
        canvas.width  = cols * CELL_PX;
        canvas.height = rows * CELL_PX;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (const [key, passages] of Object.entries(state.grid)) {
            const [gc, gr] = key.split(',').map(Number);
            const px = (gc - state.colMin) * CELL_PX;
            const py = (gr - state.rowMin) * CELL_PX;

            if (passages === 0) {
                ctx.fillStyle = '#1e1e1e';
                ctx.fillRect(px, py, CELL_PX, CELL_PX);
            } else if (passages > 0) {
                const isDeadEnd = (passages & (passages - 1)) === 0;
                ctx.fillStyle = isDeadEnd ? '#888888' : '#d0d0d0';
                ctx.fillRect(px + 1, py + 1, CELL_PX - 1, CELL_PX - 1);
                if (passages & NORTH) { ctx.fillRect(px + 1, py,      CELL_PX - 1, 1); }
                if (passages & WEST)  { ctx.fillRect(px,     py + 1,  1, CELL_PX - 1); }
            }
        }

        if (state.exitPos) {
            const [ec, er] = state.exitPos;
            ctx.fillStyle = '#ffee00';
            ctx.fillRect((ec - state.colMin) * CELL_PX + 1, (er - state.rowMin) * CELL_PX + 1, CELL_PX - 1, CELL_PX - 1);
        }

        if (state.itemPos) {
            const [ic, ir] = state.itemPos;
            ctx.fillStyle = '#00e060';
            ctx.fillRect((ic - state.colMin) * CELL_PX + 1, (ir - state.rowMin) * CELL_PX + 1, CELL_PX - 1, CELL_PX - 1);
        }

        // Player: red
        ctx.fillStyle = '#ff3333';
        ctx.fillRect((posCol - state.colMin) * CELL_PX + 1, (posRow - state.rowMin) * CELL_PX + 1, CELL_PX - 1, CELL_PX - 1);
    }

    function computeTargets(state, hasItem) {
        const targets = [];

        if (hasItem) {
            if (state.exitPos) {
                targets.push(state.exitPos);
            } else {
                // Exit is on far edge — enumerate plausible edge cells
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
                // Explore unmapped cells in inner half where item spawns
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

            cameFrom[key] = from;

            if (targets.some(([tc, tr]) => tc === col && tr === row)) { goalCell = [col, row]; break; }

            const passages = state.grid[key] ?? -1;
            const stepCost = passages === -1 ? CONFIG.UNKNOWN_TILE_COST : 1;

            for (const dir of ALL_DIRS) {
                const nc = col + STEP[dir].dc, nr = row + STEP[dir].dr;
                if ((passages & dir) && ((state.grid[`${nc},${nr}`] ?? -1) & OPPOSITE[dir])) {
                    open.push({ cost: cost + stepCost, col: nc, row: nr, from: [col, row] });
                }
            }

            if (++iterations > 5000) break;
        }

        if (!goalCell) return null;

        // Trace back to find first step from start
        let current = goalCell, previous = null;
        while (current) {
            const prev = cameFrom[`${current[0]},${current[1]}`];
            if (!prev) break;
            previous = current;
            current = prev;
        }
        return previous;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoplay);
    } else {
        autoplay();
    }
})();
