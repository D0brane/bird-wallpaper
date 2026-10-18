const canvas = document.getElementById("sky");
const ctx = canvas.getContext("2d");
const panel = document.getElementById("panel");
const pauseBtn = document.getElementById("pause");
const statusEl = document.getElementById("status");

const params = {
  sep: 1.4,
  ali: 1.1,
  coh: 0.6,
  evade: 2.4,
  perception: 103,
  threat: 168,
  mouseThreshold: 47,
  iconThreat: 57,
  iconThreshold: 65,
  iconEvade: 1.5,
  maxSpeed: 208,
  count: 415,
  birdSize: 22,
  forceFilter: 48,
  moveFilter: 48,
  headFilter: 18,
  fearFilter: 48,
};

const THREAT_FADE = 0.8;
const FALCON_SPEED_CAP = 720;

const boids = [];
const stars = [];
const neighborBuf = [];
let width = 0;
let height = 0;
let paused = false;
let playbackPaused = false;
let frameId = 0;
let frightened = -1;
let lastTime = performance.now();
let backgroundImage = null;
let birdImage = null;
let birdFearTint = null;
let iconPoints = [];
let iconFetchBusy = false;
let nextIconFetch = 0;
let livelyBootCollapsed = false;

const falcon = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  threat: 0,
  present: false,
  hasSample: false,
  sampleT: 0,
};

function makeStars() {
  stars.length = 0;
  for (let i = 0; i < 90; i += 1) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.15 + 0.25,
      a: Math.random() * 0.35 + 0.08,
    });
  }
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function maxForce() {
  return params.maxSpeed * 3.2;
}

function limit(x, y, max) {
  const mag = Math.hypot(x, y);
  if (mag > max && mag > 0) {
    const scale = max / mag;
    return { x: x * scale, y: y * scale };
  }
  return { x, y };
}

function wrapDelta(delta, size) {
  if (size <= 0) return delta;
  let wrapped = delta % size;
  if (wrapped > size * 0.5) wrapped -= size;
  else if (wrapped < -size * 0.5) wrapped += size;
  return wrapped;
}

function approachAngle(current, target, blend) {
  let delta = target - current;
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * blend;
}

function wrapCoord(value, size) {
  if (size <= 0) return 0;
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

function spawn(x, y) {
  const angle = Math.random() * Math.PI * 2;
  const speed = params.maxSpeed * (0.45 + Math.random() * 0.55);
  boids.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    ax: 0,
    ay: 0,
    sx: x,
    sy: y,
    fear: 0,
    fearTarget: 0,
    heading: angle,
    tint: Math.random(),
  });
}

function flockPoint() {
  return {
    x: width * 0.58,
    y: height * 0.5,
  };
}

function randomInFlock() {
  const center = flockPoint();
  const angle = Math.random() * Math.PI * 2;
  const radius = 24 + Math.random() * 78;
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function nearCentroid() {
  let x = 0;
  let y = 0;
  for (let i = 0; i < boids.length; i += 1) {
    x += boids[i].x;
    y += boids[i].y;
  }
  const n = boids.length || 1;
  const angle = Math.random() * Math.PI * 2;
  const dist = 16 + Math.random() * 70;
  return {
    x: x / n + Math.cos(angle) * dist,
    y: y / n + Math.sin(angle) * dist,
  };
}

function resetFlock() {
  boids.length = 0;
  for (let i = 0; i < params.count; i += 1) {
    const point = randomInFlock();
    spawn(point.x, point.y);
  }
}

function syncCount() {
  while (boids.length < params.count) {
    const point = boids.length ? nearCentroid() : randomInFlock();
    spawn(point.x, point.y);
  }
  if (boids.length > params.count) boids.length = params.count;
}

function cellKey(cx, cy) {
  return (cx + 8000) * 20000 + (cy + 8000);
}

function addToGrid(buckets, x, y, index, cell) {
  const key = cellKey(Math.floor(x / cell), Math.floor(y / cell));
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = [];
    buckets.set(key, bucket);
  }
  bucket.push(index);
}

