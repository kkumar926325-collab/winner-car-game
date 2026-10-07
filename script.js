(() => {
'use strict';
const $ = i => document.getElementById(i);
const cv = $('game'), ctx = cv.getContext('2d');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const COLORS = ['#ff3b5c', '#ffb300', '#7c4dff', '#00e676', '#ff6d00', '#e0e0e0', '#29b6f6'];

let W = 0, H = 0, roadW, laneW, roadX, carW, carH, playerY, cityL, cityR;
let best = 0, muted = false;
try { best = +localStorage.getItem('wcg_best') || 0; muted = localStorage.getItem('wcg_mute') === '1'; } catch (e) {}

const g = { state: 'menu', score: 0, coins: 0, lives: 3, speed: 300, time: 0, px: 1, lane: 1,
  traffic: [], coin: [], parts: [], since: 0, sinceCoin: 0, inv: 0, shake: 0,
  roadOff: 0, cityOff: 0, dead: false, deadT: 0 };

/* ---------- Layout ---------- */
function strip(w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = h | 0;
  const x = c.getContext('2d'); x.fillStyle = '#090a24'; x.fillRect(0, 0, c.width, c.height);
  let y = 0;
  while (y < h) {
    const bh = Math.min(h - y, 60 + Math.random() * 90);
    x.fillStyle = `hsl(${230 + Math.random() * 50},40%,${10 + Math.random() * 8}%)`;
    x.fillRect(0, y + 4, c.width - 2, bh - 6);
    const hue = [180, 300, 50][Math.random() * 3 | 0];
    for (let wy = y + 10; wy < y + bh - 8; wy += 9)
      for (let wx = 4; wx < c.width - 8; wx += 8)
        if (Math.random() < .4) { x.fillStyle = `hsla(${hue},100%,65%,${.4 + Math.random() * .5})`; x.fillRect(wx, wy, 3, 4); }
    y += bh;
  }
  return c;
}
function resize() {
  const r = cv.parentElement.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  roadW = Math.min(W * .82, 420); laneW = roadW / 3; roadX = (W - roadW) / 2;
  carW = laneW * .58; carH = carW * 1.9; playerY = H - carH - 145;
  cityL = strip(roadX - 4, H); cityR = strip(W - roadX - roadW - 4, H);
}
const laneX = l => roadX + laneW * (l + .5);
window.addEventListener('resize', resize);

/* ---------- Audio (fails silently if unavailable) ---------- */
let ac, mg, osc, og;
function audioInit() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    ac = new A(); mg = ac.createGain(); mg.gain.value = muted ? 0 : 1; mg.connect(ac.destination);
    osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 60;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    og = ac.createGain(); og.gain.value = 0; osc.connect(lp); lp.connect(og); og.connect(mg); osc.start();
  } catch (e) { ac = null; }
}
function tone(f, d, type, v, f2) {
  if (!ac) return;
  try {
    const o = ac.createOscillator(), gn = ac.createGain(), t = ac.currentTime;
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    gn.gain.setValueAtTime(v, t); gn.gain.exponentialRampToValueAtTime(.001, t + d);
    o.connect(gn); gn.connect(mg); o.start(t); o.stop(t + d);
  } catch (e) {}
}
function noise(d) {
  if (!ac) return;
  try {
    const n = ac.sampleRate * d | 0, b = ac.createBuffer(1, n, ac.sampleRate), a = b.getChannelData(0);
    for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ac.createBufferSource(), gn = ac.createGain(); s.buffer = b; gn.gain.value = .5;
    s.connect(gn); gn.connect(mg); s.start();
  } catch (e) {}
}
const sfx = {
  coin() { tone(880, .09, 'square', .1); setTimeout(() => tone(1320, .14, 'square', .1), 70); },
  crash() { noise(.5); tone(120, .4, 'sawtooth', .3, 40); }
};
function engine() {
  if (!ac) return;
  try {
    og.gain.setTargetAtTime(g.state === 'play' ? .06 : 0, ac.currentTime, .1);
    osc.frequency.setTargetAtTime(55 + g.speed * .17, ac.currentTime, .1);
  } catch (e) {}
}
function setMute(m) {
  muted = m; $('muteBtn').textContent = m ? '🔇' : '🔊';
  if (mg) mg.gain.value = m ? 0 : 1;
  try { localStorage.setItem('wcg_mute', m ? '1' : '0'); } catch (e) {}
}

