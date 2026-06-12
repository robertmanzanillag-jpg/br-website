class LiquidDistortion {
  constructor(container, images) {
    this.container = container;
    this.images = images;
    this.currentIndex = Math.floor(Math.random() * images.length);
    this.mouse = { x: 0, y: 0 };
    this.targetMouse = { x: 0, y: 0 };
    this.intensity = 0.0;
    this.targetIntensity = 0.02;
    this.rgbShift = 0.0;
    this.time = 0;
    
    this.init();
  }

  init() {
    if (!this.isWebGLAvailable()) {
      this.createFallback();
      return;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.z = 1;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.position = 'fixed';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.zIndex = '-1';

    this.createNoiseTexture();
    this.loadTexture();
    this.addEventListeners();
    this.animate();
  }

  createNoiseTexture() {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    
    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = Math.floor(i / size);
      const noise = this.perlinNoise(x * 0.05, y * 0.05);
      const value = Math.floor((noise + 1) * 127.5);
      
      data[i * 4] = value;
      data[i * 4 + 1] = value;
      data[i * 4 + 2] = value;
      data[i * 4 + 3] = 255;
    }

    this.noiseTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    this.noiseTexture.wrapS = THREE.RepeatWrapping;
    this.noiseTexture.wrapT = THREE.RepeatWrapping;
    this.noiseTexture.needsUpdate = true;
  }

  perlinNoise(x, y) {
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + t * (b - a);
    const grad = (hash, x, y) => {
      const h = hash & 3;
      const u = h < 2 ? x : y;
      const v = h < 2 ? y : x;
      return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    };

    const p = new Array(512);
    const perm = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,
                  190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,
                  125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,
                  105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,
                  135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,
                  82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,
                  153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,
                  251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,
                  157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
    
    for (let i = 0; i < 256; i++) {
      p[i] = perm[i];
      p[256 + i] = perm[i];
    }

    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];

    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v
    );
  }

  loadTexture() {
    const loader = new THREE.TextureLoader();
    const imagePath = this.images[this.currentIndex];
    
    loader.load(imagePath, (texture) => {
      this.texture = texture;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.createMesh();
    }, undefined, (err) => {
      console.error('Error loading texture:', err);
      this.currentIndex = (this.currentIndex + 1) % this.images.length;
      this.loadTexture();
    });
  }

  createMesh() {
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      precision highp float;
      
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform sampler2D uDisplacement;
      uniform float uIntensity;
      uniform float uRgbShift;
      uniform vec2 uMouse;
      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec2 uImageSize;
      
      void main() {
        vec2 ratio = vec2(
          min((uResolution.x / uResolution.y) / (uImageSize.x / uImageSize.y), 1.0),
          min((uResolution.y / uResolution.x) / (uImageSize.y / uImageSize.x), 1.0)
        );
        
        vec2 uv = vec2(
          vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
          vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
        );
        
        vec2 mouseEffect = uMouse * 0.5;
        vec2 dispUv = uv + mouseEffect * 0.1;
        dispUv += vec2(sin(uTime * 0.5) * 0.01, cos(uTime * 0.3) * 0.01);
        
        vec4 disp = texture2D(uDisplacement, dispUv);
        float dispValue = (disp.r + disp.g + disp.b) / 3.0;
        
        float distFromMouse = length(vUv - (uMouse * 0.5 + 0.5));
        float mouseInfluence = smoothstep(0.8, 0.0, distFromMouse);
        
        float distortion = dispValue * uIntensity * (1.0 + mouseInfluence * 3.0);
        
        vec2 distortedUv = uv + vec2(
          distortion * (uMouse.x * 0.5 + sin(uTime * 0.7) * 0.2),
          distortion * (uMouse.y * 0.5 + cos(uTime * 0.5) * 0.2)
        );
        
        float rgbOffset = uRgbShift * (1.0 + mouseInfluence * 2.0);
        vec2 rgbDir = normalize(uMouse + vec2(0.001));
        
        float r = texture2D(uTexture, distortedUv + rgbDir * rgbOffset).r;
        float g = texture2D(uTexture, distortedUv).g;
        float b = texture2D(uTexture, distortedUv - rgbDir * rgbOffset).b;
        
        vec3 color = vec3(r, g, b);
        
        color *= 0.7;
        color = mix(color, color * vec3(0.9, 0.95, 1.0), 0.3);
        
        float vignette = 1.0 - smoothstep(0.4, 1.4, length(vUv - 0.5) * 1.5);
        color *= vignette;
        
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: this.texture },
        uDisplacement: { value: this.noiseTexture },
        uIntensity: { value: 0.0 },
        uRgbShift: { value: 0.0 },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uImageSize: { value: new THREE.Vector2(this.texture.image.width, this.texture.image.height) }
      },
      vertexShader,
      fragmentShader
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.mesh);
  }

  addEventListeners() {
    window.addEventListener('mousemove', (e) => {
      this.targetMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.targetMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      
      const speed = Math.sqrt(
        Math.pow(e.movementX, 2) + Math.pow(e.movementY, 2)
      );
      this.rgbShift = Math.min(speed * 0.001, 0.03);
    });

    window.addEventListener('mousedown', () => {
      this.targetIntensity = 0.08;
    });

    window.addEventListener('mouseup', () => {
      this.targetIntensity = 0.02;
    });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      if (this.material) {
        this.material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
      }
    });

    window.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      this.targetMouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
      this.targetMouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
    });

    window.addEventListener('touchstart', () => {
      this.targetIntensity = 0.08;
    });

    window.addEventListener('touchend', () => {
      this.targetIntensity = 0.02;
    });
  }

  isWebGLAvailable() {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && 
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  createFallback() {
    const imagePath = this.images[this.currentIndex];
    const isMobile = window.innerWidth <= 768;
    
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      background-image: url('${imagePath}');
      background-size: ${isMobile ? '200% auto' : 'cover'};
      background-position: ${isMobile ? '75% 60%' : 'center'};
      filter: brightness(0.5) saturate(0.8);
    `;
    console.log('Liquid distortion: Using CSS fallback');
    
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.7) 100%);
    `;
    this.container.appendChild(overlay);
    
    window.addEventListener('resize', () => {
      const nowMobile = window.innerWidth <= 768;
      this.container.style.backgroundSize = nowMobile ? '200% auto' : 'cover';
      this.container.style.backgroundPosition = nowMobile ? '75% 60%' : 'center';
    });
    
    console.log('Liquid distortion: Using CSS fallback');
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    this.time += 0.016;
    
    this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.08;
    this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.08;
    
    this.intensity += (this.targetIntensity - this.intensity) * 0.1;
    
    this.rgbShift *= 0.95;

    if (this.material) {
      this.material.uniforms.uMouse.value.set(this.mouse.x, this.mouse.y);
      this.material.uniforms.uIntensity.value = this.intensity;
      this.material.uniforms.uRgbShift.value = this.rgbShift;
      this.material.uniforms.uTime.value = this.time;
    }

    this.renderer.render(this.scene, this.camera);
  }
}

function initLiquidDistortion(containerId, images) {
  const container = document.getElementById(containerId);
  if (container && window.THREE) {
    new LiquidDistortion(container, images);
  }
}
