// ==========================================
// Upgraded Dream Version (Stable)
// Grid + Camera Shuffle + WAV loops
// ==========================================

let video;
let previousFrame;

// Derived view of the video that maintains input aspect ratio on the canvas
let displayVideoWidth = 0;
let displayVideoHeight = 0;
let videoOffsetX = 0;
let videoOffsetY = 0;

let cols = 12;
let rows = 8;
let cellW, cellH;

// For shuffled grid timing (slower movement)
let tiles = [];
let shuffleIntervalFrames = 5; // shuffle every 5 frames (~80% slower)
let shuffleCountdown = 0;

let motionAmount = 0;
let adjustedMotion = 0;
let sensitivitySlider;
let gridMotionSlider;
let zoomThresholdSlider;
let zoomAmountSlider;
let sensitivityLabel;
let gridLabel;
let zoomThreshLabel;
let zoomAmtLabel;
let instructionsDiv;

// Single-word performance text
let words = [];
const WORD_ROWS = 6;
let wordInput;
let currentTyped = "";
let motionX = null;
let motionY = null;
let started = false;

// Per-tile motion & state for interactive audio / visuals
let tileMotion = [];
let tileZoomed = [];
let tileLastShiftMs = [];
let lastGlobalZoomChangeMs = 0;

// Higher-level motion zones (clusters of movement) for text / visuals
let zones = [];

// Tone.js players and gain control
const LOOP_COUNT = 12;
let loops = [];
let loopGains = [];
let masterGain;

// Loading state for audio buffers
let loadedLoops = 0;
let assetsLoaded = false;

// Motion tuning constants
const MOTION_SAMPLE_STEP = 24; // smaller = more precise, more CPU
const MOTION_THRESHOLD = 1000; // base motion threshold before audio fades in

let startButtonVisible = true;

// ------------------------------------------
// WORD INPUT + FABRIC SYSTEM
// ------------------------------------------

function createWordInput() {
  wordInput = createInput();
  // Visible text input centered near the bottom of the screen
  const inputWidth = min(360, width - 40);
  wordInput.position(width / 2 - inputWidth / 2, height - 60);
  wordInput.size(inputWidth, 30);
  wordInput.attribute("autocomplete", "off");
  // Empty placeholder; guidance is shown in the on-canvas instructions text.
  wordInput.attribute("placeholder", "");
  // Transparent background and border so it floats over the video
  wordInput.style("background", "transparent");
  wordInput.style("color", "red");
  wordInput.style("border", "0");
  wordInput.style("outline", "none");
  wordInput.style("box-shadow", "none");
  wordInput.style("font-family", "monospace");
  wordInput.style("font-size", "14px");
  wordInput.style("text-align", "center");

  // Keep currentTyped in sync with the hidden input's value
  wordInput.input(() => {
    currentTyped = wordInput.value();
  });

  // Commit on space or Enter, using only the first word
  wordInput.elt.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Enter") {
      const val = wordInput.value().trim();
      if (val !== "") {
        const firstWord = val.split(/\s+/)[0];
        addWord(firstWord);
      }
      wordInput.value("");
      currentTyped = "";
      e.preventDefault();
    }
  });

  // Focus once so typing is immediately captured
  wordInput.elt.focus();
}

function addWord(str) {
  const rowIndex = words.length % WORD_ROWS;

  words.push({
    text: str,
    row: rowIndex,
    baseX: random(200, width - 200),
    baseY: map(rowIndex, 0, WORD_ROWS - 1, 200, height - 200),
    x: width / 2,
    y: height / 2,
    vx: 0,
    vy: 0,
    stretch: 1,
    angle: 0
  });
}

function findNearestZone(x, y) {
  let nearest = null;
  let minDist = Infinity;

  for (let z of zones) {
    let d = dist(x, y, z.x, z.y);
    if (d < minDist) {
      minDist = d;
      nearest = z;
    }
  }

  return { zone: nearest, distance: minDist };
}

