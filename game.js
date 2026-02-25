const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const pitchButtons = Array.from(document.querySelectorAll('.pitch-btn'));
const mobileHint = document.querySelector('#mobile-controls .mobile-hint');
const MOBILE_INPUT_QUERY = window.matchMedia("(max-width: 768px), (hover: none) and (pointer: coarse)");
const gameContainer = document.getElementById('game-container');

canvas.width = 600;
canvas.height = 600;

let isMobileInput = MOBILE_INPUT_QUERY.matches;
if (MOBILE_INPUT_QUERY.addEventListener) {
    MOBILE_INPUT_QUERY.addEventListener('change', (e) => { isMobileInput = e.matches; });
} else if (MOBILE_INPUT_QUERY.addListener) {
    MOBILE_INPUT_QUERY.addListener((e) => { isMobileInput = e.matches; });
}

const COLORS = {
    grassLight: "#43a047", grassDark: "#388e3c",
    dirt: "#bcaaa4", dirtDark: "#8d6e63",
    lines: "#ffffff", batMain: "#f5f5f5", batGrip: "#4e342e",
    ball: "#ffffff", stadium: "#1a237e", text: "#ffd600",
    panel: "rgba(0, 0, 0, 0.8)", activeBase: "#ffeb3b"
};

const PITCH_TYPES = {
    FAST: { name: "FAST", speedMult: 1.2, cost: 5, color: "#fff" },
    CURVE: { name: "CURVE", speedMult: 0.9, cost: 3, color: "#4fc3f7" },
    CHANGE: { name: "CHANGE", speedMult: 0.6, cost: 2, color: "#ffd600" }
};

// Pitcher archetypes: each defines weighted pitch mix and preferred entry zones per pitch type
const PITCHER_STYLES = [
    {   // Power pitcher: relies on fastball, uses curve to finish counts
        signaturePitch: "FAST",
        pitchRepertoire: {
            FAST:  { weight: 0.65, preferredZones: [{col:1, row:0}, {col:0, row:1}] },
            CURVE: { weight: 0.35, preferredZones: [{col:2, row:2}, {col:2, row:1}] }
        }
    },
    {   // Curveball specialist: heavy breaking ball, uses fastball to set up
        signaturePitch: "CURVE",
        pitchRepertoire: {
            FAST:   { weight: 0.40, preferredZones: [{col:1, row:1}, {col:0, row:0}] },
            CURVE:  { weight: 0.50, preferredZones: [{col:2, row:2}, {col:0, row:2}] },
            CHANGE: { weight: 0.10, preferredZones: [{col:1, row:2}] }
        }
    },
    {   // Changeup artist: disrupts timing with offspeed
        signaturePitch: "CHANGE",
        pitchRepertoire: {
            FAST:   { weight: 0.45, preferredZones: [{col:0, row:0}, {col:2, row:0}] },
            CURVE:  { weight: 0.10, preferredZones: [{col:2, row:2}] },
            CHANGE: { weight: 0.45, preferredZones: [{col:1, row:2}, {col:2, row:2}] }
        }
    },
    {   // Balanced finesse pitcher: mixes all three with precise location
        signaturePitch: "FAST",
        pitchRepertoire: {
            FAST:   { weight: 0.45, preferredZones: [{col:2, row:1}, {col:0, row:1}] },
            CURVE:  { weight: 0.25, preferredZones: [{col:0, row:2}, {col:1, row:2}] },
            CHANGE: { weight: 0.30, preferredZones: [{col:2, row:2}, {col:2, row:1}] }
        }
    }
];

// Validate PITCHER_STYLES zone coordinates are within the 3x3 grid (0–2)
PITCHER_STYLES.forEach((style) => {
    if (!style.pitchRepertoire) return;
    Object.keys(style.pitchRepertoire).forEach((type) => {
        const entry = style.pitchRepertoire[type];
        if (!Array.isArray(entry.preferredZones)) return;
        entry.preferredZones = entry.preferredZones.filter(z =>
            z && typeof z.col === "number" && typeof z.row === "number" &&
            z.col >= 0 && z.col <= 2 && z.row >= 0 && z.row <= 2
        );
    });
});

function fisherYatesShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// --- 球員與隊伍系統 ---
function createPlayer(isPitcher = false) {
    const batSide = Math.random() < 0.5 ? "L" : "R";
    // Batters lean toward their inside corner; mix in one other random zone
    const insideCol = batSide === "R" ? 2 : 0;
    const allZones = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) allZones.push({col: c, row: r});
    const inner = fisherYatesShuffle(allZones.filter(z => z.col === insideCol));
    const outer = fisherYatesShuffle(allZones.filter(z => z.col !== insideCol));
    const preferredZones = [inner[0], outer[0]];
    const allTypes = Object.keys(PITCH_TYPES);
    const preferredPitchTypes = allTypes.filter((type) => Math.random() < 0.5);
    if (preferredPitchTypes.length === 0 && allTypes.length > 0) preferredPitchTypes.push(allTypes[Math.floor(Math.random() * allTypes.length)]);
    const player = {
        number: Math.floor(Math.random() * 99) + 1,
        batSide,
        power: 0.85 + Math.random() * 0.45,
        speed: 1.0 + Math.random() * 1.5,
        stamina: 100,
        preferredZones,
        preferredPitchTypes
    };
    if (isPitcher) {
        const style = PITCHER_STYLES[Math.floor(Math.random() * PITCHER_STYLES.length)];
        player.signaturePitch = style.signaturePitch;
        player.pitchRepertoire = style.pitchRepertoire;
    }
    return player;
}

function createTeam(name, color) {
    let players = [];
    for (let i = 0; i < 9; i++) players.push(createPlayer(i === 7));
    return { name, color, roster: players, order: 0 };
}

let awayTeam = createTeam("AWAY", "#d32f2f");
let homeTeam = createTeam("HOME", "#1565c0");

let state = {
    inning: 1, isTop: true,
    scoreAway: 0, scoreHome: 0,
    outs: 0, strikes: 0, balls: 0,
    bases: [false, false, false],
    message: "READY!", msgTimer: 0,
    isWaiting: true, pitchType: "FAST",
    mouseX: 300, mouseY: 300,
    charge: 20, chargeDir: 1, chargeSpeed: 1.5,
    lockedCharge: 0, showPowerTimer: 0,
    pitchPath: [], hitPath: [], lastSpot: null,
    fieldersResetting: false,
    autoPitchTimer: 120, nextPitchTimer: 0, nextInningTimer: 0,
    isGameOver: false, screenShake: 0,
    swungThisPitch: false,
    gridCol: 1, gridRow: 1,
    gameStarted: false
};