/* ---------- UI state ---------- */
const show = (el, v) => $(el).classList.toggle('hidden', !v);
function setUI(m) {
  show('start', m === 'menu'); show('pause', m === 'pause'); show('over', m === 'over');
  show('hud', m === 'play' || m === 'pause'); show('controls', m === 'play');
  show('pauseBtn', m === 'play');
  if (m === 'menu') $('sBest').textContent = best;
}
const E = { score: $('score'), hbest: $('hbest'), coins: $('coins'), speed: $('speed'), lives: $('lives') };
let cache = {};
function setLives() { E.lives.innerHTML = [0, 1, 2].map(i => `<span class="${i < g.lives ? '' : 'off'}">♥</span>`).join(''); }
function hud() {
  const s = g.score | 0, sp = Math.round(g.speed * .4);
  if (cache.s !== s) { cache.s = s; E.score.textContent = s; E.hbest.textContent = Math.max(best, s); }
  if (cache.c !== g.coins) { cache.c = g.coins; E.coins.textContent = g.coins; }
  if (cache.v !== sp) { cache.v = sp; E.speed.textContent = sp; }
}

/* ---------- Flow ---------- */
function reset() {
  Object.assign(g, { score: 0, coins: 0, lives: 3, speed: 300, time: 0, px: 1, lane: 1, traffic: [], coin: [], parts: [],
    since: 250, sinceCoin: 700, inv: 1, shake: 0, dead: false, deadT: 0 });
  cache = {}; setLives(); hud();
}
function startGame() { audioInit(); reset(); g.state = 'play'; setUI('play'); }
function pauseGame() { if (g.state !== 'play') return; g.state = 'pause'; setUI('pause'); }
function resumeGame() { if (g.state !== 'pause') return; g.state = 'play'; setUI('play'); }
function toMenu() { reset(); g.inv = 0; g.state = 'menu'; setUI('menu'); }
function finish() {
  g.state = 'over';
  const isBest = (g.score | 0) > best;
  if (isBest) { best = g.score | 0; try { localStorage.setItem('wcg_best', best); } catch (e) {} }
  $('oScore').textContent = g.score | 0; $('oCoins').textContent = g.coins; $('oBest').textContent = best;
  show('newBest', isBest); setUI('over');
}
function move(d) { if (g.state === 'play' && !g.dead) g.lane = clamp(g.lane + d, 0, 2); }

/* ---------- Gameplay ---------- */
const busy = l => g.traffic.some(o => o.lane === l && o.y < carH * 2) || g.coin.some(o => o.lane === l && o.y < carH * 2);
const shuffle = a => a.sort(() => Math.random() - .5);
function burst(x, y, n, col, sp) {
  for (let i = 0; i < n && g.parts.length < 90; i++) {
    const a = Math.random() * 6.283, v = sp * (.3 + Math.random() * .7);
    g.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .5 + Math.random() * .4, max: .9, c: col, r: 2 + Math.random() * 3 });
  }
}
function hit(t, px) {
  g.lives--; setLives(); g.shake = .5; g.inv = 1.6; sfx.crash();
  burst(px, playerY + carH / 2, 22, '#ff9100', 280); burst(px, playerY + carH / 2, 14, '#ff1744', 200);
  g.traffic = g.traffic.filter(o => o !== t);
  try { navigator.vibrate && navigator.vibrate(80); } catch (e) {}
  if (g.lives <= 0) { g.dead = true; g.deadT = .9; }
}
function update(dt) {
  if (!g.dead) {
    g.time += dt; g.speed = Math.min(300 + g.time * 9, 780); g.score += g.speed * dt * .05;
  } else {
    g.speed *= Math.max(0, 1 - dt * 2.5); g.deadT -= dt;
    if (g.deadT <= 0) { finish(); return; }
  }
  const rel = g.speed * .62;
  g.roadOff = (g.roadOff + g.speed * dt) % 80; g.cityOff += g.speed * dt * .35;
  g.px += (g.lane - g.px) * Math.min(1, dt * 14);
  g.inv = Math.max(0, g.inv - dt); g.shake = Math.max(0, g.shake - dt);

  if (!g.dead) {
    g.since += rel * dt; g.sinceCoin += rel * dt;
    if (g.since > Math.max(290, 540 - g.time * 4.5)) {
      const free = shuffle([0, 1, 2].filter(l => !busy(l)));
      const n = (g.time > 25 && Math.random() < .35) ? 2 : 1;
      free.slice(0, n).forEach(l => {
        const t = Math.random() < .2 ? 1 : (Math.random() < .3 ? 2 : 0), h = carH * (t === 1 ? 1.3 : 1);
        g.traffic.push({ lane: l, y: -h, t, c: COLORS[Math.random() * COLORS.length | 0], w: carW * (t === 1 ? 1.08 : 1), h });
      });
      if (free.length) g.since = 0;
    }
    if (g.sinceCoin > 1100) {
      const free = [0, 1, 2].filter(l => !busy(l));
      if (free.length) {
        const l = free[Math.random() * free.length | 0];
        for (let i = 0; i < 4; i++) g.coin.push({ lane: l, y: -30 - i * 60 });
        g.sinceCoin = 0;
      }
    }
  }
  g.traffic.forEach(o => o.y += rel * dt); g.coin.forEach(o => o.y += rel * dt);
  g.traffic = g.traffic.filter(o => o.y < H + o.h); g.coin = g.coin.filter(o => o.y < H + 30);

  if (!g.dead) {
    const px = laneX(g.px), cy = playerY + carH / 2;
    for (const t of g.traffic) {
      if (g.inv <= 0 && Math.abs(px - laneX(t.lane)) < (carW * .78 + t.w * .78) / 2 &&
          Math.abs(cy - (t.y + t.h / 2)) < (carH * .82 + t.h * .82) / 2) { hit(t, px); break; }
    }
    g.coin = g.coin.filter(c => {
      if (Math.abs(px - laneX(c.lane)) < carW * .6 && Math.abs(cy - c.y) < carH * .55 + 10) {
        g.coins++; g.score += 10; sfx.coin(); burst(laneX(c.lane), c.y, 10, '#ffd400', 160); return false;
      }
      return true;
    });
  }
  g.parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
  g.parts = g.parts.filter(p => p.life > 0);
}

