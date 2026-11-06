/*
 * Numeral coverage globe — 3D replacement for the flat coverage map.
 * Reads the VAT CMS rows on the page (.coverage-table_row[data-status] + .coverage-table_row-country-name),
 * colours each country by status, and drives the page's existing .coverage-map_tooltip on click.
 * Mounts into [data-coverage-globe] (or, if there is none, the page's .coverage-map_svg-holder)
 * and fills its nearest positioned ancestor.
 * Optional data attributes on the mount: data-globe-x (centre, fraction of width), data-globe-radius
 * (fraction of the container height at zoom 1), data-spin-speed, data-start-longitude, data-view-pitch,
 * data-tilt (axis tilt, degrees), data-zoom (initial zoom), data-min-zoom, data-max-zoom.
 */
(() => {
  if (window.__numeralCoverageGlobe) return;
  window.__numeralCoverageGlobe = true;

  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
  const TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';
  const MAP_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';

  const DEFAULTS = {
    oceanColor: '#dfe6f0',     // soft blue-slate so land reads clearly against the sea
    oceanOpacity: 1,
    rimColor: '#cbd5e1',       // slate-300
    lineColor: '#9192a2',      // graticule
    graticuleOpacity: 0.18,
    borderColor: '#cbd5e1',    // slate-300 country outlines (reads on both navy and pale land)
    borderOpacity: 0.9,
    // status fills, matching the page legend
    colors: { live: '#464a70', 'coming soon': '#94a3b8', waiting: '#ffffff' },
    hoverLighten: 0.2,
    // floating dust behind the globe, after ramp.com's card: tiny circles drifting on a slow flow field
    dust: true,
    dustDensity: 1 / 480,      // dots per px² of the frame
    dustColors: ['#d8dfe8', '#cad3de', '#b9c4d2'], // a few slate steps darker than the panel
    dustSpeed: 6,              // px / second, upper bound
    spinSpeed: 0.035,
    // load-in view (picked by hand on staging): Americas + Atlantic
    startLongitude: -60.4,
    viewPitch: 0.4,
    tilt: 0,                   // axis tilt in degrees (0 = upright spin axis)
    zoom: 1.3,                 // initial zoom
    // intro, played the first time the globe scrolls into view
    introDuration: 2.8,        // seconds
    introTurns: 1.25,          // extra turns that unwind as it settles
    introRise: 0.6,            // starts this far below its resting spot, fraction of height
    introScale: 0.75,          // starts at this fraction of its resting size
    globeX: 0.5,
    globeRadius: 0.62,         // fraction of container height at zoom 1: shows roughly the top 3/4
    topMargin: 0.06,           // gap above the globe, fraction of height (the globe is top-anchored)
    minZoom: 0.62,             // zoomed out far enough to see the whole globe
    maxZoom: 2.2,
  };

  // CMS name → world-atlas name. Entries mapped to null are schemes or regions with no shape of their own.
  const ALIASES = {
    'united states': 'united states of america',
    'usa': 'united states of america',
    'uae': 'united arab emirates',
    'north macedonia': 'macedonia',
    'northern ireland': null,
    'eu': null,
    'eu oss': null,
    'eu ioss': null,
  };

  const STYLE = `
    .coverage-map_svg-holder { position: relative; }
    .ncg-root { position: absolute; inset: 0; overflow: hidden; }
    .ncg-root canvas { position: relative; display: block; width: 100%; height: 100%; cursor: grab; touch-action: pan-y; }
    .ncg-root canvas.ncg-dust { position: absolute; inset: 0; pointer-events: none; cursor: default; }
    .ncg-root canvas.is-over-country { cursor: pointer; }
    .ncg-root canvas:active { cursor: grabbing; }
    .ncg-zoom { position: absolute; left: 1rem; top: 1rem; display: flex; flex-direction: column; gap: 0.375rem; z-index: 4; }
    .ncg-zoom button {
      width: 2.25rem; height: 2.25rem; display: grid; place-items: center; padding: 0;
      background: #fff; color: #475569; border: 1px solid #e2e8f0; border-radius: 0.5rem;
      font: 400 1.125rem/1 system-ui, sans-serif; cursor: pointer; transition: background 0.15s, color 0.15s;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1); /* same as the page legend */
    }
    .ncg-zoom button:hover { background: #f8fafc; color: #1e293b; }
    .ncg-zoom button:disabled { opacity: 0.4; cursor: default; }`;

  const normalize = s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');

  function readCoverage() {
    const data = {};
    document.querySelectorAll('.coverage-table_row').forEach(row => {
      const nameEl = row.querySelector('.coverage-table_row-country-name');
      if (!nameEl) return;
      const label = nameEl.textContent.trim();
      const status = (row.getAttribute('data-status') || 'Waiting').trim();
      const key = normalize(label);
      const target = key in ALIASES ? ALIASES[key] : key;
      if (target) data[target] = { label, status };
    });
    return data;
  }

  // Unwrap a ring's longitudes so it never jumps across the antimeridian
  function unwrapRing(ring) {
    const out = [[ring[0][0], ring[0][1]]];
    for (let i = 1; i < ring.length; i++) {
      let lon = ring[i][0];
      const prev = out[i - 1][0];
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
      out.push([lon, ring[i][1]]);
    }
    return out;
  }

  // Rings that wrap the globe (Antarctica) close via the nearest pole
  function closeRing(ring) {
    const first = ring[0], last = ring[ring.length - 1];
    if (Math.abs(last[0] - first[0]) > 180) {
      const pole = first[1] < 0 ? -90 : 90;
      ring.push([last[0], pole], [first[0], pole]);
    }
    return ring;
  }

  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function readOptions(el) {
    const d = el.dataset, o = { ...DEFAULTS };
    for (const k of ['globeX', 'globeRadius', 'spinSpeed', 'startLongitude', 'viewPitch', 'tilt', 'zoom', 'minZoom', 'maxZoom']) {
      if (d[k] != null && !isNaN(+d[k])) o[k] = +d[k];
    }
    return o;
  }

  async function mount(host) {
    const [THREE, topojson, topo] = await Promise.all([
      import(THREE_URL),
      import(TOPOJSON_URL),
      fetch(MAP_URL).then(r => r.json()),
    ]);
    const CONFIG = readOptions(host);
    const coverage = readCoverage();

    // Raw ShaderMaterials skip output conversion, so keep colors in sRGB end to end
    THREE.ColorManagement.enabled = false;

    // -------------------------------------------------------------------------
    // Countries: status, unwrapped rings and a bbox for picking
    // -------------------------------------------------------------------------
    const countries = topojson.feature(topo, topo.objects.countries).features.map(f => {
      const name = f.properties.name;
      const match = coverage[normalize(name)];
      const status = match ? match.status : 'Waiting';
      const g = f.geometry;
      const polys = !g ? [] : (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
        .map(poly => poly.map(r => closeRing(unwrapRing(r))));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const poly of polys) {
        for (const [x, y] of poly[0]) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
      return { name, label: match ? match.label : name, status, polys, bbox: [minX, minY, maxX, maxY] };
    });

    const statusColor = s => CONFIG.colors[normalize(s)] || CONFIG.colors.waiting;

    // -------------------------------------------------------------------------
    // Scene
    // -------------------------------------------------------------------------
    const container = document.createElement('div');
    container.className = 'ncg-root';
    host.appendChild(container);

    // Dust — a 2D canvas under the globe; the opaque ocean hides it where the globe is
    const dustCanvas = document.createElement('canvas');
    dustCanvas.className = 'ncg-dust';
    container.appendChild(dustCanvas);
    const dustCtx = dustCanvas.getContext('2d');
    let dust = [], dustW = 0, dustH = 0, dustT = 0;
    function resizeDust(w, h) {
      const dpr = Math.min(window.devicePixelRatio, 2);
      dustCanvas.width = Math.round(w * dpr); dustCanvas.height = Math.round(h * dpr);
      dustCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dustW = w; dustH = h;
      if (!CONFIG.dust) { dust = []; return; }
      const n = Math.round(w * h * CONFIG.dustDensity);
      while (dust.length < n) {
        dust.push({
          x: Math.random() * w, y: Math.random() * h,
          r: Math.random() < 0.7 ? 0.75 : 1,                      // radius, css px
          c: (Math.random() * CONFIG.dustColors.length) | 0,
          v: 0.35 + Math.random() * 0.65,                          // personal speed factor
          p: Math.random() * Math.PI * 2,                          // personal phase
        });
      }
      dust.length = n;
      for (const d of dust) { d.x = Math.min(d.x, w); d.y = Math.min(d.y, h); }
      drawDust(0);
    }
    function drawDust(dt) {
      if (!dust.length) return;
      dustT += dt;
      dustCtx.clearRect(0, 0, dustW, dustH);
      const sp = CONFIG.dustSpeed;
      for (let ci = 0; ci < CONFIG.dustColors.length; ci++) {
        dustCtx.fillStyle = CONFIG.dustColors[ci];
        dustCtx.beginPath(); // one path per colour keeps thousands of circles cheap
        for (const d of dust) {
          if (d.c !== ci) continue;
          if (dt) {
            // smooth flow field: neighbours drift together, the field itself slowly evolves
            const a = Math.sin(d.x * 0.004 + dustT * 0.05) * Math.cos(d.y * 0.005 - dustT * 0.04) * Math.PI * 2 + d.p * 0.3;
            d.x += Math.cos(a) * sp * d.v * dt;
            d.y += Math.sin(a) * sp * d.v * dt;
            if (d.x < -2) d.x += dustW + 4; else if (d.x > dustW + 2) d.x -= dustW + 4;
            if (d.y < -2) d.y += dustH + 4; else if (d.y > dustH + 2) d.y -= dustH + 4;
          }
          dustCtx.moveTo(d.x + d.r, d.y);
          dustCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        }
        dustCtx.fill();
      }
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = THREE.MathUtils.degToRad(CONFIG.tilt);
    const spinGroup = new THREE.Group();
    spinGroup.rotation.y = THREE.MathUtils.degToRad(-90 - CONFIG.startLongitude);
    tiltGroup.add(spinGroup);
    scene.add(tiltGroup);

    function latLonToVec3(lat, lon, r = 1) {
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const theta = THREE.MathUtils.degToRad(lon + 180);
      return new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      );
    }
    function vec3ToLatLon(v) {
      const n = v.clone().normalize();
      const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)));
      let lon = THREE.MathUtils.radToDeg(Math.atan2(n.z, -n.x)) - 180;
      if (lon < -180) lon += 360;
      return [lat, lon];
    }

    // Equirectangular canvas, drawn once per mode (status fill, hover mask)
    function drawCountry(ctx, c, w, h) {
      ctx.beginPath();
      for (const poly of c.polys) {
        for (const ring of poly) {
          for (const shift of [-360, 0, 360]) {
            ring.forEach(([lon, lat], i) => {
              const x = ((lon + shift + 180) / 360) * w, y = ((90 - lat) / 180) * h;
              i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            });
            ctx.closePath();
          }
        }
      }
      ctx.fill('evenodd');
    }

    const fillCanvas = document.createElement('canvas');
    fillCanvas.width = 4096; fillCanvas.height = 2048;
    {
      const ctx = fillCanvas.getContext('2d');
      for (const c of countries) {
        ctx.fillStyle = statusColor(c.status);
        drawCountry(ctx, c, fillCanvas.width, fillCanvas.height);
      }
    }
    const fillTex = new THREE.CanvasTexture(fillCanvas);
    fillTex.colorSpace = THREE.NoColorSpace;
    fillTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // Two hover masks so the highlight can crossfade: the new country eases in while the old one eases out
    const hoverLayers = [0, 1].map(() => {
      const c = document.createElement('canvas');
      c.width = 2048; c.height = 1024;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.NoColorSpace;
      return { canvas: c, ctx: c.getContext('2d'), tex, strength: 0 };
    });

    // Sphere body — ocean + status fill + hover lighten + thin rim
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(1, 128, 128),
      new THREE.ShaderMaterial({
        uniforms: {
          uFill: { value: fillTex },
          uHoverA: { value: hoverLayers[0].tex },
          uHoverB: { value: hoverLayers[1].tex },
          uHoverStrength: { value: new THREE.Vector2(0, 0) },
          uOcean: { value: new THREE.Color(CONFIG.oceanColor) },
          uOceanOpacity: { value: CONFIG.oceanOpacity },
          uRim: { value: new THREE.Color(CONFIG.rimColor) },
          uLighten: { value: CONFIG.hoverLighten },
        },
        vertexShader: /* glsl */`
          varying vec3 vN; varying vec3 vV; varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`
          uniform sampler2D uFill; uniform sampler2D uHoverA; uniform sampler2D uHoverB; uniform vec2 uHoverStrength;
          uniform vec3 uOcean; uniform float uOceanOpacity; uniform vec3 uRim; uniform float uLighten;
          varying vec3 vN; varying vec3 vV; varying vec2 vUv;
          void main() {
            vec4 land = texture2D(uFill, vUv);
            vec3 col = mix(uOcean, land.rgb, land.a);
            float hover = max(texture2D(uHoverA, vUv).r * uHoverStrength.x, texture2D(uHoverB, vUv).r * uHoverStrength.y);
            col = mix(col, vec3(1.0), hover * uLighten);
            float f = 1.0 - max(dot(vN, vV), 0.0);
            float rim = smoothstep(0.94, 0.995, f);
            col = mix(col, uRim, rim);
            gl_FragColor = vec4(col, mix(mix(uOceanOpacity, 1.0, land.a), 1.0, rim));
          }`,
        transparent: true,
      }),
    );
    spinGroup.add(body);

    // Shared GLSL: fade lines out over the limb, hide the far side
    const FACING_GLSL = /* glsl */`
      float facingFade(vec3 pos, vec4 mv) {
        float f = dot(normalize(normalMatrix * pos), normalize(-mv.xyz));
        return smoothstep(-0.02, 0.15, f);
      }`;
    const lineMaterial = (color, opacity) => new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
      vertexShader: FACING_GLSL + /* glsl */`
        varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vFade = facingFade(position, mv);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uOpacity; varying float vFade;
        void main() {
          float a = uOpacity * vFade;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true,
      depthWrite: false,
    });

    // Graticule
    {
      const pos = [], STEPS = 180;
      const push = (a, b) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      for (let lon = -180; lon < 180; lon += 15) {
        for (let i = 0; i < STEPS; i++) {
          push(latLonToVec3(-90 + (180 * i) / STEPS, lon, 1.001), latLonToVec3(-90 + (180 * (i + 1)) / STEPS, lon, 1.001));
        }
      }
      for (let lat = -75; lat <= 75; lat += 15) {
        for (let i = 0; i < STEPS * 2; i++) {
          push(latLonToVec3(lat, -180 + (360 * i) / (STEPS * 2), 1.001), latLonToVec3(lat, -180 + (360 * (i + 1)) / (STEPS * 2), 1.001));
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const lines = new THREE.LineSegments(geo, lineMaterial(CONFIG.lineColor, CONFIG.graticuleOpacity));
      lines.renderOrder = 1;
      spinGroup.add(lines);
    }

    // Country borders — every coastline and border arc exactly once
    {
      const mesh = topojson.mesh(topo, topo.objects.countries);
      const pos = [];
      for (const line of mesh.coordinates) {
        for (let i = 1; i < line.length; i++) {
          if (Math.abs(line[i][0] - line[i - 1][0]) > 180) continue;
          const a = latLonToVec3(line[i - 1][1], line[i - 1][0], 1.0015);
          const b = latLonToVec3(line[i][1], line[i][0], 1.0015);
          pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const borders = new THREE.LineSegments(geo, lineMaterial(CONFIG.borderColor, CONFIG.borderOpacity));
      borders.renderOrder = 2;
      spinGroup.add(borders);
    }

    // -------------------------------------------------------------------------
    // Picking — ray onto the sphere, then point-in-polygon on the hit's lat/lon
    // -------------------------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const tmp = new THREE.Vector3(), tmpN = new THREE.Vector3(), camDir = new THREE.Vector3();

    function facingOf(local) {
      tmp.copy(local).applyMatrix4(spinGroup.matrixWorld);
      tmpN.copy(tmp).normalize();
      camDir.copy(camera.position).sub(tmp).normalize();
      return tmpN.dot(camDir);
    }
    function toScreen(local) {
      tmp.copy(local).applyMatrix4(spinGroup.matrixWorld).project(camera);
      return [(tmp.x * 0.5 + 0.5) * container.clientWidth, (-tmp.y * 0.5 + 0.5) * container.clientHeight];
    }

    function pick(clientX, clientY) {
      const r = container.getBoundingClientRect();
      const px = clientX - r.left, py = clientY - r.top;
      spinGroup.updateMatrixWorld();
      ndc.set((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(body, false)[0];
      if (!hit) return null;
      const local = spinGroup.worldToLocal(hit.point.clone());
      const [lat, lon] = vec3ToLatLon(local);
      for (const c of countries) {
        const [x0, y0, x1, y1] = c.bbox;
        if (lat < y0 || lat > y1) continue;
        for (const L of [lon, lon - 360, lon + 360]) {
          if (L < x0 || L > x1) continue;
          let inside = false;
          for (const poly of c.polys) for (const ring of poly) if (pointInRing(L, lat, ring)) inside = !inside;
          if (inside) return { country: c, anchor: latLonToVec3(lat, lon, 1.003) };
        }
      }
      return null;
    }

    // hoverLayers[cur] holds the hovered country; the other layer keeps the previous one fading out
    let hovered = null, cur = 0;
    function setHover(c) {
      if (c === hovered) return;
      hovered = c;
      if (c) {
        cur = 1 - cur;
        const L = hoverLayers[cur];
        L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
        L.ctx.fillStyle = '#fff';
        drawCountry(L.ctx, c, L.canvas.width, L.canvas.height);
        L.tex.needsUpdate = true;
        L.strength = 0;
      }
      renderer.domElement.classList.toggle('is-over-country', !!c);
    }
    function stepHover(dt) {
      const k = 1 - Math.exp(-dt * 14); // ~150ms ease
      hoverLayers.forEach((L, i) => {
        const target = hovered && i === cur ? 1 : 0;
        L.strength += (target - L.strength) * k;
      });
      body.material.uniforms.uHoverStrength.value.set(hoverLayers[0].strength, hoverLayers[1].strength);
    }

    // -------------------------------------------------------------------------
    // Tooltip — reuses the page's .coverage-map_tooltip, pinned to the country
    // -------------------------------------------------------------------------
    const wrapper = host.closest('.coverage-map_wrapper') || container.parentElement;
    const tooltip = (wrapper && wrapper.querySelector('.coverage-map_tooltip')) || document.querySelector('.coverage-map_tooltip');
    let pinned = null;
    if (tooltip) tooltip.style.display = 'none';

    function openTooltip(sel) {
      if (!tooltip) return;
      pinned = sel;
      const ttCountry = tooltip.querySelector('.coverage-map_tooltip-country');
      const ttStatus = tooltip.querySelector('.coverage-map_tooltip-status');
      if (ttCountry) ttCountry.textContent = sel.country.label;
      if (ttStatus) ttStatus.textContent = sel.country.status;
      tooltip.setAttribute('data-status', sel.country.status);
      Object.assign(tooltip.style, { position: 'absolute', transform: 'translate(-50%, -110%)', display: 'block', pointerEvents: 'auto', cursor: 'pointer', zIndex: 5 });
      placeTooltip();
    }
    function closeTooltip() {
      pinned = null;
      if (tooltip) tooltip.style.display = 'none';
    }
    // dismiss: clicking the label itself, or anywhere off the globe (on-globe clicks are handled by picking)
    if (tooltip) tooltip.addEventListener('click', e => { e.stopPropagation(); closeTooltip(); });
    document.addEventListener('pointerdown', e => {
      if (pinned && e.target !== renderer.domElement && !(tooltip && tooltip.contains(e.target))) closeTooltip();
    });
    function placeTooltip() {
      if (!pinned || !tooltip) return;
      spinGroup.updateMatrixWorld();
      if (facingOf(pinned.anchor) < 0.05) { tooltip.style.display = 'none'; return; }
      tooltip.style.display = 'block';
      const [sx, sy] = toScreen(pinned.anchor);
      const cr = container.getBoundingClientRect();
      const wr = (tooltip.offsetParent || wrapper).getBoundingClientRect();
      tooltip.style.left = `${cr.left - wr.left + sx}px`;
      tooltip.style.top = `${cr.top - wr.top + sy}px`;
    }

    // -------------------------------------------------------------------------
    // Interaction — drag to rotate (with inertia), hover, tap/click to select
    // -------------------------------------------------------------------------
    const canvas = renderer.domElement;
    let dragging = false, moved = 0, lastX = 0, lastY = 0, velY = 0, pitch = 0, overGlobe = false;
    let pendingHover = null;

    canvas.addEventListener('pointerdown', e => {
      dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
    });
    canvas.addEventListener('pointermove', e => {
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        velY = dx * 0.005;
        spinGroup.rotation.y += velY;
        // full tilt range so people can rotate to either pole
        pitch = THREE.MathUtils.clamp(pitch + dy * 0.005, -Math.PI / 2 - CONFIG.viewPitch, Math.PI / 2 - CONFIG.viewPitch);
        if (moved > 6) setHover(null);
      } else if (e.pointerType === 'mouse') {
        pendingHover = [e.clientX, e.clientY]; // resolved once per frame
      }
    });
    const endDrag = e => {
      if (!dragging) return;
      dragging = false;
      if (moved <= 6) {
        const sel = pick(e.clientX, e.clientY);
        if (sel) openTooltip(sel); else closeTooltip();
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', () => { dragging = false; });
    canvas.addEventListener('pointerenter', () => { overGlobe = true; });
    canvas.addEventListener('pointerleave', () => { overGlobe = false; pendingHover = null; setHover(null); });

    // -------------------------------------------------------------------------
    // Zoom, resize + loop (paused while off-screen)
    // -------------------------------------------------------------------------
    // zoom 1 is the default top-3/4 view; zooming out recentres until the whole globe fits
    let zoom = CONFIG.zoom, zoomTarget = CONFIG.zoom;
    let introRise = 0, introScale = 1; // driven by the intro animation, 0 / 1 at rest
    const zoomUi = document.createElement('div');
    zoomUi.className = 'ncg-zoom';
    zoomUi.innerHTML = '<button type="button" aria-label="Zoom in">+</button><button type="button" aria-label="Zoom out">\u2212</button>';
    container.appendChild(zoomUi);
    const [zoomInBtn, zoomOutBtn] = zoomUi.querySelectorAll('button');
    const setZoom = z => {
      zoomTarget = THREE.MathUtils.clamp(z, CONFIG.minZoom, CONFIG.maxZoom);
      zoomInBtn.disabled = zoomTarget >= CONFIG.maxZoom - 1e-3;
      zoomOutBtn.disabled = zoomTarget <= CONFIG.minZoom + 1e-3;
    };
    zoomInBtn.addEventListener('click', () => setZoom(zoomTarget * 1.3));
    zoomOutBtn.addEventListener('click', () => setZoom(zoomTarget / 1.3));
    // Wheel zoom. Trackpad pinch (ctrl+wheel) always zooms; a plain wheel only zooms once someone has
    // clicked or dragged the globe, and goes back to scrolling the page as soon as the cursor leaves it,
    // so people scrolling past are never trapped.
    let wheelActive = false;
    canvas.addEventListener('pointerdown', () => { wheelActive = true; });
    canvas.addEventListener('pointerleave', () => { wheelActive = false; });
    canvas.addEventListener('wheel', e => {
      if (!e.ctrlKey && !wheelActive) return;
      e.preventDefault();
      const step = e.ctrlKey ? 0.01 : 0.0015; // pinch deltas are small, mouse-wheel deltas are large
      setZoom(zoomTarget * Math.exp(-e.deltaY * step));
    }, { passive: false });

    // Zoom buttons mirror the page's legend: top-left, same inset from the left as the legend has from the right
    const legend = wrapper && wrapper.querySelector('.coverage-map-legend');
    function placeZoomUi() {
      if (!legend) return;
      const cr = container.getBoundingClientRect(), lr = legend.getBoundingClientRect();
      if (!lr.width) return;
      zoomUi.style.top = `${lr.top - cr.top}px`;
      zoomUi.style.left = `${cr.right - lr.right}px`;
    }
    setZoom(CONFIG.zoom);

    function layout() {
      const { clientWidth: w, clientHeight: h } = container;
      if (!w || !h) return;
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const rPx = CONFIG.globeRadius * h * zoom * introScale;
      // top-anchored while the globe is taller than the frame, centred once it fits
      const cy = Math.max(h / 2, CONFIG.topMargin * h + rPx) + introRise * h;
      const dist = 1 / Math.sin(Math.atan((2 * rPx / h) * tanHalf));
      camera.position.set(0, 0, dist);
      tiltGroup.position.set(
        (CONFIG.globeX * 2 - 1) * tanHalf * camera.aspect * dist,
        (1 - (cy / h) * 2) * tanHalf * dist,
        0,
      );
    }
    function resize() {
      const { clientWidth: w, clientHeight: h } = container;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      resizeDust(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      layout();
      placeTooltip();
      placeZoomUi();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    if (legend) ro.observe(legend); // e.g. the legend's web font loading late
    resize();

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clock = new THREE.Clock();

    // Intro — rises from below while spinning fast, then slows and lands on the start view
    let intro = reduceMotion ? null : { start: 0, baseY: spinGroup.rotation.y };
    const setIntroVisible = v => {
      canvas.style.opacity = v === 1 ? '' : String(v);
      zoomUi.style.opacity = v === 1 ? '' : String(v);
    };
    if (intro) {
      setIntroVisible(0);
      canvas.style.pointerEvents = 'none';
    }
    function stepIntro(now) {
      if (!intro || !intro.start) return;
      const p = Math.min((now - intro.start) / (CONFIG.introDuration * 1000), 1);
      const rise = 1 - Math.pow(1 - p, 3); // easeOutCubic: the rise stays readable
      const turn = 1 - Math.pow(1 - p, 4); // easeOutQuart: spins fast, then a long gentle settle
      introRise = CONFIG.introRise * (1 - rise);
      introScale = CONFIG.introScale + (1 - CONFIG.introScale) * rise;
      spinGroup.rotation.y = intro.baseY - CONFIG.introTurns * Math.PI * 2 * (1 - turn);
      setIntroVisible(Math.min(1, p / 0.3));
      layout();
      if (p >= 1) {
        intro = null;
        introRise = 0; introScale = 1;
        canvas.style.pointerEvents = '';
        setIntroVisible(1);
      }
    }
    let spin = 1; // eased spin factor: slows to a stop while hovering or a country is selected
    const frame = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      if (pendingHover) {
        const sel = pick(pendingHover[0], pendingHover[1]);
        setHover(sel ? sel.country : null);
        pendingHover = null;
      }
      if (Math.abs(zoomTarget - zoom) > 1e-4) {
        zoom += (zoomTarget - zoom) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 10));
        layout();
      }
      const targetSpin = reduceMotion || overGlobe || pinned ? 0 : 1;
      spin += (targetSpin - spin) * (1 - Math.exp(-dt * 4));
      if (intro) {
        stepIntro(performance.now());
      } else if (!dragging) {
        velY *= 0.94;
        spinGroup.rotation.y += velY + CONFIG.spinSpeed * spin * dt;
      }
      tiltGroup.rotation.x = CONFIG.viewPitch + pitch;
      drawDust(reduceMotion ? 0 : dt);
      stepHover(reduceMotion ? 1 : dt);
      renderer.render(scene, camera);
      placeTooltip();
    };
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (intro && !intro.start) intro.start = performance.now();
        clock.getDelta();
        renderer.setAnimationLoop(frame);
      }
      else renderer.setAnimationLoop(null);
    }).observe(container);
    frame();
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    // the page's tooltip ships visible with placeholder text; keep it hidden until a country is picked
    document.querySelectorAll('.coverage-map_tooltip').forEach(t => { t.style.display = 'none'; });
    let hosts = [...document.querySelectorAll('[data-coverage-globe]')];
    if (!hosts.length) hosts = [...document.querySelectorAll('.coverage-map_svg-holder')];
    // lazy: nothing (Three.js, map data) is fetched until the map is within ~600px of the viewport
    hosts.forEach(host => {
      const start = () => mount(host).catch(e => console.warn('[coverage-globe] failed to start', e));
      if (!('IntersectionObserver' in window)) return start();
      const io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      }, { rootMargin: '600px 0px' });
      io.observe(host);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