function buildGrid(cell, radius) {
  const buckets = new Map();
  for (let i = 0; i < boids.length; i += 1) {
    const boid = boids[i];
    addToGrid(buckets, boid.x, boid.y, i, cell);
    const left = boid.x < radius;
    const right = boid.x > width - radius;
    const top = boid.y < radius;
    const bottom = boid.y > height - radius;
    if (left) addToGrid(buckets, boid.x + width, boid.y, i, cell);
    if (right) addToGrid(buckets, boid.x - width, boid.y, i, cell);
    if (top) addToGrid(buckets, boid.x, boid.y + height, i, cell);
    if (bottom) addToGrid(buckets, boid.x, boid.y - height, i, cell);
    if (left && top) addToGrid(buckets, boid.x + width, boid.y + height, i, cell);
    if (left && bottom) addToGrid(buckets, boid.x + width, boid.y - height, i, cell);
    if (right && top) addToGrid(buckets, boid.x - width, boid.y + height, i, cell);
    if (right && bottom) addToGrid(buckets, boid.x - width, boid.y - height, i, cell);
  }
  return buckets;
}

function queryNeighbors(index, radius, cell, buckets) {
  neighborBuf.length = 0;
  const boid = boids[index];
  const radiusSq = radius * radius;
  const x0 = Math.floor((boid.x - radius) / cell);
  const x1 = Math.floor((boid.x + radius) / cell);
  const y0 = Math.floor((boid.y - radius) / cell);
  const y1 = Math.floor((boid.y + radius) / cell);
  for (let cx = x0; cx <= x1; cx += 1) {
    for (let cy = y0; cy <= y1; cy += 1) {
      const bucket = buckets.get(cellKey(cx, cy));
      if (!bucket) continue;
      for (let k = 0; k < bucket.length; k += 1) {
        const j = bucket[k];
        if (j === index) continue;
        const other = boids[j];
        const dx = wrapDelta(other.x - boid.x, width);
        const dy = wrapDelta(other.y - boid.y, height);
        if (dx * dx + dy * dy <= radiusSq && !neighborBuf.includes(j)) neighborBuf.push(j);
      }
    }
  }
  return neighborBuf;
}

function steerToward(boid, desiredX, desiredY) {
  return limit(desiredX - boid.vx, desiredY - boid.vy, maxForce());
}

function separation(boid, neighbors, radius) {
  let sx = 0;
  let sy = 0;
  let count = 0;
  const radiusSq = radius * radius;
  for (let i = 0; i < neighbors.length; i += 1) {
    const other = boids[neighbors[i]];
    const dx = wrapDelta(boid.x - other.x, width);
    const dy = wrapDelta(boid.y - other.y, height);
    const distSq = dx * dx + dy * dy;
    if (distSq > 0 && distSq < radiusSq) {
      const dist = Math.sqrt(distSq);
      sx += dx / dist / dist;
      sy += dy / dist / dist;
      count += 1;
    }
  }
  if (!count) return { x: 0, y: 0 };
  const mag = Math.hypot(sx, sy) || 1;
  return steerToward(boid, (sx / mag) * params.maxSpeed, (sy / mag) * params.maxSpeed);
}

function alignment(boid, neighbors) {
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < neighbors.length; i += 1) {
    const other = boids[neighbors[i]];
    vx += other.vx;
    vy += other.vy;
  }
  if (!neighbors.length) return { x: 0, y: 0 };
  vx /= neighbors.length;
  vy /= neighbors.length;
  const mag = Math.hypot(vx, vy);
  if (mag < 8) return { x: 0, y: 0 };
  return steerToward(boid, (vx / mag) * params.maxSpeed, (vy / mag) * params.maxSpeed);
}

function cohesion(boid, neighbors) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < neighbors.length; i += 1) {
    const other = boids[neighbors[i]];
    x += wrapDelta(other.x - boid.x, width);
    y += wrapDelta(other.y - boid.y, height);
  }
  if (!neighbors.length) return { x: 0, y: 0 };
  x /= neighbors.length;
  y /= neighbors.length;
  const mag = Math.hypot(x, y);
  if (mag < 1) return { x: 0, y: 0 };
  return steerToward(boid, (x / mag) * params.maxSpeed, (y / mag) * params.maxSpeed);
}

function zoneFear(dist, radius, threshold, presence) {
  if (presence < 0.02 || radius <= 0 || dist >= radius || dist < 0.001) return 0;
  const gate = Math.min(Math.max(0, threshold), Math.max(0, radius - 1));
  if (dist <= gate) return presence;
  const span = radius - gate;
  if (span <= 0) return presence;
  return presence * (1 - (dist - gate) / span);
}