const PITCHER_POS = { x: 300, y: 400 };
const HOME_PLATE = { x: 300, y: 560 };
const STRIKE_ZONE = { x: 270, y: 510, w: 60, h: 50 };
const PITCH_ZONE_X = [STRIKE_ZONE.x + 10, STRIKE_ZONE.x + Math.round(STRIKE_ZONE.w / 2), STRIKE_ZONE.x + STRIKE_ZONE.w - 10];
const PITCH_ZONE_Y = [STRIKE_ZONE.y + 8, STRIKE_ZONE.y + 25, STRIKE_ZONE.y + 40];
const PITCH_GRID_UI = { x: 150, y: 178, w: 300, titleH: 24, typeH: 36, cellW: 100, cellH: 62 };
const BAT_CONFIG = { totalLength: 75, knobWidth: 12, handleWidth: 7, barrelWidth: 18, knobLength: 4, handleLength: 22, taperLength: 18 };
const BASE_POSITIONS = [
    { x: 480, y: 400 }, // 1B
    { x: 300, y: 240 }, // 2B
    { x: 120, y: 400 }  // 3B
];
const DEFENSE_SHIFT = {
    buntCornerX: 28,
    buntCornerY: 50,
    infieldInY: 56,
    doublePlayMiddleY: 30,
    holdRunner1BX: 18,
    middlePinch2BSSX: 14,
    outfieldShallowY: 20
};
const BALL_FLIGHT = {
    gravity: 0.32,
    minCatchHeight: 8,
    maxVisualLift: 48
};
const GAME_SPEED = {
    pitchBase: 2.7,          // 投球基礎速度
    hitPowerScale: 0.84,     // 擊球初速倍率（降低可減少長打）
    fielderChase: 0.042,     // 守備追球速度
    fielderReset: 0.10,      // 守備回位速度
    airDrag: 0.986,          // 空中阻力
    groundDrag: 0.94         // 落地滾動阻力
};
const CATCHER_STRATEGY = {
    outOfRangePenalty: 10000,        // Coverage penalty applied when ball is outside a fielder's range
    offSpeedMixProb: 0.5,            // Probability of off-speed pitch vs power hitters
    twoStrikeFastballProb: 0.6,      // Probability of fastball on 2-strike count
    lateInningOffSpeedProb: 0.4      // Probability of off-speed when leading late in game
};

let ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false, hit: false, wasInZone: false, caught: false, resultChecked: false, type: "FAST", speed: 2.2, isHBP: false, hitFrames: 0 };
let bat = { angle: 0, swinging: false, speed: 0.2, pivot: {x:0, y:0}, dir: 1, base: 0, target: 0 };
let mobilePitchAim = { active: false, x: 300, y: 520, previewType: "FAST" };
let activePointerId = null;
let mobileUiCache = "";

const FIELDERS = [
    { id: "CF", x: 300, y: 140, coverageRange: 200 },
    { id: "LF", x: 130, y: 210, coverageRange: 180 },
    { id: "RF", x: 470, y: 210, coverageRange: 180 },
    { id: "SS", x: 215, y: 335, coverageRange: 130 },
    { id: "2B", x: 385, y: 335, coverageRange: 130 },
    { id: "3B", x: 150, y: 425, coverageRange: 110 },
    { id: "1B", x: 450, y: 425, coverageRange: 110 }
].map(f => ({ ...f, homeX: f.x, homeY: f.y, speed: 1.0 + Math.random()*0.5 }));

// --- 輔助功能 ---
function showMessage(msg) { state.message = msg; state.msgTimer = 90; }