function updateWords() {
  for (let w of words) {
    // Wind effect from nearby motion zones
    let windX = 0;
    let windY = 0;

    for (let z of zones) {
      let dx = z.x - w.x;
      let dy = z.y - w.y;
      let distVal = sqrt(dx * dx + dy * dy);

      if (distVal < 400) {
        windX += dx * 0.002;
        windY += dy * 0.002;
      }
    }

    // Fabric wave across each text row
    let wave = sin(frameCount * 0.03 + w.row * 0.8) * 20;

    let targetX = w.baseX + windX * 300;
    let targetY = w.baseY + wave + windY * 200;

    // Ease motion toward target
    w.vx += (targetX - w.x) * 0.05;
    w.vy += (targetY - w.y) * 0.05;

    w.vx *= 0.9;
    w.vy *= 0.9;

    w.x += w.vx;
    w.y += w.vy;

    let windMag = sqrt(windX * windX + windY * windY);
    w.stretch = 1 + windMag * 0;
    w.angle = windX * 0.11;
  }
}

function drawWords() {
  if (!words.length) return;

  textSize(18);
  noStroke();
  fill(255);

  for (let w of words) {
    const { zone: nearest, distance } = findNearestZone(w.x, w.y);

    // Draw a subtle connection if close to a motion zone
    if (nearest && distance < 500 && nearest.alpha > 30) {
      stroke(255, 100);
      strokeWeight(1);
      line(w.x, w.y, nearest.x, nearest.y);
      noStroke();
    }

    push();
    translate(w.x, w.y);
    rotate(w.angle);
    scale(w.stretch, 1);
    fill(255);
    text(w.text, 0, 0);
    pop();
  }
}


function preload() {
  // Master bus
  masterGain = new Tone.Gain(0.5).toDestination();

  // Create loop players with individual gain
  for (let i = 0; i < LOOP_COUNT; i++) {
    const player = new Tone.Player({
      url: `sounds/loop${i + 1}.mp3`,
      loop: true,
      autostart: false,
      onload: () => {
        loadedLoops++;
        if (loadedLoops >= LOOP_COUNT) {
          assetsLoaded = true;
        }
      }
    });

    const gain = new Tone.Gain(0).connect(masterGain);

    // Chain: player -> gain -> master
    player.connect(gain);

    loops.push(player);
    loopGains.push(gain);
  }
}

// ------------------------------------------

function setup() {
  // Create full-window canvas and attach it to the HTML container
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.parent("canvas-container");

  cellW = width / cols;
  cellH = height / rows;

  // Prefer back-facing camera on mobile where available,
  // fall back to default video capture otherwise.
  video = createCapture(
    {
      video: {
        facingMode: "environment"
      },
      audio: false
    },
    () => {
      // Video stream is ready; p5 will handle drawing.
    }
  );
  video.hide();


  drawingContext.canvas.getContext("2d", { willReadFrequently: true });

  // previousFrame will be created lazily once the video reports a valid size
  previousFrame = null;

  textAlign(CENTER, CENTER);
  textSize(22);

  // Motion sensitivity slider: default 50%, range -50%..100%
  sensitivitySlider = createSlider(-100, 100, 50);
  sensitivitySlider.position(20, 20);
  sensitivitySlider.style("width", "200px");
  sensitivityLabel = createDiv("MOTION SENSITIVITY");
  sensitivityLabel.position(230, 18);
  sensitivityLabel.style("color", "#ffffff");
  sensitivityLabel.style("font-size", "12px");
  sensitivityLabel.style("font-family", "monospace");

  // Grid motion slider: controls displacement intensity (0 = static, 100 = max)
  gridMotionSlider = createSlider(-50, 100, 40);
  gridMotionSlider.position(20, 50);
  gridMotionSlider.style("width", "200px");
  gridLabel = createDiv("GRID VISUAL INTENSITY");
  gridLabel.position(230, 48);
  gridLabel.style("color", "#ffffff");
  gridLabel.style("font-size", "12px");
  gridLabel.style("font-family", "monospace");

  // Visual zoom threshold slider: how much motion before a tile "glass" zooms
  zoomThresholdSlider = createSlider(2000, 20000, 6000);
  zoomThresholdSlider.position(20, 80);
  zoomThresholdSlider.style("width", "200px");
  zoomThreshLabel = createDiv("GLASS ZOOM THRESHOLD");
  zoomThreshLabel.position(230, 78);
  zoomThreshLabel.style("color", "#ffffff");
  zoomThreshLabel.style("font-size", "12px");
  zoomThreshLabel.style("font-family", "monospace");

  // Visual zoom amount slider: how strong the tile zoom effect is
  zoomAmountSlider = createSlider(0, 100, 40); // 0 -> no zoom, 100 -> max zoom
  zoomAmountSlider.position(20, 110);
  zoomAmountSlider.style("width", "200px");
  zoomAmtLabel = createDiv("GLASS ZOOM AMOUNT");
  zoomAmtLabel.position(230, 108);
  zoomAmtLabel.style("color", "#ffffff");
  zoomAmtLabel.style("font-size", "12px");
  zoomAmtLabel.style("font-family", "monospace");

  // Instructions for performance use
  instructionsDiv = createDiv(
    "USAGE: Move in front of the camera to activate sound and glass tiles. Type a single word in the bar at the bottom and press SPACE or ENTER to release it into the field. For performance, press F11 or use fullscreen so only the feed and words remain visible."
  );
  instructionsDiv.position(20, 140);
  instructionsDiv.style("color", "#cccccc");
  instructionsDiv.style("font-size", "11px");
  instructionsDiv.style("font-family", "monospace");
  instructionsDiv.style("max-width", "420px");

  // Single-word input for performance text (kept invisible – typing is tracked via keys)
  createWordInput();

  // Hide the HTML overlay layer so our p5 canvas UI (including loader) is visible.
  const overlay = document.getElementById("overlay");
  if (overlay) {
    overlay.style.display = "none";
  }

  // Initial control visibility based on fullscreen state
  updateControlsVisibility();
}

