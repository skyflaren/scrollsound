let audioCtx, buffer, playing = false, reverseActive = false;
let activeSources = [], currentCursor = 0;

const audioElement = document.getElementById("audio");
audioElement.crossOrigin = "anonymous";
audioElement.loop = true;

const playBtn = document.getElementById("play");
const speedSlider = document.getElementById("speed");
const speedVal = document.getElementById("speedVal");
const positionSlider = document.getElementById("position");
const timeDisplay = document.getElementById("timeDisplay");

const lengthInput = document.getElementById("length");
const stepInput = document.getElementById("step");
const fadeInput = document.getElementById("fade");
const periodInput = document.getElementById("period");

function computePeriod(segmentDuration, speed, overlapSec = 0) {
  const effectiveLength = Math.max(segmentDuration - (overlapSec || 0), 1e-6);
  return effectiveLength / Math.max(Math.abs(speed), 1e-6);
}

// update the inputs to reflect input param values
function updateParamInputs(options = {}) {
  const uiChunk = parseFloat(lengthInput.value) || 1.25;
  const uiStep = parseFloat(stepInput.value);
  const uiFade = parseFloat(fadeInput.value) || 0;
  const uiSpeed = (speedSlider && speedSlider.value) ? (speedSlider.value / 100) : 1;

  const computedPeriod = computePeriod(uiChunk, uiSpeed, uiFade);

  const segmentDuration = (options.segmentDuration != null)
    ? options.segmentDuration
    : (lastReverseOptions && lastReverseOptions.segmentDuration) != null
      ? lastReverseOptions.segmentDuration
      : uiChunk;

  const period = (options.period != null)
    ? options.period
    : (lastReverseOptions && lastReverseOptions.period) != null
      ? lastReverseOptions.period
      : computedPeriod;

  const resolvedStep = (options.step != null)
    ? options.step
    : (lastReverseOptions && lastReverseOptions.step) != null
      ? lastReverseOptions.step
      : null;

  const fade = (options.overlapSec != null)
    ? options.overlapSec
    : (lastReverseOptions && lastReverseOptions.overlapSec) != null
      ? lastReverseOptions.overlapSec
      : uiFade;

  // write resolved values back into the inputs so they show the "actual" parameters
  lengthInput.value = Number(segmentDuration).toFixed(2);

  // Only overwrite step input if we have an explicit resolved step (from options or lastReverseOptions).
  if (resolvedStep != null) {
    stepInput.value = Number(resolvedStep).toFixed(2);
  }
  periodInput.value = Number(period).toFixed(2);
  fadeInput.value = Number(fade).toFixed(2);
}

let reverseLoopActive = false;
let intervalId = null;
let _reverseRunToken = 0;
let lastReverseOptions = null;
let isSpeedDragging = false;
let pendingReverseOptions = null;
let _speedCommitLock = false;
let liveSpeed = null;

function getSpeedFromUI() { return (speedSlider && speedSlider.value) ? (speedSlider.value/100) : 1;}

async function handleSpeedCommit() {
  if (_speedCommitLock) return;
  _speedCommitLock = true;
  try {
    const speed = getSpeedFromUI();
    speedVal.textContent = speed >= 0 ? `${speed.toFixed(2)}x` : `Reverse ${Math.abs(speed).toFixed(2)}x`;

    await loadBuffer();
    await ensureCtx();

    const chunkLength = parseFloat(lengthInput.value);
    const stepSize = parseFloat(stepInput.value);
    const fadeSec = parseFloat(fadeInput.value);

    if (speed >= 0) {
      stopReverse();
      reverseActive = false;
      audioElement.currentTime = currentCursor;
      audioElement.playbackRate = Math.max(speed, 0.1);
      if (!playing) audioElement.play(), playing = true;
      return;
    }

    const absSpeed = Math.abs(speed);
    const computedPeriod = computePeriod(chunkLength, absSpeed, fadeSec);
    const stepToUse = (!Number.isNaN(stepSize) && stepSize > 0) ? stepSize : computedPeriod;

    const newOptions = {
      startPosition: currentCursor,
      segmentDuration: chunkLength,
      step: stepToUse,
      period: computedPeriod,
      overlapSec: fadeSec,
      speed: absSpeed
    };

    // If a reverse loop is already running, defer application until next chunk boundary.
    if (reverseLoopActive) {
      pendingReverseOptions = newOptions;
      updateParamInputs(newOptions);
      return;
    }

    playing = false;
    audioElement.pause();
    stopReverse();
    lastReverseOptions = Object.assign({}, newOptions);
    updateParamInputs(lastReverseOptions);
    reverseActive = true;
    playReverseChunks(buffer, lastReverseOptions);
    } finally {
    _speedCommitLock = false;
  }
}