function updateScoreboard() {
    const a = document.getElementById('score-away'); a && (a.innerText = state.scoreAway);
    const h = document.getElementById('score-home'); h && (h.innerText = state.scoreHome);
    const i = document.getElementById('inning'); i && (i.innerText = state.inning + (state.isTop ? " TOP" : " BOT"));
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function getCanvasPos(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    return {
        x: (clientX - r.left) * sx,
        y: (clientY - r.top) * sy
    };
}

function getPitchTypeFromAimY(y) {
    if (y < 475) return "FAST";
    if (y < 525) return "CURVE";
    return "CHANGE";
}

function setPitchType(type) {
    if (!PITCH_TYPES[type]) return;
    state.pitchType = type;
    mobilePitchAim.previewType = type;
    syncMobileControls(true);
}

function syncMobileControls(force = false) {
    const key = `${state.pitchType}|${state.isTop}|${isMobileInput}`;
    if (!force && key === mobileUiCache) return;
    mobileUiCache = key;

    pitchButtons.forEach((btn) => {
        const selected = btn.dataset.pitch === state.pitchType;
        btn.classList.toggle('active', selected);
        btn.disabled = !state.isTop;
    });
    if (mobileHint) {
        mobileHint.textContent = state.isTop
            ? (isMobileInput
                ? `手機投球：按住球場拖曳瞄準，放開出手（${state.pitchType}）`
                : `點擊九宮格選擇進壘點，或用方向鍵移動 Space 投球（${state.pitchType}）`)
            : "手機打擊：點擊球場揮棒";
    }
}

function updateMobileAim(x, y) {
    mobilePitchAim.x = clamp(x, STRIKE_ZONE.x - 70, STRIKE_ZONE.x + STRIKE_ZONE.w + 70);
    mobilePitchAim.y = clamp(y, 440, 570);
    mobilePitchAim.previewType = getPitchTypeFromAimY(mobilePitchAim.y);
}

function getCurrentBatter() { return (state.isTop ? awayTeam : homeTeam).roster[(state.isTop ? awayTeam : homeTeam).order]; }
function getCurrentPitcher() { return (state.isTop ? homeTeam : awayTeam).roster[7]; }

function updateBatSide() {
    const batter = getCurrentBatter();
    bat.swinging = false;
    if (batter.batSide === "R") {
        bat.pivot = { x: 275, y: 555 }; bat.base = -0.15 * Math.PI; bat.target = -0.95 * Math.PI; bat.dir = -1;
    } else {
        bat.pivot = { x: 325, y: 555 }; bat.base = 1.15 * Math.PI; bat.target = 1.95 * Math.PI; bat.dir = 1;
    }
    bat.angle = bat.base;
    syncMobileControls(true);
}

function pitch(tx = null, ty = null) {
    if (ball.active || state.fieldersResetting || state.isGameOver) return;
    const p = getCurrentPitcher();
    const pData = PITCH_TYPES[state.pitchType];
    state.isWaiting = false; state.pitchPath = []; state.hitPath = []; state.lastSpot = null;
    state.swungThisPitch = false; state.showPowerTimer = 0;
    ball.active = true; ball.hit = false; ball.wasInZone = false; ball.caught = false; ball.resultChecked = false; ball.isHBP = false; ball.hitFrames = 0;
    ball.x = PITCHER_POS.x; ball.y = PITCHER_POS.y; ball.z = 0; ball.vz = 3.5;
    ball.type = state.pitchType;
    let bSpeed = GAME_SPEED.pitchBase * pData.speedMult * (p.stamina > 30 ? 1 : 0.7);
    if (tx === null) tx = 280 + Math.random() * 40;
    if (ty === null) ty = HOME_PLATE.y;
    const time = (ty - PITCHER_POS.y) / bSpeed;
    ball.vx = (tx - PITCHER_POS.x) / time; ball.vy = bSpeed;
    p.stamina = Math.max(0, p.stamina - pData.cost);
}

function swing() {
    if (bat.swinging || !ball.active || ball.hit) return;
    bat.swinging = true; state.swungThisPitch = true;
    state.lockedCharge = state.charge; state.showPowerTimer = 60;
    bat.speed = 0.18 + (state.lockedCharge / 100) * 0.22;
}

function advance(n, walk = false) {
    let s = 0;
    if (walk) { 
        if (state.bases[0]) { if (state.bases[1]) { if (state.bases[2]) s++; state.bases[2] = true; } state.bases[1] = true; } 
        state.bases[0] = true; 
    } else { 
        for (let i=2; i>=0; i--) { if (state.bases[i]) { if (i+n >= 3) s++; else state.bases[i+n] = true; state.bases[i] = false; } } 
        if (n<4) state.bases[n-1] = true; else { s += (state.bases.filter(b=>b).length + 1); state.bases = [false, false, false]; }
    }
    if (state.isTop) state.scoreAway += s; else state.scoreHome += s;
    updateScoreboard();
}

function checkResult() {
    if (ball.resultChecked) return; ball.resultChecked = true;
    const team = state.isTop ? awayTeam : homeTeam;
    if (ball.isHBP) { showMessage("HIT BY PITCH!"); advance(1, true); team.order = (team.order + 1) % 9; updateBatSide(); }
    else if (ball.hit) {
        const angle = Math.atan2(ball.y - HOME_PLATE.y, ball.x - HOME_PLATE.x);
        const isFoul = (ball.y > HOME_PLATE.y) || (angle < -2.4 || angle > -0.7);
        if (isFoul) { if (state.strikes < 2) state.strikes++; showMessage("FOUL"); }
        else if (ball.caught) { state.outs++; showMessage("OUT!"); team.order = (team.order + 1) % 9; updateBatSide(); }
        else {
            const d = Math.sqrt((ball.x - HOME_PLATE.x)**2 + (ball.y - HOME_PLATE.y)**2);
            state.strikes = 0; state.balls = 0;
            if (d > 500) { advance(4); showMessage("HOME RUN!!"); }
            else if (d > 350) { advance(2); showMessage("DOUBLE"); }
            else if (d > 160) { advance(1); showMessage("SINGLE"); }
            else { state.outs++; showMessage("OUT"); }
            team.order = (team.order + 1) % 9; updateBatSide();
        }
    } else {
        if (state.swungThisPitch) { state.strikes++; showMessage("MISS!"); }
        else if (ball.wasInZone) { state.strikes++; showMessage("STRIKE!"); }
        else { state.balls++; showMessage("BALL"); }
    }
    if (state.strikes >= 3) { state.outs++; state.strikes = 0; state.balls = 0; team.order = (team.order + 1) % 9; updateBatSide(); showMessage("STRIKEOUT"); }
    if (state.balls >= 4) { advance(1, true); state.strikes = 0; state.balls = 0; team.order = (team.order + 1) % 9; updateBatSide(); showMessage("WALK"); }
    if (state.outs >= 3) state.nextInningTimer = 100; else state.nextPitchTimer = 60;
}

function getDefensiveTargets() {
    const targets = {};
    FIELDERS.forEach(f => targets[f.id] = { x: f.homeX, y: f.homeY });
    const has1B = state.bases[0];
    const has2B = state.bases[1];
    const has3B = state.bases[2];
    const buntGuard = !ball.active && state.isWaiting && state.outs < 2 && (has1B || has2B || has3B);
    const infieldIn = state.outs < 2 && (has3B || (has1B && has2B));
    const doublePlayDepth = state.outs < 2 && has1B;

    if (buntGuard) {
        targets["1B"].x += DEFENSE_SHIFT.buntCornerX;
        targets["1B"].y += DEFENSE_SHIFT.buntCornerY;
        targets["3B"].x -= DEFENSE_SHIFT.buntCornerX;
        targets["3B"].y += DEFENSE_SHIFT.buntCornerY;
    }

    if (infieldIn) {
        ["1B", "2B", "SS", "3B"].forEach(id => {
            targets[id].y += DEFENSE_SHIFT.infieldInY;
        });
    }

    if (doublePlayDepth && !infieldIn) {
        targets["2B"].x += 16;
        targets["2B"].y -= DEFENSE_SHIFT.doublePlayMiddleY;
        targets["SS"].x -= 16;
        targets["SS"].y -= DEFENSE_SHIFT.doublePlayMiddleY;
    }

    if (has1B) targets["1B"].x += DEFENSE_SHIFT.holdRunner1BX; // Hold runner at first
    if (has2B) {
        targets["2B"].x -= DEFENSE_SHIFT.middlePinch2BSSX;
        targets["SS"].x += DEFENSE_SHIFT.middlePinch2BSSX;
    } // Middle infield pinch
    if (has3B && state.outs < 2) {
        targets["CF"].y += DEFENSE_SHIFT.outfieldShallowY;
        targets["LF"].y += DEFENSE_SHIFT.outfieldShallowY;
        targets["RF"].y += DEFENSE_SHIFT.outfieldShallowY;
    }

    return targets;
}

// --- Defense Module ---
// Returns the fielder best positioned to catch a ball at (bx, by).
// Fielders outside their coverageRange receive a large penalty so nearby
// specialists always take priority over out-of-zone players.
function selectFielderForBall(bx, by) {
    let best = null, bestScore = Infinity;
    FIELDERS.forEach(f => {
        const dFromHome = Math.sqrt((bx - f.homeX) ** 2 + (by - f.homeY) ** 2);
        const coveragePenalty = dFromHome > f.coverageRange ? CATCHER_STRATEGY.outOfRangePenalty : 0;
        const score = Math.sqrt((bx - f.x) ** 2 + (by - f.y) ** 2) + coveragePenalty;
        if (score < bestScore) { bestScore = score; best = f; }
    });
    return best;
}

// --- Catcher Strategy Module ---
// Returns { pitchType, targetX, targetY } recommendation based on pitcher repertoire,
// batter tendencies, and game context (inning, runners on base, count).
function getCatcherRecommendation() {
    const batter = getCurrentBatter();
    const pitcher = getCurrentPitcher();

    // Right-handed batters pull to left (negative x), left-handed pull to right (positive x)
    const pullBias = batter.batSide === "R" ? -1 : 1;
    let targetX = 300 + pullBias * 25;
    let targetY = null;
    let pitchType = "FAST";
    const rTypes = pitcher.pitchRepertoire ? Object.keys(pitcher.pitchRepertoire) : ["FAST"];

    // Base: use pitcher's weighted repertoire to select pitch type
    if (pitcher.pitchRepertoire) {
        const total = rTypes.reduce((s, t) => s + pitcher.pitchRepertoire[t].weight, 0);
        let rand = Math.random() * total;
        pitchType = rTypes[rTypes.length - 1];
        for (let i = 0; i < rTypes.length; i++) {
            rand -= pitcher.pitchRepertoire[rTypes[i]].weight;
            if (rand <= 0) { pitchType = rTypes[i]; break; }
        }
    }

    // Power hitters: mix in off-speed to disrupt timing
    if (batter.power > 1.1) {
        if (Math.random() < CATCHER_STRATEGY.offSpeedMixProb) {
            pitchType = pitcher.pitchRepertoire?.CURVE
                ? "CURVE"
                : (pitcher.pitchRepertoire?.CHANGE ? "CHANGE" : "FAST");
        }
    }

    // Runners in scoring position (2nd or 3rd base): prioritise strikes with fastball
    if (state.bases[1] || state.bases[2]) {
        pitchType = rTypes.includes("FAST") ? "FAST" : rTypes[0];
    }

    // 2-strike count: go for strikeout or waste pitch away from pull side
    if (state.strikes === 2) {
        pitchType = Math.random() < CATCHER_STRATEGY.twoStrikeFastballProb
            ? (rTypes.includes("FAST") ? "FAST" : rTypes[0])
            : (rTypes.includes("CURVE") ? "CURVE" : rTypes[rTypes.length - 1]);
    }

    // Late innings with a lead: mix off-speed to avoid extra-base hits
    const teamLead = state.isTop ? state.scoreAway - state.scoreHome : state.scoreHome - state.scoreAway;
    if (state.inning >= 7 && teamLead > 2) {
        const offSpeed = pitcher.pitchRepertoire?.CURVE ? "CURVE" : (pitcher.pitchRepertoire?.CHANGE ? "CHANGE" : null);
        if (offSpeed && Math.random() < CATCHER_STRATEGY.lateInningOffSpeedProb) pitchType = offSpeed;
    }

    // Pick target zone from pitcher's repertoire; avoid batter's preferred (hot) zones
    if (pitcher.pitchRepertoire && pitcher.pitchRepertoire[pitchType]) {
        const zones = pitcher.pitchRepertoire[pitchType].preferredZones || [];
        if (zones.length > 0) {
            const avoidZones = batter.preferredZones || [];
            const safeZones = zones.filter(z => !avoidZones.some(az => az.col === z.col && az.row === z.row));
            const pool = safeZones.length > 0 ? safeZones : zones;
            const zone = pool[Math.floor(Math.random() * pool.length)];
            targetX = PITCH_ZONE_X[zone.col];
            targetY = PITCH_ZONE_Y[zone.row];
        }
    }

    // Situation-based location overrides
    if (state.bases[1] || state.bases[2]) {
        // With runners in scoring position, target the middle of the zone to reduce walk risk
        targetX = 300;
        targetY = PITCH_ZONE_Y[1];
    }
    if (state.strikes === 2) {
        // On two strikes, waste a pitch away from the pull side while keeping a consistent vertical target
        targetX = 300 - pullBias * 15;
        targetY = PITCH_ZONE_Y[1];
    }

    return { pitchType, targetX, targetY };
}

function update() {
    if (!state.gameStarted || state.isGameOver) return;
    if (state.nextInningTimer > 0) { state.nextInningTimer--; if (state.nextInningTimer === 1) { state.isTop = !state.isTop; state.outs = 0; state.strikes = 0; state.balls = 0; state.bases = [false, false, false]; if (state.isTop) state.inning++; if (state.inning > 9) state.isGameOver = true; updateBatSide(); state.isWaiting = true; updateScoreboard(); showMessage(state.isTop ? "TOP OF " + state.inning : "BOT OF " + state.inning); } return; }
    if (state.nextPitchTimer > 0) { state.nextPitchTimer--; if (state.nextPitchTimer === 1) state.isWaiting = true; }
    if (!bat.swinging) { state.charge += state.chargeSpeed * state.chargeDir; if (state.charge >= 100 || state.charge <= 20) state.chargeDir *= -1; }
    const defenseTargets = getDefensiveTargets();
    const isLiveHit = ball.active && ball.hit && !ball.caught;
    let allIn = true;
    const chaser = isLiveHit ? selectFielderForBall(ball.x, ball.y) : null;
    FIELDERS.forEach(f => {
        if (isLiveHit) {
            allIn = false;
            if (f === chaser) {
                const dx = ball.x - f.x, dy = ball.y - f.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 5) {
                    f.x += dx * GAME_SPEED.fielderChase * f.speed;
                    f.y += dy * GAME_SPEED.fielderChase * f.speed;
                }
                if (dist < 25 && ball.z > BALL_FLIGHT.minCatchHeight && Math.random() < 0.1) {
                    ball.caught = true; ball.vx = 0; ball.vy = 0; ball.vz = 0;
                }
            } else {
                const t = defenseTargets[f.id];
                const dx = t.x - f.x, dy = t.y - f.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 2) {
                    f.x += dx * GAME_SPEED.fielderReset * f.speed;
                    f.y += dy * GAME_SPEED.fielderReset * f.speed;
                } else { f.x = t.x; f.y = t.y; }
            }
            return;
        }
        const t = defenseTargets[f.id];
        const dx = t.x - f.x;
        const dy = t.y - f.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > 2) {
            f.x += dx * GAME_SPEED.fielderReset * f.speed;
            f.y += dy * GAME_SPEED.fielderReset * f.speed;
            allIn = false;
        } else {
            f.x = t.x;
            f.y = t.y;
        }
    });
    state.fieldersResetting = !allIn;
    if (!state.isTop && state.isWaiting && !state.fieldersResetting) { state.autoPitchTimer--; if (state.autoPitchTimer <= 0) { const rec = getCatcherRecommendation(); setPitchType(rec.pitchType); pitch(rec.targetX, rec.targetY); state.autoPitchTimer = 150; } }
    if (ball.active) {
        if (!ball.hit) state.pitchPath.push({x: ball.x, y: ball.y, z: ball.z});
        let motionScale = 1;
        if (ball.hit) {
            ball.hitFrames++;
            const t = Math.min(1, ball.hitFrames / 26);
            motionScale = 0.42 + (0.58 * t); // brief bullet-time feel on contact
        }
        ball.x += ball.vx * motionScale;
        ball.y += ball.vy * motionScale;
        ball.z = Math.max(0, ball.z + ball.vz * motionScale);
        ball.vz -= BALL_FLIGHT.gravity * motionScale;
        if (ball.z === 0 && ball.vz < 0) ball.vz = 0;
        if (ball.hit) {
            state.hitPath.push({x: ball.x, y: ball.y, z: ball.z});
        }
        if (ball.x > STRIKE_ZONE.x && ball.x < STRIKE_ZONE.x+STRIKE_ZONE.w && ball.y > STRIKE_ZONE.y && ball.y < STRIKE_ZONE.y+STRIKE_ZONE.h) ball.wasInZone = true;
        if (ball.hit) {
            const drag = ball.z > 0 ? GAME_SPEED.airDrag : GAME_SPEED.groundDrag;
            ball.vx *= drag;
            ball.vy *= drag;
        }
        if (!ball.hit && bat.swinging) {
            const dx = ball.x - bat.pivot.x; const dy = ball.y - bat.pivot.y; const dist = Math.sqrt(dx*dx+dy*dy);
            if (dist < 80 && dist > 10) {
                const ang = Math.atan2(dy, dx); let diff = ang - bat.angle; while(diff > Math.PI) diff -= Math.PI*2; while(diff < -Math.PI) diff += Math.PI*2;
                if (Math.abs(diff) < 0.5) {
                    ball.hit = true; ball.hitFrames = 0; state.screenShake = 10;
                    const p = (12 + (state.lockedCharge/100) * 10) * getCurrentBatter().power * GAME_SPEED.hitPowerScale;
                    ball.vx = Math.cos(bat.angle + (Math.PI/2 * bat.dir)) * p;
                    ball.vy = Math.sin(bat.angle + (Math.PI/2 * bat.dir)) * p;
                    ball.z = 2;
                    ball.vz = 4.5 + (state.lockedCharge / 100) * 3.5;
                }
            }
        }
        if (state.isTop && ball.active && !ball.hit && ball.y > 500 && Math.random() < 0.05) swing();
        if (ball.y < 0 || ball.y > 600 || ball.x < 0 || ball.x > 600 || (ball.hit && Math.abs(ball.vx) < 0.1 && ball.z === 0)) {
            state.lastSpot = {x: ball.x, y: ball.y};
            checkResult();
            ball.active = false;
        }
    }
    if (bat.swinging) { bat.angle += bat.speed * bat.dir; if (bat.dir === -1 ? bat.angle < bat.target : bat.angle > bat.target) bat.swinging = false; }
    else { bat.angle += (bat.base - bat.angle) * 0.1; }
    if (state.showPowerTimer > 0) state.showPowerTimer--;
}

