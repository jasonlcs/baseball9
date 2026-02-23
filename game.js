const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = 600;
canvas.height = 600;

const COLORS = {
    grassLight: "#43a047", grassDark: "#388e3c",
    dirt: "#bcaaa4", dirtDark: "#8d6e63",
    lines: "#ffffff", batMain: "#f5f5f5", batGrip: "#4e342e",
    ball: "#ffffff", stadium: "#1a237e", text: "#ffd600",
    panel: "rgba(0, 0, 0, 0.8)",
    activeBase: "#ffeb3b"
};

const PITCH_TYPES = {
    FAST: { name: "FAST", speedMult: 1.2, cost: 5, color: "#fff" },
    CURVE: { name: "CURVE", speedMult: 0.9, cost: 3, color: "#4fc3f7" },
    CHANGE: { name: "CHANGE", speedMult: 0.6, cost: 2, color: "#ffd600" }
};

// --- 系統初始化 ---
function createPlayer(teamColor) {
    return {
        number: Math.floor(Math.random() * 99) + 1,
        batSide: Math.random() < 0.5 ? "L" : "R",
        power: 0.8 + Math.random() * 0.5,
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
    charge: 20, chargeDir: 1, chargeSpeed: 0.7,
    pitchPath: [], hitPath: [], lastSpot: null,
    fieldersResetting: false,
    autoPitchTimer: 120, nextInningTimer: 0,
    isGameOver: false,
    screenShake: 0,
    swungThisPitch: false // 關鍵：記錄該球是否有揮棒
};

const PITCHER_POS = { x: 300, y: 400 };
const HOME_PLATE = { x: 300, y: 560 };
const STRIKE_ZONE = { x: 270, y: 510, w: 60, h: 50 };

let ball = { x: 0, y: 0, vx: 0, vy: 0, active: false, hit: false, wasInZone: false, caught: false, resultChecked: false, type: "FAST", speed: 2.2 };
let bat = { angle: 0, swinging: false, speed: 0.2, pivot: {x:0, y:0}, dir: 1, base: 0, target: 0 };

const FIELDERS = [
    { id: "CF", x: 300, y: 100 }, { id: "LF", x: 150, y: 180 }, { id: "RF", x: 450, y: 180 },
    { id: "SS", x: 220, y: 300 }, { id: "2B", x: 380, y: 300 }, { id: "3B", x: 180, y: 440 }, { id: "1B", x: 420, y: 440 }
].map(f => ({ ...f, homeX: f.x, homeY: f.y, speed: 1.0 + Math.random() }));

// --- 輔助函式 ---
function showMessage(msg) { state.message = msg; state.msgTimer = 90; }

function updateScoreboard() {
    const awayEl = document.getElementById('score-away');
    const homeEl = document.getElementById('score-home');
    const inningEl = document.getElementById('inning');
    if (awayEl) awayEl.innerText = state.scoreAway;
    if (homeEl) homeEl.innerText = state.scoreHome;
    if (inningEl) inningEl.innerText = state.inning + (state.isTop ? " TOP" : " BOT");
}

function getCurrentBatter() {
    const team = state.isTop ? awayTeam : homeTeam;
    return team.roster[team.order];
}

function getNextBatter() {
    const team = state.isTop ? awayTeam : homeTeam;
    return team.roster[(team.order + 1) % 9];
}

function updateBatSide() {
    const batter = getCurrentBatter();
    bat.swinging = false;
    if (batter.batSide === "R") {
        bat.pivot = { x: 270, y: 555 }; bat.base = -0.15 * Math.PI; bat.target = -0.95 * Math.PI; bat.dir = -1;
    } else {
        bat.pivot = { x: 330, y: 555 }; bat.base = 1.15 * Math.PI; bat.target = 1.95 * Math.PI; bat.dir = 1;
    }
    bat.angle = bat.base;
}

function pitch(tx = null) {
    if (ball.active || state.fieldersResetting || state.isGameOver) return;
    const team = state.isTop ? homeTeam : awayTeam;
    const p = team.roster[7];
    const pData = PITCH_TYPES[state.isTop ? state.pitchType : "FAST"];
    
    state.isWaiting = false; state.pitchPath = []; state.hitPath = [];
    state.swungThisPitch = false; // 重置揮棒記錄
    ball.active = true; ball.hit = false; ball.wasInZone = false; ball.caught = false; ball.resultChecked = false;
    ball.x = PITCHER_POS.x; ball.y = PITCHER_POS.y;
    ball.type = state.isTop ? state.pitchType : "FAST";
    
    let bSpeed = 2.5 * pData.speedMult * (p.stamina > 30 ? 1 : 0.7);
    const time = (HOME_PLATE.y - PITCHER_POS.y) / bSpeed;
    
    if (tx === null) tx = 280 + Math.random() * 40;
    ball.vx = (tx - PITCHER_POS.x) / time;
    ball.vy = bSpeed;
    p.stamina = Math.max(0, p.stamina - pData.cost);
}

function swing() {
    if (bat.swinging || !ball.active || ball.hit) return;
    bat.swinging = true;
    state.swungThisPitch = true; // 記錄本次有揮棒
    bat.speed = 0.18 + (state.charge / 100) * 0.22;
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
    
    if (ball.hit) {
        const angle = Math.atan2(ball.y - HOME_PLATE.y, ball.x - HOME_PLATE.x);
        const isFoul = (ball.y > HOME_PLATE.y) || (angle < -2.4 || angle > -0.7);
        if (isFoul) { 
            if (state.strikes < 2) state.strikes++; 
            showMessage("FOUL"); 
        } else if (ball.caught) { 
            state.outs++; showMessage("OUT!"); 
            team.order = (team.order + 1) % 9; updateBatSide();
        } else {
            const d = Math.sqrt((ball.x - HOME_PLATE.x)**2 + (ball.y - HOME_PLATE.y)**2);
            state.strikes = 0; state.balls = 0;
            if (d > 500) { advance(4); showMessage("HOME RUN!!"); }
            else if (d > 350) { advance(2); showMessage("DOUBLE"); }
            else if (d > 160) { advance(1); showMessage("SINGLE"); }
            else { state.outs++; showMessage("OUT"); }
            team.order = (team.order + 1) % 9; updateBatSide();
        }
    } else {
        // --- 修正規則：只要有揮棒就算好球 ---
        if (state.swungThisPitch) { 
            state.strikes++; 
            showMessage("MISS!"); 
        } else if (ball.wasInZone) { 
            state.strikes++; 
            showMessage("STRIKE!"); 
        } else { 
            state.balls++; 
            showMessage("BALL"); 
        }
    }

    if (state.strikes >= 3) { state.outs++; state.strikes = 0; state.balls = 0; team.order = (team.order + 1) % 9; updateBatSide(); showMessage("K!"); }
    if (state.balls >= 4) { advance(1, true); state.strikes = 0; state.balls = 0; team.order = (team.order + 1) % 9; updateBatSide(); showMessage("WALK"); }
    
    if (state.outs >= 3) state.nextInningTimer = 100;
    else state.isWaiting = true;
}

function update() {
    if (state.isGameOver) return;
    if (state.nextInningTimer > 0) {
        state.nextInningTimer--;
        if (state.nextInningTimer === 1) {
            state.isTop = !state.isTop; state.outs = 0; state.strikes = 0; state.balls = 0; state.bases = [false, false, false];
            if (state.isTop) state.inning++;
            if (state.inning > 9) state.isGameOver = true;
            updateBatSide(); state.isWaiting = true; updateScoreboard();
        }
    }

    if (!bat.swinging) { state.charge += state.chargeSpeed * state.chargeDir; if (state.charge >= 100 || state.charge <= 20) state.chargeDir *= -1; }

    let allIn = true;
    FIELDERS.forEach(f => {
        const dx = f.homeX - f.x; const dy = f.homeY - f.y; const dist = Math.sqrt(dx*dx+dy*dy);
        if (dist > 2) { f.x += dx*0.05; f.y += dy*0.05; allIn = false; } else { f.x = f.homeX; f.y = f.homeY; }
    });
    state.fieldersResetting = !allIn;

    if (!state.isTop && state.isWaiting && !state.fieldersResetting && state.nextInningTimer <= 0) {
        state.autoPitchTimer--; if (state.autoPitchTimer <= 0) { pitch(); state.autoPitchTimer = 150; }
    }

    if (ball.active) {
        if (!ball.hit) state.pitchPath.push({x: ball.x, y: ball.y}); else state.hitPath.push({x: ball.x, y: ball.y});
        let vy = ball.vy; if (ball.y > 480 && ball.y < 540 && !ball.hit) vy *= 0.5;
        ball.x += ball.vx; ball.y += vy;
        if (ball.x > STRIKE_ZONE.x && ball.x < STRIKE_ZONE.x+STRIKE_ZONE.w && ball.y > STRIKE_ZONE.y && ball.y < STRIKE_ZONE.y+STRIKE_ZONE.h) ball.wasInZone = true;
        if (ball.hit) { ball.vx *= 0.99; ball.vy *= 0.99; }

        FIELDERS.forEach(f => {
            if (ball.hit && !ball.caught) {
                const dx = ball.x - f.x; const dy = ball.y - f.y; const d = Math.sqrt(dx*dx+dy*dy);
                if (d > 5) { f.x += dx*0.03; f.y += dy*0.03; }
                if (d < 25 && Math.random() < 0.1) { ball.caught = true; ball.vx = 0; ball.vy = 0; }
            }
        });

        if (!ball.hit && bat.swinging) {
            const dx = ball.x - bat.pivot.x; const dy = ball.y - bat.pivot.y; const dist = Math.sqrt(dx*dx+dy*dy);
            if (dist < 80 && dist > 10) {
                const ang = Math.atan2(dy, dx);
                let diff = ang - bat.angle; while(diff > Math.PI) diff -= Math.PI*2; while(diff < -Math.PI) diff += Math.PI*2;
                if (Math.abs(diff) < 0.5) {
                    ball.hit = true; state.screenShake = 10;
                    const p = (12 + (state.charge/100) * 10) * getCurrentBatter().power;
                    ball.vx = Math.cos(bat.angle + (Math.PI/2*bat.dir)) * p; ball.vy = Math.sin(bat.angle + (Math.PI/2*bat.dir)) * p;
                }
            }
        }
        if (state.isTop && ball.active && !ball.hit && ball.y > 500 && Math.random() < 0.05) swing();
        if (ball.y < 0 || ball.y > 600 || ball.x < 0 || ball.x > 600 || (ball.hit && Math.abs(ball.vx) < 0.1)) { checkResult(); ball.active = false; }
    }

    if (bat.swinging) {
        bat.angle += bat.speed * bat.dir;
        if (bat.dir === -1 ? bat.angle < bat.target : bat.angle > bat.target) bat.swinging = false;
    } else { bat.angle += (bat.base - bat.angle) * 0.1; }
}

function drawHUD() {
    ctx.fillStyle = COLORS.panel; ctx.fillRect(20, 450, 100, 100);
    ctx.strokeStyle = "#fff"; ctx.strokeRect(20, 450, 100, 100);
    const drawBase = (x, y, occupied) => {
        ctx.fillStyle = occupied ? COLORS.activeBase : "rgba(255,255,255,0.2)";
        ctx.beginPath(); ctx.moveTo(x, y-10); ctx.lineTo(x+10, y); ctx.lineTo(x, y+10); ctx.lineTo(x-10, y); ctx.fill();
    };
    drawBase(95, 500, state.bases[0]); drawBase(70, 475, state.bases[1]); drawBase(45, 500, state.bases[2]);
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px Arial"; ctx.textAlign = "center"; ctx.fillText("BASES", 70, 540);

    ctx.fillStyle = COLORS.panel; ctx.fillRect(400, 450, 180, 100);
    ctx.strokeStyle = "#fff"; ctx.strokeRect(400, 450, 180, 100);
    const curr = getCurrentBatter(); const next = getNextBatter();
    ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.fillText("LINEUP", 410, 470);
    ctx.fillStyle = COLORS.text; ctx.fillText(`CUR: #${curr.number} (${curr.batSide})`, 410, 495);
    ctx.fillStyle = "#aaa"; ctx.fillText(`NXT: #${next.number} (${next.batSide})`, 410, 520);
    ctx.fillText(`TEAM: ${state.isTop ? "AWAY" : "HOME"}`, 410, 540);
}

function draw() {
    ctx.clearRect(0, 0, 600, 600);
    if (state.screenShake > 0) { ctx.save(); ctx.translate((Math.random()-0.5)*state.screenShake, (Math.random()-0.5)*state.screenShake); state.screenShake *= 0.8; }
    const gs = 40; for(let y=0; y<15; y++) for(let x=0; x<15; x++) { ctx.fillStyle = (x+y)%2==0?COLORS.grassLight:COLORS.grassDark; ctx.fillRect(x*gs, y*gs, gs, gs); }
    ctx.fillStyle = COLORS.stadium; ctx.fillRect(0,0,600,40); ctx.fillRect(0,560,600,40); ctx.fillRect(0,0,40,600); ctx.fillRect(560,0,40,600);
    ctx.fillStyle = COLORS.dirt; ctx.beginPath(); ctx.moveTo(300,560); ctx.lineTo(480,400); ctx.lineTo(300,240); ctx.lineTo(120,400); ctx.fill();
    ctx.fillStyle = COLORS.dirtDark; ctx.beginPath(); ctx.arc(300,400,25,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillRect(288, 398, 24, 4);
    ctx.beginPath(); ctx.moveTo(300,545); ctx.lineTo(315,557); ctx.lineTo(315,575); ctx.lineTo(285,575); ctx.lineTo(285,557); ctx.fill();
    const defTeam = state.isTop ? homeTeam : awayTeam;
    FIELDERS.forEach((f, i) => {
        ctx.save(); ctx.translate(f.x, f.y-25); ctx.fillStyle = "#ffccbc"; ctx.beginPath(); ctx.arc(0,0,16,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = defTeam.color; ctx.beginPath(); ctx.arc(0,0,16,Math.PI,0); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "9px Arial"; ctx.textAlign="center"; ctx.fillText("#"+defTeam.roster[i].number, 0, 25); ctx.restore();
    });
    ctx.save(); ctx.translate(bat.pivot.x, bat.pivot.y); ctx.rotate(bat.angle); ctx.fillStyle = COLORS.batGrip; ctx.fillRect(0,-4,25,8); ctx.fillStyle = COLORS.batMain; ctx.fillRect(25,-10,50,20); ctx.restore();
    if (ball.active) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ball.x, ball.y, 5, 0, Math.PI*2); ctx.fill(); }
    drawHUD();
    ctx.fillStyle="#fff"; ctx.font="bold 16px Courier New"; ctx.textAlign="left";
    ctx.fillText(`S: ${"●".repeat(state.strikes)} B: ${"●".repeat(state.balls)} O: ${"●".repeat(state.outs)}`, 50, 70);
    const barX = 380; ctx.fillStyle="#333"; ctx.fillRect(barX,520,15,60); ctx.fillStyle=state.charge>85?"#f00":"#ffd600"; ctx.fillRect(barX,580-(state.charge/100*60),15,state.charge/100*60);
    if (state.msgTimer > 0) { ctx.fillStyle=COLORS.text; ctx.font="bold 40px Arial"; ctx.textAlign="center"; ctx.fillText(state.message, 300, 150); state.msgTimer--; }
    if (state.isWaiting) { ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(0,200,600,100); ctx.fillStyle="#fff"; ctx.font="20px Arial"; ctx.textAlign="center"; ctx.fillText(state.isTop?"CLICK TO PITCH":"WAITING FOR PITCH...", 300, 260); }
    if (state.screenShake > 0) ctx.restore();
}

function loop() { update(); draw(); requestAnimationFrame(loop); }
window.addEventListener('mousedown', (e) => { if (state.isWaiting && state.isTop) { const r = canvas.getBoundingClientRect(); pitch(e.clientX - r.left); } else if (!state.isTop) swing(); });
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { if (state.isWaiting && state.isTop) pitch(); else if (!state.isTop) swing(); } if (state.isTop) { if (e.key === '1') state.pitchType = "FAST"; if (e.key === '2') state.pitchType = "CURVE"; if (e.key === '3') state.pitchType = "CHANGE"; } });
updateBatSide(); updateScoreboard(); loop();