speedSlider.addEventListener("input", () => {
  const s = getSpeedFromUI();
  speedVal.textContent = s >= 0 ? `${s.toFixed(2)}x` : `Reverse ${Math.abs(s).toFixed(2)}x`;

  if (reverseLoopActive) {
    liveSpeed = s;
    const chunk = parseFloat(lengthInput.value) || 1.25;
    const fade = parseFloat(fadeInput.value) || 0;
    const livePeriod = computePeriod(chunk, Math.abs(s), fade);
    updateParamInputs({ period: livePeriod });
    return;
  }

  liveSpeed = null;
  updateParamInputs();
  try { audioElement.playbackRate = Math.max(s, 0.1); } catch (e) {}
});

speedSlider.addEventListener("pointerdown", () => { isSpeedDragging = true; });
speedSlider.addEventListener("change", () => { handleSpeedCommit().catch(()=>{}); });
document.addEventListener("pointerup", async () => {
  if (!isSpeedDragging) return;
  isSpeedDragging = false;
  await handleSpeedCommit().catch(()=>{});
});

// --- AudioContext setup ---
async function ensureCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();
}

// --- Load buffer ---
async function loadBuffer() {
  if (buffer) return buffer;
  await ensureCtx();
  const response = await fetch("audio.mp3");
  const arrayBuffer = await response.arrayBuffer();
  buffer = await audioCtx.decodeAudioData(arrayBuffer);
  currentCursor = buffer.duration / 2; // start in middle
  return buffer;
}