function drawBat() {
    ctx.save(); ctx.translate(bat.pivot.x, bat.pivot.y); ctx.rotate(bat.angle);
    let g = ctx.createLinearGradient(0, -9, 0, 9); g.addColorStop(0, "#fff"); g.addColorStop(0.4, "#e0e0e0"); g.addColorStop(1, "#9e9e9e");
    ctx.fillStyle = COLORS.batGrip; ctx.beginPath(); ctx.arc(3, 0, 6, 0, Math.PI*2); ctx.fill(); ctx.fillRect(4, -4, 22, 8);
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(26, -4); ctx.lineTo(44, -9); ctx.lineTo(70, -9); ctx.arc(70, 0, 9, -Math.PI/2, Math.PI/2); ctx.lineTo(44, 9); ctx.lineTo(26, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
}

function drawDollHead(x, y, teamColor, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffccbc";
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.arc(0, 0, 16, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-20, -4, 40, 4);
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(-6, -2, 1.5, 0, Math.PI * 2);
    ctx.arc(6, -2, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawBaseBag(x, y, occupied = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#fff";
    ctx.fillRect(-10, -10, 20, 20);
    ctx.strokeStyle = occupied ? COLORS.activeBase : "rgba(0,0,0,0.35)";
    ctx.lineWidth = occupied ? 3 : 2;
    ctx.strokeRect(-10, -10, 20, 20);
    ctx.restore();
}

function drawMobilePitchReticle() {
    if (!(isMobileInput && mobilePitchAim.active && state.isTop && state.isWaiting)) return;
    const x = mobilePitchAim.x;
    const y = mobilePitchAim.y;
    const pitchType = mobilePitchAim.active ? mobilePitchAim.previewType : state.pitchType;
    const color = PITCH_TYPES[pitchType].color;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.moveTo(x - 24, y); ctx.lineTo(x + 24, y);
    ctx.moveTo(x, y - 24); ctx.lineTo(x, y + 24);
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - 36, y - 40, 72, 16);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.fillText(pitchType, x, y - 28);
    ctx.restore();
}

function getPitchGridClick(px, py) {
    if (!state.isTop || !state.isWaiting || state.isGameOver) return null;
    const G = PITCH_GRID_UI;
    if (px < G.x || px >= G.x + G.w) return null;
    const typeTop = G.y + G.titleH, typeBottom = typeTop + G.typeH;
    if (py >= typeTop && py < typeBottom) {
        const col = clamp(Math.floor((px - G.x) / G.cellW), 0, 2);
        return { kind: 'type', value: ["FAST", "CURVE", "CHANGE"][col] };
    }
    const gridTop = typeBottom, gridBottom = gridTop + G.cellH * 3;
    if (py >= gridTop && py < gridBottom) {
        const col = clamp(Math.floor((px - G.x) / G.cellW), 0, 2);
        const row = clamp(Math.floor((py - gridTop) / G.cellH), 0, 2);
        return { kind: 'cell', col, row };
    }
    return null;
}

function drawPitchGrid() {
    if (!state.isTop || !state.isWaiting || state.isGameOver) return;
    const G = PITCH_GRID_UI;
    const panelH = G.titleH + G.typeH + G.cellH * 3;
    const zoneLabels = [["高外","高中","高內"],["中外","正中","中內"],["低外","低中","低內"]];
    ctx.save();
    ctx.fillStyle = "rgba(0, 10, 45, 0.88)";
    ctx.fillRect(G.x, G.y, G.w, panelH);
    ctx.strokeStyle = "rgba(255, 215, 0, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(G.x, G.y, G.w, panelH);

    ctx.fillStyle = "#ffd600";
    ctx.font = "bold 13px Arial";
    ctx.textAlign = "center";
    ctx.fillText("⚾ 選擇球種 & 進壘點", G.x + G.w / 2, G.y + G.titleH - 5);

    ["FAST", "CURVE", "CHANGE"].forEach((type, i) => {
        const bx = G.x + i * G.cellW;
        const by = G.y + G.titleH;
        const sel = state.pitchType === type;
        const col = PITCH_TYPES[type].color;
        ctx.fillStyle = sel ? col + "33" : "rgba(255,255,255,0.06)";
        ctx.fillRect(bx, by, G.cellW, G.typeH);
        ctx.strokeStyle = sel ? col : "rgba(255,255,255,0.2)";
        ctx.lineWidth = sel ? 2 : 1;
        ctx.strokeRect(bx, by, G.cellW, G.typeH);
        ctx.fillStyle = sel ? col : "#888";
        ctx.font = sel ? "bold 12px Arial" : "11px Arial";
        ctx.textAlign = "center";
        ctx.fillText(type, bx + G.cellW / 2, by + G.typeH / 2 + 4);
    });

    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            const cx = G.x + col * G.cellW;
            const cy = G.y + G.titleH + G.typeH + row * G.cellH;
            const sel = state.gridRow === row && state.gridCol === col;
            ctx.fillStyle = sel ? "rgba(255, 215, 0, 0.3)" : "rgba(255,255,255,0.06)";
            ctx.fillRect(cx, cy, G.cellW, G.cellH);
            ctx.strokeStyle = sel ? "#ffd700" : "rgba(255,255,255,0.2)";
            ctx.lineWidth = sel ? 2.5 : 1;
            ctx.strokeRect(cx, cy, G.cellW, G.cellH);
            ctx.fillStyle = sel ? "#ffd700" : "rgba(255,255,255,0.7)";
            ctx.font = sel ? "bold 14px Arial" : "13px Arial";
            ctx.textAlign = "center";
            ctx.fillText(zoneLabels[row][col], cx + G.cellW / 2, cy + G.cellH / 2 + 5);
        }
    }
    // Highlight pitcher's preferred zones for the selected pitch type
    const pitcher = getCurrentPitcher();
    if (pitcher.pitchRepertoire && pitcher.pitchRepertoire[state.pitchType]) {
        const pitchColor = PITCH_TYPES[state.pitchType].color;
        pitcher.pitchRepertoire[state.pitchType].preferredZones.forEach(z => {
            const cx = G.x + z.col * G.cellW;
            const cy = G.y + G.titleH + G.typeH + z.row * G.cellH;
            ctx.strokeStyle = pitchColor;
            ctx.lineWidth = 2.5;
            ctx.strokeRect(cx + 4, cy + 4, G.cellW - 8, G.cellH - 8);
            ctx.fillStyle = pitchColor;
            ctx.font = "9px Arial";
            ctx.textAlign = "right";
            ctx.fillText("★", cx + G.cellW - 4, cy + G.cellH - 4);
        });
    }
    ctx.restore();
}