/* ---------- Rendering ---------- */
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function drawCar(cx, y, w, h, c, t, isP) {
  if (isP) { ctx.fillStyle = 'rgba(0,240,255,.2)'; rr(cx - w / 2 - 8, y - 4, w + 16, h + 8, w * .3); ctx.fill(); }
  ctx.fillStyle = 'rgba(0,0,0,.4)'; rr(cx - w / 2 - 2, y + 5, w + 4, h, w * .2); ctx.fill();
  ctx.fillStyle = '#000';
  [.16, .66].forEach(f => { ctx.fillRect(cx - w / 2 - 3, y + h * f, 5, h * .2); ctx.fillRect(cx + w / 2 - 2, y + h * f, 5, h * .2); });
  ctx.fillStyle = c; rr(cx - w / 2, y, w, h, w * .24); ctx.fill();
  if (t === 1) {
    ctx.fillStyle = '#cfd8e3'; rr(cx - w / 2 + 3, y + h * .3, w - 6, h * .66, 4); ctx.fill();
    ctx.fillStyle = c; ctx.fillRect(cx - w / 2 + 3, y + h * .6, w - 6, h * .08);
    ctx.fillStyle = '#0b1a2e'; rr(cx - w * .36, y + h * .1, w * .72, h * .14, 4); ctx.fill();
  } else {
    if (t === 2 || isP) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(cx - w * .05, y, w * .1, h); }
    ctx.fillStyle = '#0b1a2e'; rr(cx - w * .37, y + h * .2, w * .74, h * .15, 4); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.3)'; rr(cx - w * .34, y + h * .36, w * .68, h * .26, 5); ctx.fill();
    ctx.fillStyle = '#0b1a2e'; rr(cx - w * .33, y + h * .63, w * .66, h * .1, 3); ctx.fill();
    if (isP) { ctx.fillStyle = '#fff'; ctx.fillRect(cx - w * .46, y + h * .78, w * .92, 3); ctx.fillRect(cx - w * .46, y + h * .76, 3, h * .1); ctx.fillRect(cx + w * .46 - 3, y + h * .76, 3, h * .1); }
  }
  ctx.fillStyle = '#fff6b0'; ctx.fillRect(cx - w * .4, y + 2, w * .2, h * .05); ctx.fillRect(cx + w * .2, y + 2, w * .2, h * .05);
  ctx.fillStyle = '#ff1744'; ctx.fillRect(cx - w * .42, y + h - h * .07, w * .24, h * .05); ctx.fillRect(cx + w * .18, y + h - h * .07, w * .24, h * .05);
}
function drawRoad() {
  ctx.fillStyle = '#05051a'; ctx.fillRect(0, 0, W, H);
  const off = g.cityOff % H, rx = roadX + roadW + 4;
  ctx.drawImage(cityL, 0, off - H); ctx.drawImage(cityL, 0, off);
  ctx.drawImage(cityR, rx, off - H); ctx.drawImage(cityR, rx, off);
  const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0c0c22'); gr.addColorStop(1, '#181833');
  ctx.fillStyle = gr; ctx.fillRect(roadX, 0, roadW, H);
  ctx.fillStyle = 'rgba(0,240,255,.25)'; ctx.fillRect(roadX - 6, 0, 8, H);
  ctx.fillStyle = 'rgba(255,43,214,.25)'; ctx.fillRect(roadX + roadW - 2, 0, 8, H);
  ctx.fillStyle = '#00f0ff'; ctx.fillRect(roadX - 3, 0, 3, H);
  ctx.fillStyle = '#ff2bd6'; ctx.fillRect(roadX + roadW, 0, 3, H);
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  for (let l = 1; l < 3; l++) for (let y = g.roadOff - 80; y < H; y += 80) ctx.fillRect(roadX + laneW * l - 2, y, 4, 40);
}
function draw() {
  ctx.save();
  if (g.shake > 0) ctx.translate((Math.random() - .5) * g.shake * 18, (Math.random() - .5) * g.shake * 18);
  drawRoad();
  g.coin.forEach(c => {
    const x = laneX(c.lane), w = Math.abs(Math.cos(g.time * 5 + c.y * .02)) * 9 + 3;
    ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.ellipse(x, c.y, w, 11, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#c78a00'; ctx.beginPath(); ctx.ellipse(x, c.y, w * .55, 6.5, 0, 0, 6.283); ctx.fill();
  });
  g.traffic.forEach(t => drawCar(laneX(t.lane), t.y, t.w, t.h, t.c, t.t, false));
  if (!g.dead && !(g.inv > 0 && ((g.time * 14) | 0) % 2)) {
    const cx = laneX(g.px);
    const lg = ctx.createLinearGradient(0, playerY, 0, playerY - 230);
    lg.addColorStop(0, 'rgba(255,255,200,.22)'); lg.addColorStop(1, 'rgba(255,255,200,0)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(cx - carW * .4, playerY); ctx.lineTo(cx + carW * .4, playerY);
    ctx.lineTo(cx + carW * .9, playerY - 230); ctx.lineTo(cx - carW * .9, playerY - 230); ctx.fill();
    ctx.save(); ctx.translate(cx, playerY + carH / 2); ctx.rotate((g.lane - g.px) * .35);
    drawCar(0, -carH / 2, carW, carH, '#00e5ff', 2, true); ctx.restore();
  }
  g.parts.forEach(p => { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.r, p.r); });
  ctx.globalAlpha = 1; ctx.restore();
  if (g.shake > 0) { ctx.fillStyle = `rgba(255,23,68,${g.shake * .35})`; ctx.fillRect(0, 0, W, H); }
}

/* ---------- Main loop ---------- */
let last = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min((t - last) / 1000 || 0, .05); last = t;
  if (g.state === 'play') { update(dt); hud(); }
  else if (g.state === 'menu' || g.state === 'over') {
    g.roadOff = (g.roadOff + 220 * dt) % 80; g.cityOff += 80 * dt;
    g.parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }); g.parts = g.parts.filter(p => p.life > 0);
    g.shake = Math.max(0, g.shake - dt);
  }
  draw(); engine();
}