function windowResized() {
  // Keep canvas full-window on resize
  resizeCanvas(windowWidth, windowHeight);

  // Update grid cell size to match new canvas
  cellW = width / cols;
  cellH = height / rows;

  // Let the video keep its own aspect ratio; reset the motion buffer so it
  // can be recreated at the correct size on the next frame.
  previousFrame = null;

  // Re-evaluate control visibility when the window size changes
  updateControlsVisibility();
}

// ------------------------------------------

function updateControlsVisibility() {
  // Heuristic: consider the app "fullscreen" if either the browser reports a
  // fullscreen element or the inner window roughly matches the screen size.
  const isFullscreen =
    (document.fullscreenElement && document.fullscreenElement !== null) ||
    (window.innerWidth >= screen.width - 2 &&
      window.innerHeight >= screen.height - 2);

  const display = isFullscreen ? "none" : "block";

  const elems = [
    sensitivitySlider,
    gridMotionSlider,
    zoomThresholdSlider,
    zoomAmountSlider,
    sensitivityLabel,
    gridLabel,
    zoomThreshLabel,
    zoomAmtLabel,
    instructionsDiv
  ];

  elems.forEach((el) => {
    if (el && el.style) {
      el.style("display", display);
    }
  });
}

// ------------------------------------------

function draw() {
  background(10);

  // Make sure the word input keeps focus by default so the cursor is active
  ensureWordInputFocus();

  // Hide motion controls when the sketch is in fullscreen, show them otherwise.
  updateControlsVisibility();

  if (started) {
    video.loadPixels();
    // Only run motion detection when both frames have valid, matching pixel data
    if (
      video.pixels.length > 0 &&
      previousFrame &&
      previousFrame.pixels &&
      previousFrame.pixels.length === video.pixels.length
    ) {
      motionAmount = detectMotion();

      // Apply sensitivity factor from slider: -50% .. 100% => 0.5x .. 2.0x
      const sliderPercent = sensitivitySlider ? sensitivitySlider.value() : -50;
      const sensitivityFactor = 1 + sliderPercent / 100; // 0.5 - 2.0
      adjustedMotion = motionAmount * sensitivityFactor;
    }
  }

  drawShuffledGrid();

  if (started) {
    controlAudio();
  }

  // Render the camera feed + glass tiles in grayscale
  filter(GRAY);

  drawOverlayUI();

  // Update and draw performance words that respond to motion zones
  updateWords();
  drawWords();

  if (started && video && video.width > 0 && video.height > 0) {
    // Ensure previousFrame matches the video size (to avoid distortion)
    if (
      !previousFrame ||
      previousFrame.width !== video.width ||
      previousFrame.height !== video.height
    ) {
      previousFrame = createImage(video.width, video.height);
    }

    previousFrame.copy(video, 0, 0, video.width, video.height, 0, 0, video.width, video.height);
    // Ensure previousFrame.pixels is populated for the next frame
    previousFrame.loadPixels();
  }
}