function drawStartScreen() {
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const sy = h / 600; // scale factor relative to design height of 600
    ctx.fillStyle = "rgba(0,0,30,0.92)";
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd600";
    ctx.font = "bold 64px Arial";
    ctx.fillText("⚾", cx, 195 * sy);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px 'Courier New'";
    ctx.fillText("RETRO BASEBALL", cx, 265 * sy);
    ctx.font = "15px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("上半局：選擇球種 & 進壘點後投球", cx, 315 * sy);
    ctx.fillText("下半局：按空白鍵或點擊螢幕揮棒", cx, 338 * sy);
    ctx.fillStyle = "#ffd600";
    ctx.font = "bold 26px Arial";
    ctx.fillText("▶  PRESS START  ◀", cx, 405 * sy);
    ctx.font = "13px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("CLICK  /  SPACE  /  TAP  to  START", cx, 445 * sy);
}

function drawHUD() {
    const panelBg = "rgba(0,0,0,0.62)";
    const borderC = "rgba(255,255,255,0.32)";
    // Compact bases panel (bottom-left)
    ctx.fillStyle = panelBg; ctx.fillRect(14, 464, 84, 64);
    ctx.strokeStyle = borderC; ctx.lineWidth = 1; ctx.strokeRect(14, 464, 84, 64);
    const drawB = (x, y, occ) => { ctx.fillStyle = occ ? COLORS.activeBase : "rgba(255,255,255,0.18)"; ctx.beginPath(); ctx.moveTo(x, y-9); ctx.lineTo(x+9, y); ctx.lineTo(x, y+9); ctx.lineTo(x-9, y); ctx.fill(); };
    drawB(87, 504, state.bases[0]); drawB(64, 481, state.bases[1]); drawB(41, 504, state.bases[2]);
    const offenseTeam = state.isTop ? awayTeam : homeTeam;
    if (state.bases[0]) drawDollHead(93, 498, offenseTeam.color, 0.22);
    if (state.bases[1]) drawDollHead(70, 475, offenseTeam.color, 0.22);
    if (state.bases[2]) drawDollHead(47, 498, offenseTeam.color, 0.22);
    if (state.showPowerTimer > 0) { const barX = 380; ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(barX-5, 515, 25, 70); ctx.fillStyle = "#333"; ctx.fillRect(barX, 520, 15, 60); ctx.fillStyle = state.lockedCharge > 85 ? "#f00" : "#ffd600"; const h = (state.lockedCharge / 100) * 60; ctx.fillRect(barX, 580 - h, 15, h); ctx.strokeStyle = "#fff"; ctx.strokeRect(barX, 520, 15, 60); }
    const b = getCurrentBatter(); const p = getCurrentPitcher();
    // Compact batter panel (bottom-right)
    ctx.fillStyle = panelBg; ctx.fillRect(416, 464, 168, 64);
    ctx.strokeStyle = borderC; ctx.lineWidth = 1; ctx.strokeRect(416, 464, 168, 64);
    ctx.textAlign = "left"; ctx.font = "11px Arial";
    ctx.fillStyle = COLORS.text;
    ctx.fillText(`BAT #${b.number}(${b.batSide}) PWR:${(b.power*100).toFixed(0)}%`, 424, 479);
    if (b.preferredPitchTypes) { ctx.fillStyle = "#ffd600"; ctx.fillText(`HOT: ${b.preferredPitchTypes.join("/")}`, 424, 493); }
    ctx.fillStyle = "#ccc"; ctx.fillText(`P#${p.number}`, 424, 507);
    ctx.fillStyle = "#444"; ctx.fillRect(454, 500, 120, 5);
    ctx.fillStyle = p.stamina > 30 ? "#4caf50" : "#f44336"; ctx.fillRect(454, 500, p.stamina * 1.2, 5);
    // Compact pitcher panel (top-left)
    ctx.fillStyle = panelBg; ctx.fillRect(14, 124, 130, 56);
    ctx.strokeStyle = borderC; ctx.lineWidth = 1; ctx.strokeRect(14, 124, 130, 56);
    ctx.fillStyle = "#fff"; ctx.font = "11px Arial"; ctx.fillText(`PITCHER #${p.number}`, 22, 139);
    ctx.fillStyle = "#444"; ctx.fillRect(22, 147, 100, 5);
    ctx.fillStyle = p.stamina > 30 ? "#4caf50" : "#f44336"; ctx.fillRect(22, 147, p.stamina, 5);
    if (p.signaturePitch) { ctx.fillStyle = PITCH_TYPES[p.signaturePitch].color; ctx.fillText(`ACE: ${p.signaturePitch}`, 22, 168); }
}

