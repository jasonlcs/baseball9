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

// --- 球員與隊伍系統 ---
function createPlayer(teamColor) {
    return {
        number: Math.floor(Math.random() * 99) + 1,
        batSide: Math.random() < 0.5 ? "L" : "R",
        power: 0.85 + Math.random() * 0.45,
        speed: 1.0 + Math.random() * 1.5,
        stamina: 100
    };
}

function createTeam(name, color) {
    let players = [];
    for(let i=0; i<9; i++) players.push(createPlayer(color));
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
    swungThisPitch: false
};

const PITCHER_POS = { x: 300, y: 400 };
const HOME_PLATE = { x: 300, y: 560 };
const STRIKE_ZONE = { x: 270, y: 510, w: 60, h: 50 };
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
    { id: "CF", x: 300, y: 100, coverageRange: 200 },
    { id: "LF", x: 150, y: 180, coverageRange: 180 },
    { id: "RF", x: 450, y: 180, coverageRange: 180 },
    { id: "SS", x: 220, y: 300, coverageRange: 130 },
    { id: "2B", x: 380, y: 300, coverageRange: 130 },
    { id: "3B", x: 180, y: 440, coverageRange: 110 },
    { id: "1B", x: 420, y: 440, coverageRange: 110 }
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
            ? `手機投球：按住球場拖曳瞄準，放開出手（${state.pitchType}）`
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