// ------------------------------------------
// GRID SHUFFLE (affects camera feed too)
// ------------------------------------------

function drawShuffledGrid() {
  if (!video || video.width === 0 || video.height === 0) {
    return;
  }

  // Compute how the video fits into the canvas while preserving aspect ratio
  const videoAspect = video.width / video.height;
  const canvasAspect = width / height;
  if (canvasAspect > videoAspect) {
    // Canvas is wider than video: letterbox left/right
    displayVideoHeight = height;
    displayVideoWidth = height * videoAspect;
  } else {
    // Canvas is taller than video: letterbox top/bottom
    displayVideoWidth = width;
    displayVideoHeight = width / videoAspect;
  }
  videoOffsetX = (width - displayVideoWidth) * 0.5;
  videoOffsetY = (height - displayVideoHeight) * 0.5;

  // First draw a clean, continuous video feed as the background.
  // Tile effects are drawn on top so the base image has no visible seams.
  // /image(
  //   video,
  //   videoOffsetX,
  //   videoOffsetY,
  //   displayVideoWidth,
  //   displayVideoHeight
  // );

  push();
  translate(videoOffsetX + displayVideoWidth, videoOffsetY);
  scale(-1, 1);

  image(
    video,
    0,
    0,
    displayVideoWidth,
    displayVideoHeight
  );

  pop();

  // Grid motion factor from slider (0..1)
  const gridMotionFactor =
    gridMotionSlider && gridMotionSlider.value
      ? gridMotionSlider.value() / 100
      : 0.4;

  const totalTiles = cols * rows;

  // Initialize per-tile state arrays if needed
  if (tileZoomed.length < totalTiles) {
    tileZoomed = new Array(totalTiles).fill(false);
    tileLastShiftMs = new Array(totalTiles).fill(0);
  }

  const now = millis();
  const baseIntervalMs = 1000; // 60 bpm baseline
  const zoomMotionThreshold =
    zoomThresholdSlider && zoomThresholdSlider.value
      ? zoomThresholdSlider.value()
      : 4000;
  const maxZoomed = 6; // allow up to 6 glass tiles at once

  // Build candidate list of tiles that want to toggle zoom
  let candidates = [];
  for (let idx = 0; idx < totalTiles; idx++) {
    const activity = idx < tileMotion.length ? tileMotion[idx] : 0;
    const motionFactor = constrain(activity / 8000, 0.5, 2.0);
    const intervalMs = baseIntervalMs / motionFactor;

    if (
      activity > zoomMotionThreshold &&
      gridMotionFactor > 0 &&
      now - tileLastShiftMs[idx] >= intervalMs &&
      now - lastGlobalZoomChangeMs >= 200 // stagger: at least 200ms between toggles
    ) {
      candidates.push(idx);
    }
  }

  // Randomize candidate order so zooming happens at random spots
  if (candidates.length > 1) {
    shuffle(candidates, true);
  }

  // Current number of zoomed tiles
  let zoomedCount = tileZoomed.reduce((acc, z) => acc + (z ? 1 : 0), 0);

  // Process a few tile toggles per frame for a staggered, shimmering effect
  if (candidates.length > 0) {
    const perFrameLimit = 3;
    let toggledThisFrame = 0;

    for (let c = 0; c < candidates.length; c++) {
      const idx = candidates[c];

      // If trying to zoom in and already at limit, skip
      if (!tileZoomed[idx] && zoomedCount >= maxZoomed) {
        continue;
      }

      tileZoomed[idx] = !tileZoomed[idx];
      tileLastShiftMs[idx] = now;
      lastGlobalZoomChangeMs = now;

      zoomedCount += tileZoomed[idx] ? 1 : -1;
      toggledThisFrame++;

      if (toggledThisFrame >= perFrameLimit) {
        break;
      }
    }
  }

  // Destination tile size constrained to the video area so the camera
  // sits centered on screen with black borders around it.
  const tileW = displayVideoWidth / cols;
  const tileH = displayVideoHeight / rows;

  // Draw tiles using the current zoom state
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const tileIdx = y * cols + x;
      const tileActivity =
        tileIdx < tileMotion.length ? tileMotion[tileIdx] : 0;

      // Discrete zoom state: either base (1x) or a glass-tile zoom on top.
      const zoomAmount =
        zoomAmountSlider && zoomAmountSlider.value
          ? map(zoomAmountSlider.value(), 0, 100, 1.0, 1.8)
          : 1.3;
      const zoom =
        tileZoomed[tileIdx] && gridMotionFactor > 0 ? zoomAmount : 1.0;

      // If this tile is not zoomed, let the clean background video show through.
      if (zoom === 1.0) {
        continue;
      }

      const tileCenterX = videoOffsetX + x * tileW + tileW / 2;
      const tileCenterY = videoOffsetY + y * tileH + tileH / 2;

      // Map tile center onto the letterboxed video area (0..1 in each axis)
      const nx = constrain(
        (tileCenterX - videoOffsetX) / displayVideoWidth,
        0,
        1
      );
      const ny = constrain(
        (tileCenterY - videoOffsetY) / displayVideoHeight,
        0,
        1
      );

      // Source region in video space, scaled to keep the original aspect ratio
      const srcW = (cellW / displayVideoWidth) * video.width / zoom;
      const srcH = (cellH / displayVideoHeight) * video.height / zoom;

      const srcX = nx * video.width - srcW / 2;
      const srcY = ny * video.height - srcH / 2;

      // image(
      //   video,
      //   videoOffsetX + x * tileW,
      //   videoOffsetY + y * tileH,
      //   tileW,
      //   tileH,
      //   srcX,
      //   srcY,
      //   srcW,
      //   srcH
      // );

      push();

      translate(videoOffsetX + displayVideoWidth, videoOffsetY);
      scale(-1, 1);

      image(
        video,
        displayVideoWidth - (x + 1) * tileW,
        y * tileH,
        tileW,
        tileH,
        srcX,
        srcY,
        srcW,
        srcH
      );

      pop();

      // Visual instrument indicator for this tile/loop (no borders, just icons)
      // if (tileIdx < tileMotion.length) {
      //   const activity = constrain(tileMotion[tileIdx] / 8000, 0, 1);
      //   const cx = x * cellW + cellW / 2;
      //   const cy = y * cellH + cellH / 2;

      //   // Glowing circle whose size/alpha follow motion
      //   noStroke();
      //   fill(255, 200 * activity);
      //   const r = 14 + 18 * activity;
      //   ellipse(cx, cy, r, r);
      // }
    }
  }
}