/* ---------- Input ---------- */
const press = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); audioInit(); fn(); });
press('playBtn', startGame); press('restartBtn', startGame); press('pRestart', startGame);
press('resumeBtn', resumeGame); press('pauseBtn', pauseGame);
press('menuBtn', toMenu); press('pMenu', toMenu);
press('muteBtn', () => setMute(!muted));
press('left', () => move(-1)); press('right', () => move(1));

const app = $('app'); let sx = null, sy = 0;
app.addEventListener('pointerdown', e => { audioInit(); if (e.target.closest('button')) return; sx = e.clientX; sy = e.clientY; });
app.addEventListener('pointermove', e => {
  if (sx === null) return;
  const dx = e.clientX - sx, dy = e.clientY - sy;
  if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * .8) { move(dx > 0 ? 1 : -1); sx = e.clientX; sy = e.clientY; }
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(n => app.addEventListener(n, () => { sx = null; }));
app.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
window.addEventListener('keydown', e => {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') move(-1);
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') move(1);
  else if (k === 'p' || k === 'P' || k === 'Escape') g.state === 'play' ? pauseGame() : resumeGame();
  else if (k === 'Enter' && (g.state === 'menu' || g.state === 'over')) startGame();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

/* ---------- Init ---------- */
resize(); setMute(muted); reset(); g.inv = 0; setUI('menu');
requestAnimationFrame(loop);
})();