function pitch(tx = null) {
    if (ball.active || state.fieldersResetting || state.isGameOver) return;
    const p = getCurrentPitcher();
    const pData = PITCH_TYPES[state.pitchType];
    state.isWaiting = false; state.pitchPath = []; state.hitPath = []; state.lastSpot = null;
    state.swungThisPitch = false; state.showPowerTimer = 0;
    ball.active = true; ball.hit = false; ball.wasInZone = false; ball.caught = false; ball.resultChecked = false; ball.isHBP = false; ball.hitFrames = 0;
    ball.x = PITCHER_POS.x; ball.y = PITCHER_POS.y; ball.z = 0; ball.vz = 0;
    ball.type = state.pitchType;
    let bSpeed = GAME_SPEED.pitchBase * pData.speedMult * (p.stamina > 30 ? 1 : 0.7);
    const time = (HOME_PLATE.y - PITCHER_POS.y) / bSpeed;
    if (tx === null) tx = 280 + Math.random() * 40;
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
// Returns { pitchType, targetX } recommendation based on batter tendencies
// and game context (inning, runners on base, count).
function getCatcherRecommendation() {
    const batter = getCurrentBatter();

    // Right-handed batters pull to left (negative x), left-handed pull to right (positive x)
    const pullBias = batter.batSide === "R" ? -1 : 1;
    let targetX = 300 + pullBias * 25;
    let pitchType = "FAST";

    // Power hitters: mix in off-speed to disrupt timing
    if (batter.power > 1.1) {
        pitchType = Math.random() < CATCHER_STRATEGY.offSpeedMixProb ? "CURVE" : "CHANGE";
    }

    // Runners in scoring position (2nd or 3rd base): prioritise strikes with fastball
    if (state.bases[1] || state.bases[2]) {
        pitchType = "FAST";
        targetX = 300; // Reduce walk risk with centred target
    }

    // 2-strike count: go for strikeout or waste pitch away from pull side
    if (state.strikes === 2) {
        pitchType = Math.random() < CATCHER_STRATEGY.twoStrikeFastballProb ? "FAST" : "CURVE";
        targetX = 300 - pullBias * 15;
    }

    // Late innings with a lead: mix off-speed to avoid extra-base hits
    const teamLead = state.isTop ? state.scoreAway - state.scoreHome : state.scoreHome - state.scoreAway;
    if (state.inning >= 7 && teamLead > 2) {
        if (Math.random() < CATCHER_STRATEGY.lateInningOffSpeedProb) pitchType = "CURVE";
    }

    return { pitchType, targetX };
}

function update() {
    if (state.isGameOver) return;
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
    if (!state.isTop && state.isWaiting && !state.fieldersResetting) { state.autoPitchTimer--; if (state.autoPitchTimer <= 0) { const rec = getCatcherRecommendation(); setPitchType(rec.pitchType); pitch(rec.targetX); state.autoPitchTimer = 150; } }
    if (ball.active) {
        if (!ball.hit) state.pitchPath.push({x: ball.x, y: ball.y});
        let vy = ball.vy;
        if (ball.y > 480 && ball.y < 540 && !ball.hit) vy *= 0.5;
        let motionScale = 1;
        if (ball.hit) {
            ball.hitFrames++;
            const t = Math.min(1, ball.hitFrames / 26);
            motionScale = 0.42 + (0.58 * t); // brief bullet-time feel on contact
        }
        ball.x += ball.vx * motionScale;
        ball.y += vy * motionScale;
        if (ball.hit) {
            ball.z = Math.max(0, ball.z + ball.vz * motionScale);
            ball.vz -= BALL_FLIGHT.gravity * motionScale;
            if (ball.z === 0 && ball.vz < 0) ball.vz = 0;
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
    if (!(isMobileInput && state.isTop && state.isWaiting)) return;
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

function drawHUD() {
    ctx.fillStyle = COLORS.panel; ctx.fillRect(20, 450, 100, 100); ctx.strokeStyle = "#fff"; ctx.strokeRect(20, 450, 100, 100);
    const drawB = (x, y, occ) => { ctx.fillStyle = occ ? COLORS.activeBase : "rgba(255,255,255,0.2)"; ctx.beginPath(); ctx.moveTo(x, y-10); ctx.lineTo(x+10, y); ctx.lineTo(x, y+10); ctx.lineTo(x-10, y); ctx.fill(); };
    drawB(95, 500, state.bases[0]); drawB(70, 475, state.bases[1]); drawB(45, 500, state.bases[2]);
    const offenseTeam = state.isTop ? awayTeam : homeTeam;
    if (state.bases[0]) drawDollHead(101, 494, offenseTeam.color, 0.25);
    if (state.bases[1]) drawDollHead(76, 469, offenseTeam.color, 0.25);
    if (state.bases[2]) drawDollHead(51, 494, offenseTeam.color, 0.25);
    if (state.showPowerTimer > 0) { const barX = 380; ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(barX-5, 515, 25, 70); ctx.fillStyle = "#333"; ctx.fillRect(barX, 520, 15, 60); ctx.fillStyle = state.lockedCharge > 85 ? "#f00" : "#ffd600"; const h = (state.lockedCharge / 100) * 60; ctx.fillRect(barX, 580 - h, 15, h); ctx.strokeStyle = "#fff"; ctx.strokeRect(barX, 520, 15, 60); }
    const b = getCurrentBatter(); const p = getCurrentPitcher();
    ctx.fillStyle = COLORS.panel; ctx.fillRect(400, 450, 180, 100); ctx.textAlign = "left"; ctx.fillStyle = COLORS.text;
    ctx.fillText(`CUR: #${b.number} (${b.batSide})`, 410, 470); ctx.fillText(`PWR: ${(b.power*100).toFixed(0)}%`, 410, 485);
    ctx.fillStyle = COLORS.panel; ctx.fillRect(20, 130, 150, 60); ctx.fillStyle="#fff"; ctx.fillText(`PITCHER: #${p.number}`, 30, 145); ctx.fillStyle="#444"; ctx.fillRect(30, 155, 100, 6); ctx.fillStyle=p.stamina>30?"#4caf50":"#f44336"; ctx.fillRect(30, 155, p.stamina, 6);
}

function draw() {
    ctx.clearRect(0, 0, 600, 600);
    if (state.screenShake > 0) { ctx.save(); ctx.translate((Math.random()-0.5)*state.screenShake, (Math.random()-0.5)*state.screenShake); state.screenShake *= 0.8; }
    const gs = 40; for(let y=0; y<15; y++) for(let x=0; x<15; x++) { ctx.fillStyle = (x+y)%2==0?COLORS.grassLight:COLORS.grassDark; ctx.fillRect(x*gs, y*gs, gs, gs); }
    ctx.fillStyle = COLORS.stadium; ctx.fillRect(0,0,600,40); ctx.fillRect(0,560,600,40); ctx.fillRect(0,0,40,600); ctx.fillRect(560,0,40,600);
    ctx.fillStyle = COLORS.dirt; ctx.beginPath(); ctx.moveTo(300,560); ctx.lineTo(480,400); ctx.lineTo(300,240); ctx.lineTo(120,400); ctx.fill();
    BASE_POSITIONS.forEach((pos, i) => drawBaseBag(pos.x, pos.y, state.bases[i]));
    drawMobilePitchReticle();
    ctx.setLineDash([4,4]); ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.beginPath(); ctx.moveTo(300,400); state.pitchPath.forEach(p=>ctx.lineTo(p.x,p.y)); ctx.stroke();
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
    if (state.isWaiting) {
        const waitText = state.isTop ? (isMobileInput ? "TOUCH DRAG & RELEASE" : "CLICK TO PITCH") : "WAITING...";
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 200, 600, 100);
        ctx.fillStyle = "#fff";
        ctx.font = "20px Arial";
        ctx.textAlign = "center";
        ctx.fillText(waitText, 300, 260);
    }
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
    const pos = getCanvasPos(e.clientX, e.clientY);
    if (state.isWaiting && state.isTop) {
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
    if (e.code === 'Space') {
        if (state.isWaiting && state.isTop) pitch();
        else if (!state.isTop) swing();
    }
    if (state.isTop) {
        if (e.key === '1') setPitchType("FAST");
        if (e.key === '2') setPitchType("CURVE");
        if (e.key === '3') setPitchType("CHANGE");
    }
});
updateBatSide(); updateScoreboard(); loop();
pitch();