// ------------------------------------------
// MOTION DETECTION
// ------------------------------------------

function detectMotion() {
  let total = 0;
  let bestDiff = 0;
  let bestIndex = -1;

  // Temporary collection of motion samples for zone clustering
  let motionClusters = [];

  // Safety guard: if previousFrame is not ready or mismatched, report no motion
  if (
    !previousFrame ||
    !previousFrame.pixels ||
    previousFrame.pixels.length === 0 ||
    previousFrame.pixels.length !== video.pixels.length
  ) {
    motionX = null;
    motionY = null;
    tileMotion = new Array(cols * rows).fill(0);
    return 0;
  }

  // Reset per-tile motion
  tileMotion = new Array(cols * rows).fill(0);

  // Sample every few pixels for performance
  const step = MOTION_SAMPLE_STEP;

  for (let i = 0; i < video.pixels.length; i += step) {
    let r1 = video.pixels[i];
    let g1 = video.pixels[i + 1];
    let b1 = video.pixels[i + 2];

    let r2 = previousFrame.pixels[i];
    let g2 = previousFrame.pixels[i + 1];
    let b2 = previousFrame.pixels[i + 2];

    let diff = abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2);
    total += diff;

    // Determine pixel coordinates in video space
    const pixelIndex = i / 4; // 4 values per pixel (RGBA)
    const vx = pixelIndex % video.width;
    const vy = floor(pixelIndex / video.width);

    // Track strongest motion for marker
    if (diff > bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }

    // Accumulate per-tile motion
    const tileX = floor((vx / video.width) * cols);
    const tileY = floor((vy / video.height) * rows);
    const tileIdx = constrain(tileY, 0, rows - 1) * cols + constrain(tileX, 0, cols - 1);
    tileMotion[tileIdx] += diff;

    // Collect motion samples for higher-level zones (use a moderate threshold)
    const zoneThreshold = 120;
    if (diff > zoneThreshold) {
      motionClusters.push({ x: vx, y: vy });
    }
  }

  // Convert bestIndex into canvas coordinates for the motion marker
  if (bestIndex >= 0 && video.width > 0 && video.height > 0) {
    const pixelIndex = bestIndex / 4; // 4 values per pixel (RGBA)
    const vx = pixelIndex % video.width;
    const vy = floor(pixelIndex / video.width);

    // Map from video space to canvas space (they share the same size)
    motionX = map(vx, 0, video.width, 0, width);
    motionY = map(vy, 0, video.height, 0, height);
  } else {
    motionX = null;
    motionY = null;
  }

  // Build / update motion zones from the sampled motion clusters
  if (motionClusters.length > 20) {
    let xs = motionClusters.map((p) => p.x);
    let ys = motionClusters.map((p) => p.y);

    let minX = min(xs);
    let maxX = max(xs);
    let minY = min(ys);
    let maxY = max(ys);

    let avgX =
      motionClusters.reduce((sum, p) => sum + p.x, 0) / motionClusters.length;
    let avgY =
      motionClusters.reduce((sum, p) => sum + p.y, 0) / motionClusters.length;

    // Map to canvas space using the same aspect-correct video area
    const cx =
      videoOffsetX +
      map(avgX, 0, video.width, 0, displayVideoWidth);
    const cy =
      videoOffsetY +
      map(avgY, 0, video.height, 0, displayVideoHeight);

    const rawW = map(maxX - minX, 0, video.width, 0, displayVideoWidth);
    const rawH = map(maxY - minY, 0, video.height, 0, displayVideoHeight);

    // Shrink bounding box for a tighter zone
    let w = rawW * 0.25;
    let h = rawH * 0.25;
    w = max(w, 24);
    h = max(h, 24);

    let assigned = false;
    const maxZones = 6;

    // Update an existing zone if close enough
    for (let z of zones) {
      const d = dist(z.x, z.y, cx, cy);
      if (d < 160) {
        z.x += (cx - z.x) * 0.25;
        z.y += (cy - z.y) * 0.25;
        z.w += (w - z.w) * 0.25;
        z.h += (h - z.h) * 0.25;
        z.alpha = 255;
        assigned = true;
        break;
      }
    }

    // Or create a new zone
    if (!assigned && zones.length < maxZones) {
      zones.push({
        x: cx,
        y: cy,
        w: w,
        h: h,
        alpha: 255
      });
    }
  }

  // Fade all zones over time
  for (let z of zones) {
    z.alpha -= 4;
  }
  zones = zones.filter((z) => z.alpha > 0);

  return total / 10000;
}