// --- Timeline ---
function updateTimeline() {
  if (!buffer) return;
  positionSlider.value = (currentCursor / buffer.duration) * 100;
  timeDisplay.textContent = `${formatTime(currentCursor)} / ${formatTime(buffer.duration)}`;
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2,"0")}`;
}

// --- Forward timeline update ---
setInterval(() => {
  if (!reverseActive && buffer && playing) currentCursor = audioElement.currentTime;
  updateTimeline();
}, 100);

// --- Play / Pause button ---
playBtn.addEventListener("click", async () => {
  await loadBuffer();

  // If in reverse mode: toggle pause/resume of the reverse run
  if (reverseActive) {
    if (reverseLoopActive) {
      stopReverse();
      playing = false;
      updateTimeline();
      return;
    } else {
      if (!lastReverseOptions) {
        lastReverseOptions = {
          startPosition: currentCursor,
          segmentDuration: parseFloat(lengthInput.value),
          step: parseFloat(stepInput.value),
          overlapSec: parseFloat(fadeInput.value),
          speed: Math.abs(speedSlider.value / 100) || 1
        };
      }
      await ensureCtx();
      reverseActive = true;
      playing = false;
      audioElement.pause();
      playReverseChunks(buffer, lastReverseOptions);
      return;
    }
  }

  await ensureCtx();
  if (!playing) {
    audioElement.currentTime = currentCursor;
    audioElement.play();
    playing = true;
  } else {
    audioElement.pause();
    playing = false;
    currentCursor = audioElement.currentTime;
  }
});

// --- Position slider ---
positionSlider.addEventListener("input", () => {
  if (!buffer) return;
  currentCursor = (positionSlider.value / 100) * buffer.duration;

  if (reverseActive) {
    stopReverse();
    const speed = speedSlider.value / 100;
    if (speed < 0) {
      lastReverseOptions = {
        startPosition: currentCursor,
        segmentDuration: parseFloat(lengthInput.value),
        step: parseFloat(stepInput.value),
        overlapSec: parseFloat(fadeInput.value),
        speed: Math.abs(speed)
      };
      playReverseChunks(buffer, lastReverseOptions);
    }
  } else {
    audioElement.currentTime = currentCursor;
  }
});


speedSlider.addEventListener("input", () => {
  const s = getSpeedFromUI();
  speedVal.textContent = s >= 0 ? `${s.toFixed(2)}x` : `Reverse ${Math.abs(s).toFixed(2)}x`;
  updateParamInputs();
});

stepInput.addEventListener("input", async () => {
  const uiStep = parseFloat(stepInput.value);
  if (Number.isNaN(uiStep) || uiStep <= 0) return;

  if (!lastReverseOptions) lastReverseOptions = {
    startPosition: currentCursor,
    segmentDuration: parseFloat(lengthInput.value),
    step: uiStep,
    period: null,
    overlapSec: parseFloat(fadeInput.value),
    speed: Math.abs(speedSlider.value / 100) || 1
  };

  lastReverseOptions.step = uiStep;
  updateParamInputs(lastReverseOptions);

  if (reverseActive) {
    await loadBuffer();
    await ensureCtx();
    stopReverse();
    reverseActive = true;
    playing = false;
    try { audioElement.pause(); } catch (e) {}
    playReverseChunks(buffer, lastReverseOptions);
  }
});

// --- Reverse playback via chunks ---
async function playReverseChunks(buffer, options) {
  if (!buffer) return;
  await ensureCtx();

  // cancel any previous run (bump token) and stop previous scheduled sources
  _reverseRunToken++;
  const myToken = _reverseRunToken;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  for (const o of activeSources.slice()) {
    try { o.src.stop(); } catch (e) {}
    try { o.src.disconnect(); } catch (e) {}
    try { o.gain.disconnect(); } catch (e) {}
  }
  activeSources.length = 0;

  reverseLoopActive = true;
  reverseActive = true;

  const sr = buffer.sampleRate;
  const masterGain = audioCtx.createGain();
  masterGain.connect(audioCtx.destination);

    let {
    startPosition = buffer.duration/2,
    segmentDuration = 1.25,
    step: stepOpt = null,
    period: periodOpt = null,
    overlapSec = 0.25,
    speed = 1
  } = options || {};

  // period: speed = (length - fade) / period  =>  period = (length - fade) / speed
  let safeSpeed = Math.max(Math.abs(speed), 1e-6);
  let computedPeriod = Math.max(segmentDuration - (overlapSec || 0), 1e-6) / safeSpeed;
  let period = (periodOpt != null) ? periodOpt : computedPeriod;
  let stepJump = (stepOpt != null) ? stepOpt : period;

  updateParamInputs({ segmentDuration, period, step: stepJump, overlapSec });

  let cursor = startPosition;
  let currentScheduledTime = null;
  let currentSegmentStart = null;

  // ensure only one progress interval is running
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  intervalId = setInterval(() => {
    if (!reverseLoopActive) { clearInterval(intervalId); intervalId = null; return; }
    if (currentScheduledTime == null || currentSegmentStart == null) return;
    const elapsed = audioCtx.currentTime - currentScheduledTime;
    const pos = Math.max(0, currentSegmentStart + elapsed);
    currentCursor = Math.min(buffer.duration, pos);
    updateTimeline();
  }, 30);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const cancelled = () => (myToken !== _reverseRunToken) || !reverseLoopActive;

  while (!cancelled() && cursor > 0) {
    // if user is dragging the slider, apply live speed changes here (affects scheduling rate smoothly)
    if (liveSpeed != null) {
      speed = Math.abs(liveSpeed);
      safeSpeed = Math.max(Math.abs(speed), 1e-6);
      computedPeriod = Math.max(segmentDuration - (overlapSec || 0), 1e-6) / safeSpeed;

      const explicitPeriod = (lastReverseOptions && lastReverseOptions.period != null) ? lastReverseOptions.period : periodOpt;
      period = (explicitPeriod != null) ? explicitPeriod : computedPeriod;

      stepJump = (lastReverseOptions && lastReverseOptions.step != null) ? lastReverseOptions.step : period;
      updateParamInputs({ segmentDuration, period, step: stepJump, overlapSec });
    }

    const segmentStart = Math.max(0, cursor - segmentDuration);
    const actualDuration = cursor - segmentStart;
    if (actualDuration <= 0) {
      cursor -= stepJump;
      continue;
    }

    const frameCount = Math.floor(actualDuration * sr);
    const segmentBuffer = audioCtx.createBuffer(buffer.numberOfChannels, frameCount, sr);
    const inputOffset = Math.floor(segmentStart * sr);

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = segmentBuffer.getChannelData(ch);
      for (let i = 0; i < frameCount; i++) output[i] = input[inputOffset + i];
    }

    const src = audioCtx.createBufferSource();
    src.buffer = segmentBuffer;
    const gain = audioCtx.createGain();
    src.connect(gain).connect(masterGain);

    // --- overlap / fade logic (replace existing fade block with this) ---
    // allow multiple overlapping segments — period = how often we schedule,
    // segmentDuration = chunk length, stepJump = cursor jump
    const maxOverlap = Math.max(0, segmentDuration - period);
    const desiredOverlap = (overlapSec != null && overlapSec > 0) ? overlapSec : maxOverlap;
    const overlapApplied = Math.min(desiredOverlap, actualDuration);
    const fadeIn = Math.min(overlapApplied / 2, actualDuration / 2);
    const fadeOut = Math.min(overlapApplied / 2, actualDuration / 2);

    const scheduledTime = audioCtx.currentTime + 0.02; // small offset to allow scheduling

    // update progress tracker for interval
    currentScheduledTime = scheduledTime;
    currentSegmentStart = segmentStart;

    // schedule fades on this segment's gain (each segment has its own gain node so many can overlap)
    gain.gain.cancelScheduledValues(scheduledTime);

    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0, scheduledTime);
      gain.gain.linearRampToValueAtTime(1, scheduledTime + fadeIn);
    } else {
      gain.gain.setValueAtTime(1, scheduledTime);
    }

    if (fadeOut > 0) {
      gain.gain.setValueAtTime(1, scheduledTime + Math.max(0, actualDuration - fadeOut));
      gain.gain.linearRampToValueAtTime(0, scheduledTime + actualDuration);
    } else {
      gain.gain.setValueAtTime(0, scheduledTime + actualDuration);
    }

    activeSources.push({ src, gain });
    const removeSource = () => {
      const idx = activeSources.findIndex(o => o.src === src);
      if (idx !== -1) activeSources.splice(idx, 1);
      try { src.disconnect(); } catch (e) {}
      try { gain.disconnect(); } catch (e) {}
    };
    src.onended = removeSource;
    src.start(scheduledTime);
    src.stop(scheduledTime + actualDuration);

    cursor -= stepJump;
    const waitMs = Math.max(0, (scheduledTime + period - audioCtx.currentTime) * 1000);
    const deadline = Date.now() + waitMs;
    while (!cancelled() && Date.now() < deadline) {
      await sleep(Math.min(40, deadline - Date.now()));
    }

    if (!cancelled() && pendingReverseOptions) {
      lastReverseOptions = Object.assign({}, lastReverseOptions || {}, pendingReverseOptions);

      if (lastReverseOptions.segmentDuration != null) segmentDuration = lastReverseOptions.segmentDuration;
      if (lastReverseOptions.overlapSec != null) overlapSec = lastReverseOptions.overlapSec;
      if (lastReverseOptions.speed != null) speed = lastReverseOptions.speed;

      safeSpeed = Math.max(Math.abs(speed), 1e-6);
      computedPeriod = Math.max(segmentDuration - (overlapSec || 0), 1e-6) / safeSpeed;
      period = (lastReverseOptions.period != null) ? lastReverseOptions.period : computedPeriod;
      stepJump = (lastReverseOptions.step != null) ? lastReverseOptions.step : period;

      updateParamInputs({ segmentDuration, period, step: stepJump, overlapSec });
      pendingReverseOptions = null;
    }
  }
  // pause audio if you hit the beginning while reversing
  if (!cancelled()) {
    reverseLoopActive = false;
    playing = false;
    currentCursor = 0;
    updateTimeline();

    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
}

// --- Stop reverse ---
function stopReverse() {
  _reverseRunToken++;
  reverseLoopActive = false;
  if (!lastReverseOptions) lastReverseOptions = {};
  lastReverseOptions.startPosition = currentCursor;

  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  for (const o of activeSources.slice()) {
    try { o.src.stop(); } catch (e) {}
    try { o.src.disconnect(); } catch (e) {}
    try { o.gain.disconnect(); } catch (e) {}
  }
  activeSources.length = 0;
}