function draw() {
    ctx.clearRect(0, 0, 600, 600);
    if (!state.gameStarted) { drawStartScreen(); return; }
    if (state.screenShake > 0) { ctx.save(); ctx.translate((Math.random()-0.5)*state.screenShake, (Math.random()-0.5)*state.screenShake); state.screenShake *= 0.8; }
    const gs = 40; for(let y=0; y<15; y++) for(let x=0; x<15; x++) { ctx.fillStyle = (x+y)%2==0?COLORS.grassLight:COLORS.grassDark; ctx.fillRect(x*gs, y*gs, gs, gs); }
    ctx.fillStyle = COLORS.stadium; ctx.fillRect(0,0,600,40); ctx.fillRect(0,560,600,40); ctx.fillRect(0,0,40,600); ctx.fillRect(560,0,40,600);
    // Foul lines: extend from home plate through 1B/3B to the canvas boundary
    // Foul angles are derived from BASE_POSITIONS so the lines pass through the base corners
    const foulAngleRight = Math.atan2(BASE_POSITIONS[0].y - HOME_PLATE.y, BASE_POSITIONS[0].x - HOME_PLATE.x);
    const foulAngleLeft  = Math.atan2(BASE_POSITIONS[2].y - HOME_PLATE.y, BASE_POSITIONS[2].x - HOME_PLATE.x);
    // Foul-line far endpoint: extend from home plate along the foul angle to the canvas edge (x=0 or x=canvas.width)
    const foulLen = canvas.width / Math.abs(Math.cos(foulAngleRight)); // reach x=canvas.width from x=HOME_PLATE.x
    const foulRx = HOME_PLATE.x + foulLen * Math.cos(foulAngleRight);
    const foulRy = HOME_PLATE.y + foulLen * Math.sin(foulAngleRight);
    const foulLx = HOME_PLATE.x + foulLen * Math.cos(foulAngleLeft);
    const foulLy = HOME_PLATE.y + foulLen * Math.sin(foulAngleLeft);
    ctx.setLineDash([]); ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.moveTo(HOME_PLATE.x, HOME_PLATE.y); ctx.lineTo(foulRx, foulRy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(HOME_PLATE.x, HOME_PLATE.y); ctx.lineTo(foulLx, foulLy); ctx.stroke();
    // Arcs centered on home plate, spanning between the two foul angles (clockwise = counter-clockwise in canvas coords)
    const OUTFIELD_RADIUS  = 420; // outfield wall (~420 px from home plate)
    const INFIELD_RADIUS   = 245; // infield/outfield grass boundary
    ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(HOME_PLATE.x, HOME_PLATE.y, OUTFIELD_RADIUS, foulAngleRight, foulAngleLeft, true); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(HOME_PLATE.x, HOME_PLATE.y, INFIELD_RADIUS, foulAngleRight, foulAngleLeft, true); ctx.stroke();
    ctx.fillStyle = COLORS.dirt; ctx.beginPath(); ctx.moveTo(300,560); ctx.lineTo(480,400); ctx.lineTo(300,240); ctx.lineTo(120,400); ctx.fill();
    BASE_POSITIONS.forEach((pos, i) => drawBaseBag(pos.x, pos.y, state.bases[i]));
    drawMobilePitchReticle();
    ctx.setLineDash([4,4]); ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.beginPath(); ctx.moveTo(300,400); state.pitchPath.forEach(p=>ctx.lineTo(p.x, p.y - Math.min(BALL_FLIGHT.maxVisualLift, p.z || 0))); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255,214,0,0.5)";
    ctx.lineWidth = 3;
    if (state.hitPath.length > 0) {
        const first = state.hitPath[0];
        ctx.beginPath();
        ctx.moveTo(first.x, first.y - Math.min(BALL_FLIGHT.maxVisualLift, first.z || 0));
        for (let i = 1; i < state.hitPath.length; i++) {
            const p = state.hitPath[i];
            const y = p.y - Math.min(BALL_FLIGHT.maxVisualLift, p.z || 0);
            ctx.lineTo(p.x, y);
        }
        ctx.stroke();
    }
    if(state.lastSpot) { ctx.fillStyle="rgba(255,214,0,0.6)"; ctx.beginPath(); ctx.arc(state.lastSpot.x, state.lastSpot.y, 8, 0, Math.PI*2); ctx.fill(); }
    ctx.fillStyle = COLORS.dirtDark; ctx.beginPath(); ctx.arc(300,400,25,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillRect(288, 398, 24, 4);
    ctx.beginPath(); ctx.moveTo(300,545); ctx.lineTo(315,557); ctx.lineTo(315,575); ctx.lineTo(285,575); ctx.lineTo(285,557); ctx.fill();
    const defT = state.isTop ? homeTeam : awayTeam;
    const offT = state.isTop ? awayTeam : homeTeam;
    BASE_POSITIONS.forEach((pos, i) => {
        if (state.bases[i]) drawDollHead(pos.x, pos.y - 26, offT.color, 1);
    });
    FIELDERS.forEach((f, i) => {
        drawDollHead(f.x, f.y - 25, defT.color, 1);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(f.x - 15, f.y - 7, 30, 12);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px Arial";
        ctx.textAlign = "center";
        ctx.fillText("#" + defT.roster[i].number, f.x, f.y + 2);
    });
    drawBat();
    if (ball.active) {
        const lift = Math.min(BALL_FLIGHT.maxVisualLift, ball.z);
        if (ball.hit) {
            ctx.fillStyle = "rgba(0,0,0,0.25)";
            ctx.beginPath();
            ctx.ellipse(ball.x, ball.y + 2, 6 + Math.min(4, ball.z * 0.05), 3.5, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        const radius = 5 + Math.min(2.5, ball.z * 0.03);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ball.x, ball.y - lift, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    drawHUD();
    ctx.fillStyle="#fff"; ctx.font="bold 16px Courier New"; ctx.textAlign="left"; ctx.fillText(`S: ${"●".repeat(state.strikes)} B: ${"●".repeat(state.balls)} O: ${"●".repeat(state.outs)}`, 50, 70);
    if (state.msgTimer > 0) { ctx.fillStyle=COLORS.text; ctx.font="bold 40px Arial"; ctx.textAlign="center"; ctx.fillText(state.message, 300, 150); state.msgTimer--; }
    if (state.isWaiting && !state.isTop) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 200, 600, 100);
        ctx.fillStyle = "#fff";
        ctx.font = "20px Arial";
        ctx.textAlign = "center";
        ctx.fillText("WAITING...", 300, 260);
    }
    drawPitchGrid();
    if (state.screenShake > 0) ctx.restore();
}

function loop() { update(); syncMobileControls(); draw(); requestAnimationFrame(loop); }

if (gameContainer) {
    gameContainer.addEventListener('contextmenu', (e) => e.preventDefault());
}

pitchButtons.forEach((btn) => {
    btn.addEventListener('click', () => setPitchType(btn.dataset.pitch));
});

canvas.addEventListener('pointerdown', (e) => {
    if (!state.gameStarted) { state.gameStarted = true; return; }
    const pos = getCanvasPos(e.clientX, e.clientY);
    if (state.isWaiting && state.isTop) {
        const gc = getPitchGridClick(pos.x, pos.y);
        if (gc) {
            if (gc.kind === 'type') { setPitchType(gc.value); return; }
            state.gridCol = gc.col; state.gridRow = gc.row;
            pitch(PITCH_ZONE_X[gc.col], PITCH_ZONE_Y[gc.row]);
            return;
        }
        const useTouchPitch = e.pointerType === "touch" || e.pointerType === "pen";
        if (useTouchPitch) {
            activePointerId = e.pointerId;
            if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
            mobilePitchAim.active = true;
            updateMobileAim(pos.x, pos.y);
        } else {
            pitch(pos.x);
        }
    } else if (!state.isTop) {
        swing();
    }
});

canvas.addEventListener('pointermove', (e) => {
    if (!mobilePitchAim.active) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    const pos = getCanvasPos(e.clientX, e.clientY);
    updateMobileAim(pos.x, pos.y);
});

function endMobilePitch(e, cancelled = false) {
    if (activePointerId !== null && e && e.pointerId !== activePointerId) return;
    const canPitchNow = state.isWaiting && state.isTop;
    if (mobilePitchAim.active && canPitchNow && !cancelled) {
        setPitchType(mobilePitchAim.previewType);
        pitch(mobilePitchAim.x);
    }
    mobilePitchAim.active = false;
    activePointerId = null;
}

canvas.addEventListener('pointerup', (e) => endMobilePitch(e, false));
canvas.addEventListener('pointercancel', (e) => endMobilePitch(e, true));
canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === "touch") endMobilePitch(e, true);
});