// ------------------------------------------
// AUDIO CONTROL
// ------------------------------------------

function controlAudio() {
  // Per-loop control based on motion in corresponding tiles
  if (!loops.length || !tileMotion.length) return;

  // Sensitivity factor from slider
  const sliderPercent = sensitivitySlider ? sensitivitySlider.value() : 50;
  const sensitivityFactor = 1 + sliderPercent / 100; // 0.5 - 2.0

  for (let i = 0; i < loops.length; i++) {
    // Derive motion for this loop by grouping tiles evenly across loops.
    // This uses the total loop count to divide the grid into contiguous bands.
    let m = 0;
    const totalTiles = cols * rows;
    const startIdx = Math.floor((i * totalTiles) / loops.length);
    const endIdx = Math.floor(((i + 1) * totalTiles) / loops.length);
    for (let idx = startIdx; idx < endIdx && idx < tileMotion.length; idx++) {
      m += tileMotion[idx];
    }

    // Apply sensitivity
    m *= sensitivityFactor;

    // Simple threshold to avoid noise; below this we keep the last gain so
    // the loop continues playing at its previous level even if motion pauses.
    const threshold = MOTION_THRESHOLD;
    if (m < threshold) {
      continue;
    }

    // Map motion to gain 0..1 above threshold (1.0 ~= max level)
    m = m - threshold;
    let targetGain = map(m, 0, threshold * 3, 0, 1);
    targetGain = constrain(targetGain, 0, 1);

    loopGains[i].gain.rampTo(targetGain, 0.2);

    // Subtle pitch modulation around each loop's base pitch
    // const pitchSpread = map(m, 0, threshold * 3, -1, 1);
    // loopPitch[i].pitch = (i - 3.5) * 0.5 + pitchSpread * 0.3;
  }
}

