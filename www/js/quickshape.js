// QuickShape: turn a roughly drawn stroke into a clean line, arc, polygon, circle or ellipse.

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(P) {
  let L = 0;
  for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]);
  return L;
}

function resample(P, n) {
  const L = pathLength(P);
  if (L === 0) return [P[0]];
  const step = L / (n - 1);
  const out = [{ x: P[0].x, y: P[0].y }];
  let acc = 0;
  let prev = P[0];
  for (let i = 1; i < P.length; i++) {
    let cur = P[i];
    let d = dist(prev, cur);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  while (out.length < n) out.push({ x: P[P.length - 1].x, y: P[P.length - 1].y });
  return out.slice(0, n);
}

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdp(P, eps) {
  if (P.length < 3) return P.slice();
  let idx = 0, max = 0;
  const a = P[0], b = P[P.length - 1];
  for (let i = 1; i < P.length - 1; i++) {
    const d = distToSeg(P[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (max > eps) {
    const l = rdp(P.slice(0, idx + 1), eps);
    const r = rdp(P.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [a, b];
}

function turnAngle(a, b, c) {
  const a1 = Math.atan2(b.y - a.y, b.x - a.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

// remove nearly-straight vertices of a closed polygon
function dropFlat(poly, minTurn) {
  let changed = true;
  let P = poly.slice();
  while (changed && P.length > 3) {
    changed = false;
    for (let i = 0; i < P.length; i++) {
      const a = P[(i - 1 + P.length) % P.length], b = P[i], c = P[(i + 1) % P.length];
      if (turnAngle(a, b, c) < minTurn) { P.splice(i, 1); changed = true; break; }
    }
  }
  return P;
}

function polyDeviation(P, poly, closed) {
  let max = 0;
  const segs = closed ? poly.length : poly.length - 1;
  for (const p of P) {
    let m = Infinity;
    for (let i = 0; i < segs; i++) m = Math.min(m, distToSeg(p, poly[i], poly[(i + 1) % poly.length]));
    max = Math.max(max, m);
  }
  return max;
}

function fitEllipse(P) {
  const n = P.length;
  let mx = 0, my = 0;
  for (const p of P) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of P) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let a = Math.sqrt(2 * Math.max(l1, 0)), b = Math.sqrt(2 * Math.max(l2, 0));
  // error: mean normalized radial deviation
  const c = Math.cos(theta), s = Math.sin(theta);
  let err = 0;
  for (const p of P) {
    const dx = p.x - mx, dy = p.y - my;
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    err += Math.abs(Math.sqrt((u / a) ** 2 + (v / (b || 1e-6)) ** 2) - 1);
  }
  err /= n;
  return { cx: mx, cy: my, a, b, theta, err };
}

function ellipsePoints(e, n = 120) {
  const pts = [];
  const c = Math.cos(e.theta), s = Math.sin(e.theta);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const u = Math.cos(t) * e.a, v = Math.sin(t) * e.b;
    pts.push({ x: e.cx + u * c - v * s, y: e.cy + u * s + v * c });
  }
  return pts;
}

function snapLine(a, b) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const step = Math.PI / 12; // 15°
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(snapped - ang) < (4 * Math.PI) / 180) {
    const L = dist(a, b);
    return [a, { x: a.x + Math.cos(snapped) * L, y: a.y + Math.sin(snapped) * L }];
  }
  return [a, b];
}

function circleFrom3(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

function densify(poly, closed, step = 4) {
  const out = [];
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = dist(a, b);
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  out.push(closed ? { ...poly[0] } : { ...poly[poly.length - 1] });
  return out;
}

export function detectShape(raw) {
  if (!raw || raw.length < 3) return null;
  const L = pathLength(raw);
  if (L < 24) return null;
  const P = resample(raw, 96);
  const a = P[0], b = P[P.length - 1];
  const chord = dist(a, b);

  // straight line
  let maxDev = 0;
  for (const p of P) maxDev = Math.max(maxDev, distToSeg(p, a, b));
  if (chord > 0.7 * L && maxDev < Math.max(5, chord * 0.07)) {
    return { type: 'Line', pts: densify(snapLine(a, b), false) };
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  const closed = chord < Math.max(18, 0.2 * L, diag * 0.22);

  if (closed) {
    let poly = rdp(P, diag * 0.07);
    if (poly.length > 1 && dist(poly[0], poly[poly.length - 1]) < diag * 0.25) poly.pop();
    poly = dropFlat(poly, (32 * Math.PI) / 180);
    const dev = polyDeviation(P, poly, true);
    if (poly.length >= 3 && poly.length <= 4 && dev < diag * 0.08) {
      if (poly.length === 4) {
        // axis aligned rectangle?
        let aligned = true;
        for (let i = 0; i < 4; i++) {
          const p = poly[i], q = poly[(i + 1) % 4];
          const ang = Math.abs(Math.atan2(q.y - p.y, q.x - p.x)) % (Math.PI / 2);
          const off = Math.min(ang, Math.PI / 2 - ang);
          if (off > (12 * Math.PI) / 180) aligned = false;
        }
        if (aligned) {
          let rx0 = Infinity, ry0 = Infinity, rx1 = -Infinity, ry1 = -Infinity;
          for (const p of poly) { rx0 = Math.min(rx0, p.x); ry0 = Math.min(ry0, p.y); rx1 = Math.max(rx1, p.x); ry1 = Math.max(ry1, p.y); }
          const rect = [{ x: rx0, y: ry0 }, { x: rx1, y: ry0 }, { x: rx1, y: ry1 }, { x: rx0, y: ry1 }];
          return { type: 'Rectangle', pts: densify(rect, true) };
        }
        return { type: 'Quadrilateral', pts: densify(poly, true) };
      }
      return { type: 'Triangle', pts: densify(poly, true) };
    }
    const e = fitEllipse(P);
    if (e.err < 0.16 && e.a > 4) {
      if (e.b / e.a > 0.86) {
        const r = (e.a + e.b) / 2;
        return { type: 'Circle', pts: ellipsePoints({ ...e, a: r, b: r }) };
      }
      return { type: 'Ellipse', pts: ellipsePoints(e) };
    }
    if (poly.length >= 3 && poly.length <= 8 && dev < diag * 0.07) {
      return { type: 'Polygon', pts: densify(poly, true) };
    }
    return null;
  }

  // open: polyline
  let poly = rdp(P, diag * 0.06);
  if (poly.length <= 5 && polyDeviation(P, poly, false) < diag * 0.06) {
    return { type: 'Polyline', pts: densify(poly, false) };
  }
  // arc
  const mid = P[Math.floor(P.length / 2)];
  const c = circleFrom3(a, mid, b);
  if (c && c.r < diag * 4) {
    let err = 0;
    for (const p of P) err += Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - c.r);
    err /= P.length;
    if (err < c.r * 0.06) {
      const a0 = Math.atan2(a.y - c.y, a.x - c.x);
      const am = Math.atan2(mid.y - c.y, mid.x - c.x);
      let a1 = Math.atan2(b.y - c.y, b.x - c.x);
      // choose direction that passes through mid
      const norm = (t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const ccw = norm(am - a0) < norm(a1 - a0);
      let sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1);
      const pts = [];
      const n = 80;
      for (let i = 0; i <= n; i++) {
        const t = a0 + (sweep * i) / n;
        pts.push({ x: c.x + Math.cos(t) * c.r, y: c.y + Math.sin(t) * c.r });
      }
      return { type: 'Arc', pts };
    }
  }
  return null;
}