window.addEventListener('keydown', (e) => {
    if (!state.gameStarted) {
        if (e.code === 'Space' ||
            e.key === 'ArrowLeft' ||
            e.key === 'ArrowRight' ||
            e.key === 'ArrowUp' ||
            e.key === 'ArrowDown') {
            e.preventDefault();
        }
        state.gameStarted = true;
        return;
    }
    if (e.code === 'Space') {
        if (state.isWaiting && state.isTop) pitch(PITCH_ZONE_X[state.gridCol], PITCH_ZONE_Y[state.gridRow]);
        else if (!state.isTop) swing();
    }
    if (state.isTop && state.isWaiting && !state.isGameOver) {
        if (e.key === 'ArrowLeft')  { state.gridCol = Math.max(0, state.gridCol - 1); e.preventDefault(); }
        if (e.key === 'ArrowRight') { state.gridCol = Math.min(2, state.gridCol + 1); e.preventDefault(); }
        if (e.key === 'ArrowUp')    { state.gridRow = Math.max(0, state.gridRow - 1); e.preventDefault(); }
        if (e.key === 'ArrowDown')  { state.gridRow = Math.min(2, state.gridRow + 1); e.preventDefault(); }
    }
    if (state.isTop) {
        if (e.key === '1') setPitchType("FAST");
        if (e.key === '2') setPitchType("CURVE");
        if (e.key === '3') setPitchType("CHANGE");
    }
});
updateBatSide(); updateScoreboard(); loop();
