/*
 * Numeral connection globe — self-contained WebGL embed.
 * Mounts into every [data-numeral-globe] or [data-gs-alt="globe-mount"] element and fills its nearest
 * positioned ancestor (give that box position: relative/absolute and a size).
 * Optional data attributes on the mount: data-labels="usa,uk,jpn,aus" (or "none"),
 * data-globe-x / data-globe-y (centre as a fraction of width / height), data-globe-radius (fraction of height),
 * data-spin-speed, data-start-longitude, data-view-pitch, data-mouse (0 turns off mouse follow, 1 = default strength),
 * data-ocean-opacity, data-rim-color, data-pill-size (px), data-arc-width / data-arc-pulse-width (px),
 * data-background="depth" (adds a drifting depth-of-field particle field behind the globe).
 */
(() => {
  if (window.__numeralConnectionGlobe) return;
  window.__numeralConnectionGlobe = true;

  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
  const TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';
  const MAP_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';

  // ---------------------------------------------------------------------------
  // Defaults — Numeral palette (slate scale + #464a70 primary)
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    lineColor: '#9192a2',      // graticule (matches numeral.com globe stroke)
    fillColor: '#fbfcfd',      // ocean (base-bg)
    oceanOpacity: 0.9,         // lower it to let the background show through the sea
    landColor: '#f1f5f9',      // slate-100 land fill
    borderColor: '#e2e8f0',    // slate-200 country outlines
    borderOpacity: 0.85,
    graticuleOpacity: 0.3,
    rimColor: '#94a3b8',       // slate-400 silhouette
    arcColor: '#464a70',       // base-primary
    arcBaseColor: '#8b90b0',   // resting line under the pulse
    arcWidth: 0.75,            // px, resting line
    arcPulseWidth: 2,          // px, at the pulse
    markerColor: '#464a70',
    pillSize: 9,               // label font size, px (padding scales with it)
    background: '',            // 'depth' = particle field behind the globe
    bgCount: 450,              // particles in the depth field
    bgColor: '#94a3b8',        // slate-400 dust
    bgAccent: '#464a70',       // a few base-primary motes
    backOpacity: 0.1,          // how visible the far side of the wireframe is
    meridianStep: 15,          // degrees between meridians
    parallels: [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75],
    tilt: 18,                  // axis tilt in degrees
    spinSpeed: 0.04,           // radians / second
    startLongitude: -30,       // longitude facing the camera at load
    arcSpeed: 0.16,
    labels: ['usa', 'uk', 'uae', 'bra', 'zaf'],
    viewPitch: 0.5,            // tip the north pole toward the viewer (radians)
    mouse: 1,                  // strength of the turn toward the cursor (0 = off)
    mouseYaw: 0.35,            // radians of turn at the viewport edge, left/right
    mousePitch: 0.2,           // radians of turn at the viewport edge, up/down
    // framing, matched to the get-started-alt Figma (368×362 box): globe bleeds off the right and bottom
    globeX: 0.564,             // centre, fraction of container width
    globeY: 0.593,             // centre, fraction of container height
    globeRadius: 0.503,        // radius, fraction of container height
  };

  // [lat, lon, label]
  const COUNTRIES = {
    usa: [39.5, -98.35, '$ USA'],        can: [56.1, -106.3, 'CA$ Canada'],
    mex: [23.6, -102.5, 'MX$ Mexico'],   bra: [-14.2, -51.9, 'R$ Brazil'],
    uk:  [54.0, -2.0,   '£ UK'],         deu: [51.2, 10.4,   '€ Germany'],
    fra: [46.6, 2.2,    '€ France'],     swe: [62.0, 15.0,   'kr Sweden'],
    uae: [24.0, 54.0,   'AED UAE'],      ind: [21.0, 78.0,   '₹ India'],
    sgp: [1.35, 103.8,  'S$ Singapore'], jpn: [36.2, 138.3,  '¥ Japan'],
    aus: [-25.3, 133.8, 'AU$ Australia'], zaf: [-30.6, 22.9, 'R South Africa'],
  };

  const CONNECTIONS = [
    ['usa', 'uk'], ['usa', 'jpn'], ['usa', 'aus'], ['usa', 'deu'], ['usa', 'can'],
    ['usa', 'mex'], ['usa', 'bra'], ['uk', 'ind'], ['uk', 'uae'], ['deu', 'swe'],
    ['fra', 'zaf'], ['uae', 'sgp'], ['ind', 'sgp'], ['sgp', 'aus'], ['jpn', 'sgp'],
    ['bra', 'uk'], ['can', 'fra'],
  ];

  const STYLE = `
    /* fills the nearest positioned ancestor, so a zero-height Webflow .w-embed wrapper doesn't collapse it */
    .ngl-root { position: absolute; inset: 0; overflow: hidden; }
    .ngl-root canvas { display: block; width: 100%; height: 100%; cursor: grab; touch-action: pan-y; }
    .ngl-root canvas:active { cursor: grabbing; }
    .ngl-pill {
      position: absolute; left: 0; top: 0; pointer-events: none; white-space: nowrap;
      padding: 0.45em 0.7em; border-radius: 3px;
      background: #464a70; color: #fff;
      font: 500 var(--ngl-pill-size, 9px)/1 "Aeonik Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: 0.08em; text-transform: uppercase;
      box-shadow: 0 1px 2px rgba(15,23,42,0.12);
      opacity: 0; will-change: transform, opacity;
    }`;

  // shared across mounts
  let libs = null, mapData = null;
  const loadLibs = () => libs ??= Promise.all([import(THREE_URL), import(TOPOJSON_URL)]);
  const loadMap = () => mapData ??= fetch(MAP_URL).then(r => r.json());

  function readOptions(el) {
    const d = el.dataset, o = { ...DEFAULTS };
    const num = (key, attr) => { if (d[attr] != null && !isNaN(+d[attr])) o[key] = +d[attr]; };
    num('globeX', 'globeX');
    num('globeY', 'globeY');
    num('globeRadius', 'globeRadius');
    num('spinSpeed', 'spinSpeed');
    num('startLongitude', 'startLongitude');
    num('viewPitch', 'viewPitch');
    num('mouse', 'mouse');
    num('oceanOpacity', 'oceanOpacity');
    num('pillSize', 'pillSize');
    num('arcWidth', 'arcWidth');
    num('arcPulseWidth', 'arcPulseWidth');
    if (d.rimColor) o.rimColor = d.rimColor;
    if (d.background) o.background = d.background;
    num('bgCount', 'bgCount');
    if (d.labels != null) o.labels = d.labels === 'none' ? [] : d.labels.split(',').map(s => s.trim());
    return o;
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

  async function mount(host) {
    const [THREE, topojson] = await loadLibs();
    const CONFIG = readOptions(host);

    // Raw ShaderMaterials skip output conversion, so keep colors in sRGB end to end
    THREE.ColorManagement.enabled = false;

    const container = document.createElement('div');
    container.className = 'ngl-root';
    container.style.setProperty('--ngl-pill-size', CONFIG.pillSize + 'px');
    host.appendChild(container);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);

    const uniformsTime = { value: 0 };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

    // -------------------------------------------------------------------------
    // Depth background — particles spread through z, drawn with depth of field:
    // in-focus ones are small and crisp, near/far ones grow soft and fade
    // -------------------------------------------------------------------------
    const bgScene = new THREE.Scene();
    const bgCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
    bgCamera.position.set(0, 0, 6);
    const BG_FOCUS = 9;          // camera distance that is in focus
    const BG_NEAR = -12, BG_DEPTH = 14; // particles live in z ∈ [-12, 2]
    const bgUniforms = { uScale: { value: 400 } };
    if (CONFIG.background === 'depth') {
      const n = CONFIG.bgCount, pos = [], seed = [], size = [], accent = [];
      for (let i = 0; i < n; i++) {
        pos.push((Math.random() * 2 - 1) * 7, (Math.random() * 2 - 1) * 5, BG_NEAR + Math.random() * BG_DEPTH);
        seed.push(Math.random());
        size.push(0.018 + Math.random() * 0.03);
        accent.push(Math.random() < 0.12 ? 1 : 0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
      geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
      geo.setAttribute('aAccent', new THREE.Float32BufferAttribute(accent, 1));
      bgScene.add(new THREE.Points(geo, new THREE.ShaderMaterial({
        uniforms: {
          uTime: uniformsTime,
          uPixelRatio: { value: renderer.getPixelRatio() },
          uScale: bgUniforms.uScale,
          uColor: { value: new THREE.Color(CONFIG.bgColor) },
          uAccent: { value: new THREE.Color(CONFIG.bgAccent) },
        },
        vertexShader: /* glsl */`
          uniform float uTime; uniform float uPixelRatio; uniform float uScale;
          attribute float aSeed; attribute float aSize; attribute float aAccent;
          varying float vAlpha; varying float vBlur; varying float vAccent;
          void main() {
            vec3 p = position;
            // gentle wander, plus a slow drift toward the viewer that wraps around
            p.x += sin(uTime * 0.13 + aSeed * 6.2831) * 0.18;
            p.y += cos(uTime * 0.11 + aSeed * 12.566) * 0.14;
            p.z = mod(p.z - ${BG_NEAR.toFixed(1)} + uTime * 0.18, ${BG_DEPTH.toFixed(1)}) + ${BG_NEAR.toFixed(1)};
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float depth = -mv.z;
            vBlur = clamp(abs(depth - ${BG_FOCUS.toFixed(1)}) / 7.0, 0.0, 1.0);
            // fade in from the far end, out before the near end, so the wrap never pops
            vAlpha = smoothstep(19.5, 14.0, depth) * smoothstep(4.0, 6.5, depth) * (1.0 - vBlur * 0.55);
            vAccent = aAccent;
            gl_PointSize = aSize * uScale / depth * (1.0 + vBlur * 3.0) * uPixelRatio;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uColor; uniform vec3 uAccent;
          varying float vAlpha; varying float vBlur; varying float vAccent;
          void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            // crisp disc in focus, wide soft bokeh out of focus
            float a = 1.0 - smoothstep(mix(0.55, 0.0, vBlur), 1.0, r);
            a *= vAlpha * mix(0.6, 0.28, vBlur);
            if (a < 0.004) discard;
            gl_FragColor = vec4(mix(uColor, uAccent, vAccent), a);
          }`,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })));
    }

    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = THREE.MathUtils.degToRad(CONFIG.tilt);
    const spinGroup = new THREE.Group();
    spinGroup.rotation.y = THREE.MathUtils.degToRad(-90 - CONFIG.startLongitude);
    tiltGroup.add(spinGroup);
    scene.add(tiltGroup);

    const uniforms = {
      uTime: uniformsTime,
      uPixelRatio: { value: renderer.getPixelRatio() },
      uBack: { value: CONFIG.backOpacity },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uMarkerSize: { value: 20 },
    };

    function latLonToVec3(lat, lon, r = 1) {
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const theta = THREE.MathUtils.degToRad(lon + 180);
      return new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      );
    }

    // Shared GLSL: 1 on the camera-facing hemisphere, uBack on the far side
    const FACING_GLSL = /* glsl */`
      uniform float uBack;
      float facingFade(vec3 pos, vec4 mv) {
        float f = dot(normalize(normalMatrix * pos), normalize(-mv.xyz));
        return mix(uBack, 1.0, smoothstep(-0.05, 0.2, f));
      }`;

    // -------------------------------------------------------------------------
    // Sphere body — ocean + baked land fill, thin silhouette rim
    // -------------------------------------------------------------------------
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.998, 96, 96),
      new THREE.ShaderMaterial({
        uniforms: {
          uFill: { value: new THREE.Color(CONFIG.fillColor) },
          uLandColor: { value: new THREE.Color(CONFIG.landColor) },
          uLand: { value: null },
          uHasLand: { value: 0 },
          uRim: { value: new THREE.Color(CONFIG.rimColor) },
          uOceanOpacity: { value: CONFIG.oceanOpacity },
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
          uniform vec3 uFill; uniform vec3 uRim; uniform vec3 uLandColor;
          uniform sampler2D uLand; uniform float uHasLand; uniform float uOceanOpacity;
          varying vec3 vN; varying vec3 vV; varying vec2 vUv;
          void main() {
            float f = 1.0 - max(dot(vN, vV), 0.0);
            float rim = smoothstep(0.94, 0.995, f);
            float land = uHasLand * texture2D(uLand, vUv).r;
            vec3 col = mix(mix(uFill, uLandColor, land), uRim, rim);
            // land stays solid; only the sea takes oceanOpacity
            gl_FragColor = vec4(col, mix(mix(uOceanOpacity, 1.0, land), 1.0, rim));
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    body.renderOrder = 0;
    spinGroup.add(body);

    // A plain faded line material used by the graticule and the borders
    const fadedLineMaterial = (color, opacity, hideBack) => new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
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
          float a = uOpacity * ${hideBack ? 'smoothstep(0.5, 1.0, vFade)' : 'vFade'};
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true,
      depthWrite: false,
    });

    // -------------------------------------------------------------------------
    // Graticule — meridians + parallels as one LineSegments
    // -------------------------------------------------------------------------
    {
      const pos = [];
      const STEPS = 180;
      const push = (a, b) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      for (let lon = -180; lon < 180; lon += CONFIG.meridianStep) {
        for (let i = 0; i < STEPS; i++) {
          push(latLonToVec3(-90 + (180 * i) / STEPS, lon), latLonToVec3(-90 + (180 * (i + 1)) / STEPS, lon));
        }
      }
      for (const lat of CONFIG.parallels) {
        for (let i = 0; i < STEPS * 2; i++) {
          push(latLonToVec3(lat, -180 + (360 * i) / (STEPS * 2)), latLonToVec3(lat, -180 + (360 * (i + 1)) / (STEPS * 2)));
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const lines = new THREE.LineSegments(geo, fadedLineMaterial(CONFIG.lineColor, CONFIG.graticuleOpacity, false));
      lines.renderOrder = 1;
      spinGroup.add(lines);
    }

    // -------------------------------------------------------------------------
    // Countries — 1:50m borders as lines, land fill baked into the sphere texture
    // -------------------------------------------------------------------------
    function bakeLandTexture(land, w = 4096, h = 2048) {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      for (const f of land.features) {
        const g = f.geometry;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const poly of polys) {
          ctx.beginPath();
          for (const raw of poly) {
            const ring = unwrapRing(raw);
            const first = ring[0], last = ring[ring.length - 1];
            // rings that wrap the globe (Antarctica) close via the nearest pole
            if (Math.abs(last[0] - first[0]) > 180) {
              const pole = first[1] < 0 ? -90 : 90;
              ring.push([last[0], pole], [first[0], pole]);
            }
            for (const shift of [-360, 0, 360]) {
              ring.forEach(([lon, lat], i) => {
                const x = ((lon + shift + 180) / 360) * w, y = ((90 - lat) / 180) * h;
                i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
              });
              ctx.closePath();
            }
          }
          ctx.fill('evenodd');
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.NoColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return tex;
    }

    loadMap().then(topo => {
      body.material.uniforms.uLand.value = bakeLandTexture(topojson.feature(topo, topo.objects.land));
      body.material.uniforms.uHasLand.value = 1;

      // every coastline and border arc exactly once
      const mesh = topojson.mesh(topo, topo.objects.countries);
      const pos = [];
      for (const line of mesh.coordinates) {
        for (let i = 1; i < line.length; i++) {
          if (Math.abs(line[i][0] - line[i - 1][0]) > 180) continue;
          const a = latLonToVec3(line[i - 1][1], line[i - 1][0], 1.0005);
          const b = latLonToVec3(line[i][1], line[i][0], 1.0005);
          pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      // far-side borders stay hidden: they'd turn the globe into noise
      const borders = new THREE.LineSegments(geo, fadedLineMaterial(CONFIG.borderColor, CONFIG.borderOpacity, true));
      borders.renderOrder = 1;
      spinGroup.add(borders);
    }).catch(e => console.warn('[numeral-globe] country data failed to load', e));

    // -------------------------------------------------------------------------
    // Arcs — screen-space ribbons (WebGL lines are stuck at 1px), pulse in shader
    // -------------------------------------------------------------------------
    {
      const SEGMENTS = 120;
      const pos = [], other = [], side = [], dir = [], t = [], seed = [], speed = [], index = [];
      const p = new THREE.Vector3(), q = new THREE.Vector3();

      const pointOnArc = (a, b, angle, h, u, out) => {
        // spherical lerp, then lift off the surface with a sine profile
        const s = Math.sin(angle);
        return out.copy(a).multiplyScalar(Math.sin((1 - u) * angle) / s)
          .addScaledVector(b, Math.sin(u * angle) / s)
          .normalize()
          .multiplyScalar(1 + h * Math.sin(Math.PI * u));
      };

      let v = 0;
      CONNECTIONS.forEach(([from, to], idx) => {
        const a = latLonToVec3(COUNTRIES[from][0], COUNTRIES[from][1]);
        const b = latLonToVec3(COUNTRIES[to][0], COUNTRIES[to][1]);
        const angle = a.angleTo(b);
        const h = 0.03 + angle * 0.13;
        const sd = (idx * 0.618034) % 1;
        const sp = 0.8 + ((idx * 0.37) % 1) * 0.5;
        for (let i = 0; i < SEGMENTS; i++) {
          const u0 = i / SEGMENTS, u1 = (i + 1) / SEGMENTS;
          pointOnArc(a, b, angle, h, u0, p);
          pointOnArc(a, b, angle, h, u1, q);
          // 4 verts per segment: p-, p+, q-, q+ ; each knows the other end to extrude against
          for (const [self, oth, d, u] of [[p, q, 1, u0], [q, p, -1, u1]]) {
            for (const sgn of [-1, 1]) {
              pos.push(self.x, self.y, self.z);
              other.push(oth.x, oth.y, oth.z);
              side.push(sgn); dir.push(d); t.push(u); seed.push(sd); speed.push(sp);
            }
          }
          index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
          v += 4;
        }
      });

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aOther', new THREE.Float32BufferAttribute(other, 3));
      geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
      geo.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 1));
      geo.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
      geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
      geo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speed, 1));
      geo.setIndex(index);

      const arcs = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: {
          ...uniforms,
          uColor: { value: new THREE.Color(CONFIG.arcColor) },
          uBaseColor: { value: new THREE.Color(CONFIG.arcBaseColor) },
          uSpeed: { value: CONFIG.arcSpeed },
          uWidth: { value: CONFIG.arcWidth },
          uPulseWidth: { value: CONFIG.arcPulseWidth },
        },
        vertexShader: FACING_GLSL + /* glsl */`
          uniform float uTime; uniform float uSpeed;
          uniform vec2 uResolution; uniform float uPixelRatio;
          uniform float uWidth; uniform float uPulseWidth;
          attribute vec3 aOther; attribute float aSide; attribute float aDir;
          attribute float aT; attribute float aSeed; attribute float aSpeed;
          varying float vTrail; varying float vFade; varying float vSide;
          void main() {
            // head travels from -0.4 to 1.4 so the trail fully enters and leaves
            float head = fract(uTime * uSpeed * aSpeed + aSeed) * 1.8 - 0.4;
            float dd = head - aT;
            vTrail = step(0.0, dd) * smoothstep(0.4, 0.0, dd);
            vTrail *= vTrail;
            vSide = aSide;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vFade = facingFade(position, mv);
            vec4 clip = projectionMatrix * mv;
            vec4 clipO = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);
            vec2 sA = clip.xy / clip.w * uResolution;
            vec2 sB = clipO.xy / clipO.w * uResolution;
            vec2 d = normalize(sB - sA + 1e-6) * aDir;
            vec2 n = vec2(-d.y, d.x);
            // +1px so the edge can be antialiased in the fragment shader
            float w = (mix(uWidth, uPulseWidth, vTrail) + 1.0) * uPixelRatio;
            clip.xy += n * aSide * w / uResolution * clip.w;
            gl_Position = clip;
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uColor; uniform vec3 uBaseColor;
          varying float vTrail; varying float vFade; varying float vSide;
          void main() {
            float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
            vec3 col = mix(uBaseColor, uColor, vTrail);
            gl_FragColor = vec4(col, (0.55 + vTrail * 0.45) * vFade * edge);
          }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }));
      arcs.renderOrder = 2;
      spinGroup.add(arcs);
    }

    // -------------------------------------------------------------------------
    // Markers — dot with an expanding ring, plus Numeral-style pill labels
    // -------------------------------------------------------------------------
    const used = [...new Set(CONNECTIONS.flat())];
    const markerAnchors = used.map(key => latLonToVec3(COUNTRIES[key][0], COUNTRIES[key][1], 1.003));
    {
      const pos = [], seed = [];
      markerAnchors.forEach((v, i) => { pos.push(v.x, v.y, v.z); seed.push((i * 0.381966) % 1); });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
      const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uColor: { value: new THREE.Color(CONFIG.markerColor) } },
        vertexShader: FACING_GLSL + /* glsl */`
          uniform float uPixelRatio; uniform float uMarkerSize;
          attribute float aSeed;
          varying float vSeed; varying float vFade;
          void main() {
            vSeed = aSeed;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vFade = facingFade(position, mv);
            gl_PointSize = uMarkerSize * uPixelRatio;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`
          uniform float uTime; uniform vec3 uColor;
          varying float vSeed; varying float vFade;
          void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float core = smoothstep(0.17, 0.11, r);
            float p = fract(uTime * 0.45 + vSeed);
            float ring = smoothstep(0.04, 0.0, abs(r - p)) * (1.0 - p);
            float a = (core + ring * 0.5) * vFade;
            if (a < 0.01) discard;
            gl_FragColor = vec4(uColor, a);
          }`,
        transparent: true,
        depthWrite: false,
      }));
      pts.renderOrder = 3;
      spinGroup.add(pts);
    }

    const pills = used.map(key => {
      if (!CONFIG.labels.includes(key)) return null;
      const el = document.createElement('div');
      el.className = 'ngl-pill';
      el.textContent = COUNTRIES[key][2];
      container.appendChild(el);
      return el;
    });

    const tmpV = new THREE.Vector3(), tmpN = new THREE.Vector3(), camDir = new THREE.Vector3();
    function updatePills() {
      const w = container.clientWidth, h = container.clientHeight;
      spinGroup.updateMatrixWorld();
      markerAnchors.forEach((anchor, i) => {
        const el = pills[i];
        if (!el) return;
        tmpV.copy(anchor).applyMatrix4(spinGroup.matrixWorld);
        tmpN.copy(tmpV).normalize();
        camDir.copy(camera.position).sub(tmpV).normalize();
        const facing = tmpN.dot(camDir);
        tmpV.project(camera);
        const x = (tmpV.x * 0.5 + 0.5) * w;
        const y = (-tmpV.y * 0.5 + 0.5) * h;
        el.style.opacity = THREE.MathUtils.smoothstep(facing, 0.25, 0.55).toFixed(3);
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, calc(-100% - 6px))`;
        el.style.zIndex = Math.round(facing * 100) + 100;
      });
    }

    // -------------------------------------------------------------------------
    // Interaction — drag to spin / nudge, with inertia, then ease back
    // -------------------------------------------------------------------------
    let dragging = false, lastX = 0, lastY = 0, velY = 0, pitch = 0;
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      velY = dx * 0.005;
      spinGroup.rotation.y += velY;
      pitch = THREE.MathUtils.clamp(pitch + dy * 0.004, -0.6, 0.6);
    });
    const endDrag = () => { dragging = false; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // Mouse follow — the globe turns gently toward the cursor anywhere on the page
    const mouse = { x: 0, y: 0, yaw: 0, pitch: 0 };
    const followMouse = CONFIG.mouse > 0 && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (followMouse) {
      window.addEventListener('pointermove', e => {
        const r = container.getBoundingClientRect();
        // cursor relative to the globe box, normalised by the viewport so it reaches ±1 near the edges
        mouse.x = THREE.MathUtils.clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2), -1, 1);
        mouse.y = THREE.MathUtils.clamp((e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2), -1, 1);
      }, { passive: true });
      document.documentElement.addEventListener('pointerleave', () => { mouse.x = 0; mouse.y = 0; });
    }

    // -------------------------------------------------------------------------
    // Resize + loop (paused while off-screen)
    // -------------------------------------------------------------------------
    function resize() {
      const { clientWidth: w, clientHeight: h } = container;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.getDrawingBufferSize(uniforms.uResolution.value);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // place the camera so the unit sphere's silhouette has the requested radius and centre
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const rPx = CONFIG.globeRadius * h;
      const dist = 1 / Math.sin(Math.atan((2 * rPx / h) * tanHalf));
      camera.position.set(0, 0, dist);
      tiltGroup.position.set(
        (CONFIG.globeX * 2 - 1) * tanHalf * camera.aspect * dist,
        (1 - CONFIG.globeY * 2) * tanHalf * dist,
        0,
      );
      uniforms.uMarkerSize.value = Math.max(12, rPx * 0.11);
      bgCamera.aspect = w / h;
      bgCamera.updateProjectionMatrix();
      bgUniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(bgCamera.fov / 2)));
    }
    new ResizeObserver(resize).observe(container);
    resize();

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clock = new THREE.Clock();
    const frame = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      uniforms.uTime.value += reduceMotion ? 0 : dt;
      if (!dragging) {
        velY *= 0.94;
        spinGroup.rotation.y += velY + (reduceMotion ? 0 : CONFIG.spinSpeed * dt);
        pitch *= 0.97;
      }
      if (followMouse && !reduceMotion) {
        const k = 1 - Math.exp(-dt * 3); // frame-rate independent easing
        mouse.yaw += (mouse.x * CONFIG.mouseYaw * CONFIG.mouse - mouse.yaw) * k;
        mouse.pitch += (mouse.y * CONFIG.mousePitch * CONFIG.mouse - mouse.pitch) * k;
      }
      tiltGroup.rotation.x = CONFIG.viewPitch + pitch + mouse.pitch;
      tiltGroup.rotation.y = mouse.yaw;
      renderer.clear();
      if (bgScene.children.length) {
        // parallax: the background camera slides with the cursor, so near and far layers separate
        bgCamera.position.x = mouse.yaw * 4;
        bgCamera.position.y = -mouse.pitch * 4;
        bgCamera.lookAt(0, 0, -4);
        renderer.render(bgScene, bgCamera);
        renderer.clearDepth();
      }
      renderer.render(scene, camera);
      updatePills();
    };
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { clock.getDelta(); renderer.setAnimationLoop(frame); }
      else renderer.setAnimationLoop(null);
    }).observe(container);
    frame();
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    document.querySelectorAll('[data-numeral-globe], [data-gs-alt="globe-mount"]').forEach(host => {
      mount(host).catch(e => console.warn('[numeral-globe] failed to start', e));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