function fleePoint(boid, x, y, fear) {
  const awayX = wrapDelta(boid.x - x, width);
  const awayY = wrapDelta(boid.y - y, height);
  const away = Math.hypot(awayX, awayY);
  if (away < 1) return { x: 0, y: 0, fear: 0 };
  const steered = steerToward(
    boid,
    (awayX / away) * params.maxSpeed,
    (awayY / away) * params.maxSpeed,
  );
  const urgency = 0.65 + fear;
  return { x: steered.x * urgency, y: steered.y * urgency, fear };
}

function evadeMouse(boid) {
  if (falcon.threat < 0.02) return { x: 0, y: 0, fear: 0 };
  const dx = wrapDelta(falcon.x - boid.x, width);
  const dy = wrapDelta(falcon.y - boid.y, height);
  const dist = Math.hypot(dx, dy);
  const fear = zoneFear(dist, params.threat, params.mouseThreshold, falcon.threat);
  if (fear <= 0) return { x: 0, y: 0, fear: 0 };

  const falconSpeed = Math.hypot(falcon.vx, falcon.vy);
  const lead = falconSpeed > 30 ? Math.min(0.45, dist / falconSpeed) : 0;
  return fleePoint(boid, falcon.x + falcon.vx * lead, falcon.y + falcon.vy * lead, fear);
}

function evadeIcon(boid) {
  if (iconPoints.length === 0) return { x: 0, y: 0, fear: 0 };
  let bestX = 0;
  let bestY = 0;
  let best = Infinity;
  for (let i = 0; i < iconPoints.length; i += 1) {
    const icon = iconPoints[i];
    const dist = Math.hypot(wrapDelta(icon.x - boid.x, width), wrapDelta(icon.y - boid.y, height));
    if (dist < best) {
      best = dist;
      bestX = icon.x;
      bestY = icon.y;
    }
  }
  const fear = zoneFear(best, params.iconThreat, params.iconThreshold, 1);
  if (fear <= 0) return { x: 0, y: 0, fear: 0 };
  return fleePoint(boid, bestX, bestY, fear);
}

function step(dt) {
  if (!falcon.present) {
    falcon.threat = Math.max(0, falcon.threat - dt / THREAT_FADE);
  } else if (performance.now() - falcon.sampleT > 40) {
    const decay = Math.exp(-dt * 8);
    falcon.vx *= decay;
    falcon.vy *= decay;
  }

  const cell = Math.max(24, params.perception);
  const buckets = buildGrid(cell, params.perception);
  const sepRadius = Math.min(34, Math.max(16, params.perception * 0.46));
  const cap = maxForce() * 2.6;

  for (let i = 0; i < boids.length; i += 1) {
    const boid = boids[i];
    const neighbors = queryNeighbors(i, params.perception, cell, buckets);

    const sep = separation(boid, neighbors, sepRadius);
    const ali = alignment(boid, neighbors);
    const coh = cohesion(boid, neighbors);
    const mouse = evadeMouse(boid);
    const icon = evadeIcon(boid);
    const force = limit(
      sep.x * params.sep +
        ali.x * params.ali +
        coh.x * params.coh +
        mouse.x * params.evade +
        icon.x * params.iconEvade,
      sep.y * params.sep +
        ali.y * params.ali +
        coh.y * params.coh +
        mouse.y * params.evade +
        icon.y * params.iconEvade,
      cap,
    );
    const forceBlend = 1 - Math.exp(-dt * params.forceFilter);
    boid.ax += (force.x - boid.ax) * forceBlend;
    boid.ay += (force.y - boid.ay) * forceBlend;
    const mouseFear = params.evade > 0 ? mouse.fear : 0;
    const iconFear = params.iconEvade > 0 ? icon.fear : 0;
    boid.fearTarget = Math.max(mouseFear, iconFear);
  }

  for (let i = 0; i < boids.length; i += 1) {
    const boid = boids[i];
    boid.vx += boid.ax * dt;
    boid.vy += boid.ay * dt;
    const speedLimit = params.maxSpeed * (1 + 0.22 * boid.fearTarget);
    const speed = Math.hypot(boid.vx, boid.vy);
    if (speed > speedLimit) {
      boid.vx = (boid.vx / speed) * speedLimit;
      boid.vy = (boid.vy / speed) * speedLimit;
    }
    boid.x = wrapCoord(boid.x + boid.vx * dt, width);
    boid.y = wrapCoord(boid.y + boid.vy * dt, height);
    const posBlend = 1 - Math.exp(-dt * params.moveFilter);
    boid.sx = wrapCoord(boid.sx + wrapDelta(boid.x - boid.sx, width) * posBlend, width);
    boid.sy = wrapCoord(boid.sy + wrapDelta(boid.y - boid.sy, height) * posBlend, height);
    if (speed > 12) {
      const headBlend = 1 - Math.exp(-dt * params.headFilter);
      boid.heading = approachAngle(boid.heading, Math.atan2(boid.vy, boid.vx), headBlend);
    }
    const blend = 1 - Math.exp(-dt * params.fearFilter);
    boid.fear += (boid.fearTarget - boid.fear) * blend;
  }
}