// ------------------------------------------
// UI OVERLAY
// ------------------------------------------

function drawOverlayUI() {
  // In-canvas SIGNAL START button: only visible once audio has fully loaded.
  if (!started && startButtonVisible && assetsLoaded) {
    fill(0, 180);
    rect(0, 0, width, height);

    // Blink the button to signal readiness
    const blink = (sin(frameCount * 0.15) + 1) / 2; // 0..1
    const borderAlpha = 160 + blink * 95;
    const fillAlpha = 180 + blink * 60;

    fill(255, fillAlpha);
    stroke(255, borderAlpha);
    strokeWeight(3);
    const bw = 260;
    const bh = 90;
    rect(width / 2 - bw / 2, height / 2 - bh / 2, bw, bh, 6);

    fill(0);
    noStroke();
    text("SIGNAL START", width / 2, height / 2);
  }

  // Loading progress bar for audio loops (helps decide when to start the signal)
  if (!started && !assetsLoaded) {
    const progress =
      LOOP_COUNT > 0 ? constrain(loadedLoops / LOOP_COUNT, 0, 1) : 1;

    const barWidth = width * 0.4;
    const barHeight = 12;
    const barX = (width - barWidth) / 2;
    const barY = height * 0.7;

    noStroke();
    fill(40, 160);
    rect(barX, barY, barWidth, barHeight);

    fill(255);
    rect(barX, barY, barWidth * progress, barHeight);

    fill(255);
    noStroke();
    textAlign(CENTER, BOTTOM);
    text("Loading audio " + floor(progress * 100) + "%...", width / 2, barY - 10);

    // Restore main text alignment for other UI
    textAlign(CENTER, CENTER);
  }

  // Draw motion marker as a blinking white square on top of everything
  if (started && motionX !== null && motionY !== null) {
    motionX = width - motionX;
    const blink = (sin(frameCount * 0.2) + 1) / 2; // 0..1
    const baseSize = 40;
    const size = baseSize * (0.5 + 0.5 * blink);

    stroke(255);
    strokeWeight(2);
    noFill();
    rect(motionX - size / 2, motionY - size / 2, size, size);
  }

  // Optional: subtle debug view of motion zones (comment out if not desired)
  // noFill();
  // stroke(255, 40);
  // strokeWeight(1);
  // rectMode(CENTER);
  // for (let z of zones) {
  //   rect(z.x, z.y, z.w, z.h);
  // }
  // rectMode(CORNER);
}

// ------------------------------------------
// USER GESTURE START
// ------------------------------------------

function mousePressed() {
  // Use a canvas click as the required user gesture to start audio.
  if (!started && assetsLoaded) {
    Tone.start().then(() => {
      loops.forEach((p) => p.start());
      started = true;
      startButtonVisible = false;
    });
  }

  // Always refocus the hidden input so typing works after clicks/taps
  if (wordInput && wordInput.elt && typeof wordInput.elt.focus === "function") {
    wordInput.elt.focus();
  }
}

// Support mobile taps as the start gesture as well.
function touchStarted() {
  mousePressed();
  // Prevent default to avoid scrolling on tap.
  return false;
}

// ------------------------------------------
// KEYBOARD SHORTCUTS
// ------------------------------------------

// Keep the text input focused by default so the caret is visible
function ensureWordInputFocus() {
  if (!wordInput || !wordInput.elt) return;
  if (document.activeElement !== wordInput.elt) {
    wordInput.elt.focus();
  }
}

function keyPressed() {
  // Ctrl + Alt + F toggles fullscreen mode
  if (
    (key === "f" || key === "F") &&
    keyIsDown(CONTROL) &&
    keyIsDown(ALT)
  ) {
    const fs = fullscreen();
    fullscreen(!fs);
    return false;
  }
}
