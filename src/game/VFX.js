import * as THREE from 'three';
import { clamp } from './math.js';
import { loadPhotoTexture } from './photoTexture.js';

const MAX_PARTICLES = 700;
const UP = new THREE.Vector3(0, 1, 0);
const PHOTO_EFFECTS = Object.freeze({
  arrow: loadPhotoTexture('/assets/larp/effects/arrow.webp'),
  bolt: loadPhotoTexture('/assets/larp/effects/bolt.webp'),
  knife: loadPhotoTexture('/assets/larp/effects/knife.webp'),
  fireball: loadPhotoTexture('/assets/larp/effects/fireball.webp'),
  lightning: loadPhotoTexture('/assets/larp/effects/lightning-impact.webp'),
  dust: loadPhotoTexture('/assets/larp/effects/dust-impact.webp'),
});

function createParticleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      attribute float size;
      attribute float alpha;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float pixelRatio;
      void main() {
        vColor = color;
        vAlpha = alpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * pixelRatio * (160.0 / max(1.0, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float core = 1.0 - smoothstep(0.12, 0.5, d);
        if (core <= 0.0) discard;
        gl_FragColor = vec4(vColor * (1.0 + core * 0.8), vAlpha * core);
      }
    `,
  });
}

export class VFX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'effects';
    this.scene.add(this.root);
    this.particles = [];
    this.transients = [];
    this.debris = [];
    this.particleLimit = 560;
    this.debrisLimit = 72;
    this.lastParticleCount = 0;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3),
    );
    geometry.setAttribute(
      'size',
      new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1),
    );
    geometry.setAttribute(
      'alpha',
      new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1),
    );
    geometry.setDrawRange(0, 0);
    this.particlePoints = new THREE.Points(geometry, createParticleMaterial());
    this.particlePoints.frustumCulled = false;
    this.root.add(this.particlePoints);

    this.chunkGeometry = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    this.shellGeometry = new THREE.BoxGeometry(0.035, 0.035, 0.11);
  }

  clear() {
    this.particles.length = 0;
    for (const entry of this.transients) {
      this.root.remove(entry.object);
      entry.dispose?.();
    }
    for (const entry of this.debris) {
      this.root.remove(entry.mesh);
      entry.mesh.material.dispose();
    }
    this.transients.length = 0;
    this.debris.length = 0;
    this.particlePoints.geometry.setDrawRange(0, 0);
  }

  addParticle(position, velocity, color, life, size = 0.08, gravity = 6, drag = 0.7) {
    if (this.particles.length >= this.particleLimit) this.particles.shift();
    this.particles.push({
      position: position.clone(),
      velocity: velocity.clone(),
      color: new THREE.Color(color),
      life,
      maxLife: life,
      size,
      gravity,
      drag,
    });
  }

  spawnPhotoEffect(effect, position, width, height, life, options = {}) {
    const material = new THREE.SpriteMaterial({
      map: PHOTO_EFFECTS[effect] ?? PHOTO_EFFECTS.dust,
      color: options.color ?? 0xffffff,
      transparent: true,
      alphaTest: 0.025,
      opacity: options.opacity ?? 1,
      depthWrite: false,
      depthTest: true,
      fog: true,
      toneMapped: options.toneMapped ?? true,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = `individual-photographic-effect-${effect}`;
    sprite.position.copy(position);
    sprite.scale.set(width, height, 1);
    this.root.add(sprite);
    const baseOpacity = material.opacity;
    this.transients.push({
      object: sprite,
      age: 0,
      life,
      update: (amount) => {
        material.opacity = (1 - amount) * baseOpacity;
        const growth = 1 + amount * (options.growth ?? 0.25);
        sprite.scale.set(width * growth, height * growth, 1);
        if (options.rise) sprite.position.y += options.rise / 60;
      },
      dispose: () => {
        material.dispose();
      },
    });
    return sprite;
  }

  spawnMuzzle(position, direction, color = 0xffb342, power = 1, kind = 'ember') {
    const effect = kind === 'lightning'
      ? 'lightning'
      : kind === 'fireball' || kind === 'ember'
        ? 'fireball'
        : kind === 'crossbow'
          ? 'bolt'
          : kind === 'shortbow' || kind === 'longbow'
            ? 'arrow'
            : kind === 'knives'
              ? 'knife'
              : 'dust';
    const magical = ['lightning', 'fireball', 'ember'].includes(kind);
    if (magical) {
      this.spawnPhotoEffect(effect, position, 0.72 * power, 0.72 * power, 0.1, {
        additive: true,
        toneMapped: false,
        growth: 0.12,
      });
      const light = new THREE.PointLight(color, 4.5 * power, 7 * power, 2);
      light.position.copy(position);
      this.root.add(light);
      this.transients.push({
        object: light,
        age: 0,
        life: 0.075,
        update: (amount) => {
          light.intensity = (1 - amount) * 4.5 * power;
        },
      });
    }
  }

  spawnTracer(start, end, color = 0xffcf68, thickness = 0.015, life = 0.075) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 0.05) return;
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(thickness, thickness, length, 4, 1),
      material,
    );
    mesh.position.copy(midpoint);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    this.root.add(mesh);
    this.transients.push({
      object: mesh,
      age: 0,
      life,
      update: (amount) => {
        material.opacity = (1 - amount) * 0.9;
        mesh.scale.x = mesh.scale.z = 1 - amount * 0.55;
      },
      dispose: () => {
        mesh.geometry.dispose();
        material.dispose();
      },
    });
  }

  spawnFlyingProp(start, end, kind) {
    const effect = kind === 'crossbow'
      ? 'bolt'
      : kind === 'knives'
        ? 'knife'
        : 'arrow';
    const distance = start.distanceTo(end);
    const life = clamp(distance / 58, 0.08, 0.34);
    const material = new THREE.MeshBasicMaterial({
      map: PHOTO_EFFECTS[effect],
      transparent: true,
      alphaTest: 0.04,
      depthWrite: false,
      depthTest: true,
      fog: true,
      toneMapped: true,
      side: THREE.DoubleSide,
    });
    const size = effect === 'knife' ? [0.62, 0.28] : effect === 'bolt' ? [0.92, 0.22] : [1.28, 0.24];
    const geometry = new THREE.PlaneGeometry(size[0], size[1]);
    const projectile = new THREE.Mesh(geometry, material);
    projectile.name = `flying-${effect}-directional-photo`;
    projectile.position.copy(start);
    projectile.renderOrder = 3;
    this.root.add(projectile);
    const origin = start.clone();
    const target = end.clone();
    const travel = target.clone().sub(origin).normalize();
    const cameraPosition = new THREE.Vector3();
    const cameraVector = new THREE.Vector3();
    const planeNormal = new THREE.Vector3();
    const planeUp = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const orientAlongFlight = () => {
      if (this.camera) this.camera.getWorldPosition(cameraPosition);
      else cameraPosition.copy(projectile.position).add(new THREE.Vector3(0, 1, 0));
      cameraVector.copy(cameraPosition).sub(projectile.position).normalize();
      planeNormal.copy(cameraVector).addScaledVector(travel, -cameraVector.dot(travel));
      if (planeNormal.lengthSq() < 0.00001) {
        planeNormal.crossVectors(travel, UP);
        if (planeNormal.lengthSq() < 0.00001) planeNormal.set(0, 0, 1);
      }
      planeNormal.normalize();
      planeUp.crossVectors(planeNormal, travel).normalize();
      basis.makeBasis(travel, planeUp, planeNormal);
      projectile.quaternion.setFromRotationMatrix(basis);
    };
    orientAlongFlight();
    this.transients.push({
      object: projectile,
      age: 0,
      life,
      update: (amount) => {
        projectile.position.lerpVectors(origin, target, amount);
        orientAlongFlight();
        material.opacity = amount > 0.9 ? (1 - amount) * 10 : 1;
      },
      dispose: () => {
        geometry.dispose();
        material.dispose();
      },
    });
  }

  spawnImpact(point, normal, options = {}) {
    const position = point.clone().addScaledVector(normal, 0.035);
    const scale = options.count >= 18 ? 0.78 : options.count >= 8 ? 0.56 : 0.4;
    const effect = options.kind === 'lightning'
      ? 'lightning'
      : options.kind === 'ember' || options.kind === 'fireball'
        ? 'fireball'
        : 'dust';
    this.spawnPhotoEffect(effect, position, scale, scale, 0.28, {
      color: options.kind === 'lightning' ? 0xc8f3ff : 0xffffff,
      growth: 0.22,
    });
  }

  spawnBloodImpact(point, direction, headshot = false) {
    const position = point.clone().addScaledVector(direction, 0.025);
    const scale = headshot ? 0.7 : 0.48;
    this.spawnPhotoEffect('dust', position, scale, scale, 0.24, {
      color: 0xe8a18d,
      growth: 0.3,
    });
  }

  spawnDamageNumber(position, amount, options = {}) {
    if (typeof document === 'undefined' || !Number.isFinite(amount) || amount <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const value = Math.max(1, Math.round(amount));
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = 'bold 38px "Arial Black", Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'miter';
    context.strokeStyle = '#000000';
    context.lineWidth = 9;
    context.strokeText(`-${value}`, 80, 40);
    context.fillStyle = options.headshot ? '#fff27a' : '#ffffff';
    context.fillText(`-${value}`, 80, 40);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = 'damage-number';
    sprite.userData.damage = value;
    sprite.userData.headshot = Boolean(options.headshot);
    sprite.position.copy(position);
    sprite.position.x += (Math.random() - 0.5) * 0.18;
    sprite.scale.set(1.12, 0.56, 1);
    sprite.renderOrder = 40;
    this.root.add(sprite);
    const origin = sprite.position.clone();
    this.transients.push({
      object: sprite,
      age: 0,
      life: options.headshot ? 0.92 : 0.76,
      update: (progress) => {
        sprite.position.copy(origin);
        sprite.position.y += progress * 0.82;
        const pop = progress < 0.18 ? 0.82 + progress : 1;
        sprite.scale.set(1.12 * pop, 0.56 * pop, 1);
        material.opacity = progress < 0.62 ? 1 : (1 - progress) / 0.38;
      },
      dispose: () => {
        material.dispose();
        texture.dispose();
      },
    });
    return sprite;
  }

  spawnShell(position, direction, color = 0xc99a43, large = false, kind = 'knives') {
    const effect = kind === 'crossbow'
      ? 'bolt'
      : kind === 'shortbow' || kind === 'longbow'
        ? 'arrow'
        : kind === 'knives'
          ? 'knife'
          : 'dust';
    this.spawnPhotoEffect(effect, position, large ? 0.2 : 0.14, large ? 0.08 : 0.055, 0.16, {
      color,
      growth: -0.25,
    });
  }

  spawnChunk(position, velocity, color, size = 0.15, life = 1.2) {
    this.trimDebris();
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.75,
      metalness: 0.04,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(this.chunkGeometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(size / 0.18);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    mesh.castShadow = true;
    this.root.add(mesh);
    this.debris.push({
      mesh,
      velocity: velocity.clone(),
      angular: new THREE.Vector3(
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
      ),
      age: 0,
      life,
      gravity: 15,
      floor: 0.04,
      bounce: 0.24,
    });
  }

  spawnDeathBurst(position, facing = new THREE.Vector3(0, 0, 1)) {
    const center = position.clone().add(new THREE.Vector3(0, 0.85, 0));
    this.spawnPhotoEffect('dust', center, 1.45, 1.45, 0.72, {
      color: 0xd7b3a8,
      opacity: 0.88,
      growth: 0.65,
      rise: 0.55,
    });
    this.spawnPhotoEffect('dust', position.clone().addScaledVector(facing, 0.1), 1.0, 1.0, 0.34, {
      color: 0xf0c1aa,
      growth: 0.42,
    });
  }

  spawnExplosion(position, radius = 5, color = 0xff7435) {
    this.spawnPhotoEffect('fireball', position, radius * 1.05, radius * 0.95, 0.42, {
      additive: true,
      toneMapped: false,
      opacity: 0.92,
      growth: 0.45,
    });
    this.spawnPhotoEffect('dust', position.clone().add(new THREE.Vector3(0, radius * 0.12, 0)), radius * 0.82, radius * 0.82, 0.86, {
      opacity: 0.84,
      growth: 0.72,
      rise: radius * 0.2,
    });

    const light = new THREE.PointLight(color, 18, radius * 2.7, 2);
    light.position.copy(position);
    this.root.add(light);
    this.transients.push({
      object: light,
      age: 0,
      life: 0.42,
      update: (amount) => {
        light.intensity = Math.pow(1 - amount, 2) * 18;
      },
    });

  }

  update(delta) {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= delta;
      if (particle.life <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      particle.velocity.y -= particle.gravity * delta;
      particle.velocity.multiplyScalar(Math.exp(-particle.drag * delta));
      particle.position.addScaledVector(particle.velocity, delta);
    }

    const geometry = this.particlePoints.geometry;
    const position = geometry.attributes.position;
    const color = geometry.attributes.color;
    const size = geometry.attributes.size;
    const alpha = geometry.attributes.alpha;
    const count = Math.min(this.particles.length, MAX_PARTICLES);
    if (count > 0) {
      for (let index = 0; index < count; index += 1) {
        const particle = this.particles[index];
        const amount = clamp(particle.life / particle.maxLife, 0, 1);
        position.setXYZ(index, particle.position.x, particle.position.y, particle.position.z);
        color.setXYZ(index, particle.color.r, particle.color.g, particle.color.b);
        size.setX(index, particle.size * (0.65 + amount * 0.35));
        alpha.setX(index, Math.min(1, amount * 2.5));
      }
      position.needsUpdate = true;
      color.needsUpdate = true;
      size.needsUpdate = true;
      alpha.needsUpdate = true;
    }
    if (count !== this.lastParticleCount) {
      geometry.setDrawRange(0, count);
      this.lastParticleCount = count;
    }

    for (let index = this.transients.length - 1; index >= 0; index -= 1) {
      const entry = this.transients[index];
      entry.age += delta;
      const amount = clamp(entry.age / entry.life, 0, 1);
      entry.update?.(amount, delta);
      if (entry.age >= entry.life) {
        this.root.remove(entry.object);
        entry.dispose?.();
        this.transients.splice(index, 1);
      }
    }

    for (let index = this.debris.length - 1; index >= 0; index -= 1) {
      const entry = this.debris[index];
      entry.age += delta;
      entry.velocity.y -= entry.gravity * delta;
      entry.mesh.position.addScaledVector(entry.velocity, delta);
      entry.mesh.rotation.x += entry.angular.x * delta;
      entry.mesh.rotation.y += entry.angular.y * delta;
      entry.mesh.rotation.z += entry.angular.z * delta;
      if (entry.mesh.position.y < entry.floor) {
        entry.mesh.position.y = entry.floor;
        entry.velocity.y = Math.abs(entry.velocity.y) * entry.bounce;
        entry.velocity.x *= 0.68;
        entry.velocity.z *= 0.68;
        entry.angular.multiplyScalar(0.72);
      }
      if (entry.age > entry.life - 0.35) {
        const amount = clamp((entry.life - entry.age) / 0.35, 0, 1);
        entry.mesh.scale.multiplyScalar(0.92 + amount * 0.08);
      }
      if (entry.age >= entry.life) {
        this.root.remove(entry.mesh);
        entry.mesh.material.dispose();
        this.debris.splice(index, 1);
      }
    }
  }

  resize(pixelRatio) {
    this.particlePoints.material.uniforms.pixelRatio.value = Math.min(pixelRatio, 2);
  }

  setQuality(performance) {
    const scale = performance?.renderScale ?? 1;
    const low = performance?.profile === 'performance' || scale < 0.75;
    this.particleLimit = low ? 320 : scale < 0.9 ? 440 : 560;
    this.debrisLimit = low ? 38 : scale < 0.9 ? 54 : 72;
    if (this.particles.length > this.particleLimit) {
      this.particles.splice(0, this.particles.length - this.particleLimit);
    }
    while (this.debris.length > this.debrisLimit) this.trimDebris(true);
  }

  trimDebris(force = false) {
    if (!force && this.debris.length < this.debrisLimit) return;
    const entry = this.debris.shift();
    if (!entry) return;
    this.root.remove(entry.mesh);
    entry.mesh.material.dispose();
  }
}