function drawBackground() {
  if (backgroundImage && backgroundImage.complete && backgroundImage.naturalWidth > 0) {
    const scale = Math.max(width / backgroundImage.naturalWidth, height / backgroundImage.naturalHeight);
    const w = backgroundImage.naturalWidth * scale;
    const h = backgroundImage.naturalHeight * scale;
    ctx.drawImage(backgroundImage, (width - w) / 2, (height - h) / 2, w, h);
    return;
  }

  const gradient = ctx.createRadialGradient(
    width * 0.58,
    height * 0.46,
    40,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72,
  );
  gradient.addColorStop(0, "#161c31");
  gradient.addColorStop(1, "#070910");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < stars.length; i += 1) {
    const star = stars[i];
    ctx.fillStyle = `rgba(232, 238, 248, ${star.a})`;
    ctx.beginPath();
    ctx.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBird(boid) {
  const x = boid.sx;
  const y = boid.sy;
  paintBird(boid, x, y);
  const pad = Math.max(14, params.birdSize);
  const xShift = x < pad ? width : x > width - pad ? -width : 0;
  const yShift = y < pad ? height : y > height - pad ? -height : 0;
  if (xShift) paintBird(boid, x + xShift, y);
  if (yShift) paintBird(boid, x, y + yShift);
  if (xShift && yShift) paintBird(boid, x + xShift, y + yShift);
}

function paintBird(boid, x, y) {
  const fear = Math.min(1, Math.max(0, boid.fear));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(boid.heading);
  if (birdImage && birdImage.complete && birdImage.naturalWidth > 0) {
    const size = params.birdSize;
    const drawX = -size * 0.62;
    const drawY = -size / 2;
    ctx.drawImage(birdImage, drawX, drawY, size, size);
    if (fear > 0.04 && birdFearTint) {
      ctx.globalAlpha = Math.min(1, fear);
      ctx.drawImage(birdFearTint, drawX, drawY, size, size);
      ctx.globalAlpha = 1;
    }
  } else {
    const coolR = 142 + boid.tint * 28;
    const coolG = 182 + boid.tint * 22;
    const coolB = 208 + boid.tint * 22;
    const r = Math.round(coolR + (255 - coolR) * fear);
    const g = Math.round(coolG + (168 - coolG) * fear);
    const b = Math.round(coolB + (96 - coolB) * fear);
    ctx.scale(params.birdSize / 16, params.birdSize / 16);
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, 3.1);
    ctx.lineTo(-2.4, 0);
    ctx.lineTo(-5, -3.1);
    ctx.closePath();
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 0.6;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function draw() {
  drawBackground();
  for (let i = 0; i < boids.length; i += 1) drawBird(boids[i]);
}

function updateStatus() {
  let count = 0;
  for (let i = 0; i < boids.length; i += 1) {
    if (boids[i].fear > 0.25) count += 1;
  }
  if (count !== frightened) {
    frightened = count;
    statusEl.textContent = `受惊 ${count}`;
  }
}

function stopLoop() {
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
}

function startLoop() {
  if (frameId || playbackPaused || document.hidden) return;
  lastTime = performance.now();
  frameId = requestAnimationFrame(frame);
}

function frame(now) {
  frameId = 0;
  if (playbackPaused || document.hidden) return;
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  if (now >= nextIconFetch) refreshIcons();
  if (!paused) step(dt);
  else if (!falcon.present) falcon.threat = Math.max(0, falcon.threat - dt / THREAT_FADE);
  draw();
  updateStatus();
  if (playbackPaused || document.hidden) return;
  frameId = requestAnimationFrame(frame);
}

function placeFalcon(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const now = performance.now();
  if (falcon.hasSample) {
    const sampleDt = Math.max(0.008, (now - falcon.sampleT) / 1000);
    const rawVx = (x - falcon.x) / sampleDt;
    const rawVy = (y - falcon.y) / sampleDt;
    const blend = 1 - Math.exp(-sampleDt * 14);
    falcon.vx += (rawVx - falcon.vx) * blend;
    falcon.vy += (rawVy - falcon.vy) * blend;
    const speed = Math.hypot(falcon.vx, falcon.vy);
    if (speed > FALCON_SPEED_CAP) {
      falcon.vx = (falcon.vx / speed) * FALCON_SPEED_CAP;
      falcon.vy = (falcon.vy / speed) * FALCON_SPEED_CAP;
    }
  }
  falcon.x = x;
  falcon.y = y;
  falcon.sampleT = now;
  falcon.hasSample = true;
  falcon.present = true;
  falcon.threat = 1;
}

function releaseFalcon() {
  falcon.present = false;
}

let sliderDrag = null;

function quantize(raw, min, max, step) {
  const clamped = Math.min(max, Math.max(min, raw));
  const steps = Math.round((clamped - min) / step);
  const places = (String(step).split(".")[1] || "").length;
  return Number((min + steps * step).toFixed(places));
}

function moveSlider(input, event) {
  const rect = input.getBoundingClientRect();
  const span = rect.width || 1;
  const min = Number(input.min);
  const max = Number(input.max);
  const step = Number(input.step) || 1;
  const next = quantize(min + ((event.clientX - rect.left) / span) * (max - min), min, max, step);
  if (Number(input.value) === next) return;
  input.value = String(next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function bindRange(id, key, format) {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}-out`);
  const apply = () => {
    params[key] = Number(input.value);
    output.textContent = format(params[key]);
    if (key === "count") syncCount();
    scheduleSave();
  };
  input.addEventListener("input", apply);
  input.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    sliderDrag = input;
    try { input.setPointerCapture(event.pointerId); } catch (err) { /* wallpaper may reject capture */ }
    moveSlider(input, event);
  });
  apply();
}

function bindControls() {
  const keys = Object.keys(params);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const input = document.getElementById(key);
    const places = (String(input.step).split(".")[1] || "").length;
    const format = places ? (value) => value.toFixed(places) : (value) => String(Math.round(value));
    bindRange(key, key, format);
  }

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "继续" : "暂停";
  });
  document.getElementById("reset").addEventListener("click", resetFlock);
}

window.addEventListener("pointermove", (event) => {
  if (sliderDrag) moveSlider(sliderDrag, event);
});
window.addEventListener("pointerup", () => {
  sliderDrag = null;
});
window.addEventListener("pointercancel", () => {
  sliderDrag = null;
});
canvas.addEventListener("pointermove", placeFalcon);
canvas.addEventListener("pointerdown", placeFalcon);
canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType !== "touch") releaseFalcon();
});
canvas.addEventListener("pointerup", (event) => {
  if (event.pointerType === "touch") releaseFalcon();
});
canvas.addEventListener("pointercancel", releaseFalcon);
window.addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopLoop();
  else startLoop();
});

function safeImageName(name, allowSvg) {
  if (typeof name !== "string") return "";
  const base = name.split(/[/\\]/).pop();
  const pattern = allowSvg ? /\.(jpe?g|png|webp|svg)$/i : /\.(jpe?g|png|webp)$/i;
  if (!base || !pattern.test(base)) return "";
  return base;
}

function rasterTint(image, color) {
  const tintWidth = image.naturalWidth || image.width;
  const tintHeight = image.naturalHeight || image.height;
  if (!tintWidth || !tintHeight) return null;
  const surface = document.createElement("canvas");
  surface.width = tintWidth;
  surface.height = tintHeight;
  const tintCtx = surface.getContext("2d");
  tintCtx.drawImage(image, 0, 0, tintWidth, tintHeight);
  tintCtx.globalCompositeOperation = "source-atop";
  tintCtx.fillStyle = color;
  tintCtx.fillRect(0, 0, tintWidth, tintHeight);
  return surface;
}

let birdRequest = 0;

function setBird(src) {
  const request = ++birdRequest;
  birdFearTint = null;
  if (!src) {
    birdImage = null;
    return;
  }
  const image = new Image();
  image.onload = () => {
    if (request !== birdRequest) return;
    birdImage = image;
    birdFearTint = rasterTint(image, "rgb(255, 168, 96)");
  };
  image.onerror = () => {
    if (request !== birdRequest) return;
    birdImage = null;
    birdFearTint = null;
  };
  image.src = src;
}

function setBackground(src) {
  if (!src) {
    backgroundImage = null;
    return;
  }
  const image = new Image();
  image.onload = () => {
    backgroundImage = image;
  };
  image.onerror = () => {
    backgroundImage = null;
  };
  image.src = src;
}

function refreshIcons() {
  nextIconFetch = performance.now() + 1500;
  if (iconFetchBusy) return;
  iconFetchBusy = true;
  fetch("icons.json", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || !Array.isArray(data.icons)) return;
      const originX = window.screenX || 0;
      const originY = window.screenY || 0;
      const next = [];
      for (let i = 0; i < data.icons.length; i += 1) {
        const icon = data.icons[i];
        const x = Number(icon.x) - originX;
        const y = Number(icon.y) - originY;
        if (x >= -8 && y >= -8 && x <= width + 8 && y <= height + 8) next.push({ x, y });
      }
      iconPoints = next;
    })
    .catch(() => {})
    .finally(() => {
      iconFetchBusy = false;
    });
}

function showImageChoice(kind, imageName) {
  const current = document.getElementById(kind === "bird" ? "bird-current" : "background-current");
  const list = document.getElementById(kind === "bird" ? "bird-list" : "background-list");
  const empty = kind === "bird" ? "折线" : "夜空";
  const name = imageName || "";
  const match = list && [...list.querySelectorAll("button")].find((item) => item.dataset.value === name);
  if (current) {
    current.dataset.value = name;
    current.textContent = match ? match.textContent : (name ? name.replace(/\.[^.]+$/, "") : empty);
  }
  if (list) {
    list.querySelectorAll("button").forEach((item) => {
      item.setAttribute("aria-pressed", item.dataset.value === name ? "true" : "false");
    });
    list.hidden = true;
  }
  if (kind === "bird") setBird(name ? `birds/${name}` : "");
  else setBackground(name ? `backgrounds/${name}` : "");
  scheduleSave();
}

function loadChoiceList(kind, url, emptyLabel, allowSvg) {
  const list = document.getElementById(kind === "bird" ? "bird-list" : "background-list");
  const current = document.getElementById(kind === "bird" ? "bird-current" : "background-current");
  if (!list || !current) return;
  fetch(url, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : []))
    .then((names) => {
      const selected = current.dataset.value || "";
      list.replaceChildren();
      const options = [{ value: "", label: emptyLabel }];
      const sorted = Array.isArray(names) ? names.slice().sort((a, b) => String(a).localeCompare(String(b), "zh")) : [];
      for (let i = 0; i < sorted.length; i += 1) {
        const name = safeImageName(sorted[i], allowSvg);
        if (!name) continue;
        options.push({ value: name, label: name.replace(/\.[^.]+$/, "") });
      }
      for (let i = 0; i < options.length; i += 1) {
        const option = options[i];
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = option.label;
        button.dataset.value = option.value;
        button.setAttribute("aria-pressed", option.value === selected ? "true" : "false");
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          showImageChoice(kind, option.value);
        });
        list.appendChild(button);
      }
    })
    .catch(() => {});
}

function bindChoice(kind) {
  const current = document.getElementById(kind === "bird" ? "bird-current" : "background-current");
  const list = document.getElementById(kind === "bird" ? "bird-list" : "background-list");
  current.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = list.hidden;
    document.querySelectorAll(".choice-list").forEach((other) => {
      other.hidden = true;
    });
    list.hidden = !opening;
    if (!list.hidden) {
      list.scrollIntoView({ block: "nearest", inline: "nearest" });
      const limit = panel.getBoundingClientRect().bottom - 8;
      const over = list.getBoundingClientRect().bottom - limit;
      if (over > 0) panel.scrollTop += over;
    }
  });
}

function setCollapsed(collapsed) {
  panel.classList.toggle("collapsed", collapsed);
}

function setSlider(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function applyLivelyProperty(name, value) {
  if (name === "backgroundImage" || name === "birdImage") {
    const kind = name === "birdImage" ? "bird" : "background";
    showImageChoice(kind, safeImageName(value, kind === "bird"));
    return;
  }
  setSlider(name, value);
}

function livelyPropertyListener(name, value) {
  if (!livelyBootCollapsed) {
    livelyBootCollapsed = true;
    setCollapsed(true);
  }
  if (!persistReady) {
    livelyQueue.push([name, value]);
    return;
  }
  if (savedSnapshot && performance.now() < holdLivelyUntil) return;
  applyLivelyProperty(name, value);
}

function livelyWallpaperPlaybackChanged(data) {
  const info = typeof data === "string" ? JSON.parse(data) : data;
  playbackPaused = Boolean(info && info.IsPaused);
  if (playbackPaused) stopLoop();
  else startLoop();
}

document.getElementById("collapse").addEventListener("click", () => setCollapsed(true));
document.getElementById("expand").addEventListener("click", () => setCollapsed(false));
bindChoice("bird");
bindChoice("background");
document.addEventListener("pointerdown", (event) => {
  if (event.target.closest("#panel")) return;
  document.querySelectorAll(".choice-list").forEach((list) => {
    list.hidden = true;
  });
});
document.getElementById("background-file").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const current = document.getElementById("background-current");
  current.dataset.value = "";
  current.textContent = file.name;
  document.querySelectorAll("#background-list button").forEach((item) => item.setAttribute("aria-pressed", "false"));
  setBackground(URL.createObjectURL(file));
});
document.getElementById("bird-file").addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const current = document.getElementById("bird-current");
  current.dataset.value = "";
  current.textContent = file.name;
  document.querySelectorAll("#bird-list button").forEach((item) => item.setAttribute("aria-pressed", "false"));
  setBird(URL.createObjectURL(file));
});

const saveKeys = Object.keys(params);
let persistReady = false;
let restoring = false;
let savedSnapshot = null;
let holdLivelyUntil = 0;
let saveTimer = 0;
const livelyQueue = [];

function snapshotParams() {
  const bird = document.getElementById("bird-current");
  const background = document.getElementById("background-current");
  const data = {
    birdImage: (bird && bird.dataset.value) || "",
    backgroundImage: (background && background.dataset.value) || "",
  };
  for (let i = 0; i < saveKeys.length; i += 1) data[saveKeys[i]] = params[saveKeys[i]];
  return data;
}

function scheduleSave() {
  if (!persistReady || restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeParams, 280);
}

function writeParams() {
  const body = JSON.stringify(snapshotParams());
  fetch("http://127.0.0.1:8766/params", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body,
  }).catch(() => {});
}

function applySaved(data) {
  if (!data || typeof data !== "object") return;
  restoring = true;
  for (let i = 0; i < saveKeys.length; i += 1) {
    const key = saveKeys[i];
    if (typeof data[key] === "number" && Number.isFinite(data[key])) setSlider(key, data[key]);
  }
  if (typeof data.birdImage === "string") showImageChoice("bird", safeImageName(data.birdImage, true));
  if (typeof data.backgroundImage === "string") showImageChoice("background", safeImageName(data.backgroundImage, false));
  restoring = false;
}

function finishPersistLoad() {
  persistReady = true;
  if (savedSnapshot) {
    applySaved(savedSnapshot);
    holdLivelyUntil = performance.now() + 5000;
    livelyQueue.length = 0;
    scheduleSave();
    return;
  }
  restoring = true;
  for (let i = 0; i < livelyQueue.length; i += 1) applyLivelyProperty(livelyQueue[i][0], livelyQueue[i][1]);
  restoring = false;
  livelyQueue.length = 0;
}

makeStars();
resize();
bindControls();
loadChoiceList("background", "backgrounds/list.json", "夜空", false);
loadChoiceList("bird", "birds/list.json", "折线", true);
resetFlock();
startLoop();
fetch("params.json", { cache: "no-store" })
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    savedSnapshot = data;
  })
  .catch(() => {})
  .finally(finishPersistLoad);
