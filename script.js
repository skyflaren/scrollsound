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

// update the inputs to reflect the actual runtime values
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
      // currently running reverse -> pause it
      stopReverse();
      playing = false;
      updateTimeline();
      return;
    } else {
      // reverse mode set but not running -> resume using last options
      if (!lastReverseOptions) {
        // fallback: construct sensible options from current UI
        lastReverseOptions = {
          startPosition: currentCursor,
          segmentDuration: parseFloat(lengthInput.value),
          step: parseFloat(stepInput.value),      // <- use 'step'
          overlapSec: parseFloat(fadeInput.value),
          speed: Math.abs(speedSlider.value / 100) || 1
        };
      }
      // start reverse WITHOUT awaiting so UI doesn't block
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
      // store options so we can resume later
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

// --- Speed slider ---
speedSlider.addEventListener("input", async () => {
  const speed = speedSlider.value / 100;
  speedVal.textContent = speed >= 0 ? `${speed.toFixed(2)}x` : `Reverse ${Math.abs(speed).toFixed(2)}x`;

  await loadBuffer();
  await ensureCtx();

  const chunkLength = parseFloat(lengthInput.value); // chunk length (segmentDuration)
  const stepSize = parseFloat(stepInput.value);      // step = how much cursor jumps
  const fadeSec = parseFloat(fadeInput.value);

  if (speed >= 0) {
    // Forward playback
    stopReverse();
    reverseActive = false;
    audioElement.currentTime = currentCursor;
    audioElement.playbackRate = Math.max(speed, 0.1);
    if (!playing) audioElement.play(), playing = true;
  } else {
    // Reverse playback
    playing = false;
    audioElement.pause();
    stopReverse();

    // compute period from formula: speed = length / period  =>  period = length / speed
    const absSpeed = Math.abs(speed);
    const computedPeriod = Math.max(chunkLength - fadeSec, 1e-6) / Math.max(absSpeed, 1e-6);

    // step = how much we jump each iteration (use UI step if provided, otherwise default to period)
    const stepToUse = (!Number.isNaN(stepSize) && stepSize > 0) ? stepSize : computedPeriod;

    // record options so pause/resume keeps same reverse speed/direction
    lastReverseOptions = {
      startPosition: currentCursor,
      segmentDuration: chunkLength, // chunk length
      step: stepToUse,              // jump amount (seconds)
      period: computedPeriod,       // how often we schedule (seconds)
      overlapSec: fadeSec,
      speed: absSpeed
    };

    // update displayed inputs to show resolved values
    updateParamInputs(lastReverseOptions);

    reverseActive = true;
    // start reverse run without awaiting
    playReverseChunks(buffer, lastReverseOptions);
  }
});

stepInput.addEventListener("input", async () => {
  const uiStep = parseFloat(stepInput.value);
  if (Number.isNaN(uiStep) || uiStep <= 0) return;

  // ensure we have lastReverseOptions
  if (!lastReverseOptions) lastReverseOptions = {
    startPosition: currentCursor,
    segmentDuration: parseFloat(lengthInput.value),
    step: uiStep,
    period: null,
    overlapSec: parseFloat(fadeInput.value),
    speed: Math.abs(speedSlider.value / 100) || 1
  };

  // store jump amount (step). Do NOT overwrite period here — period is derived from speed (length/speed)
  lastReverseOptions.step = uiStep;

  // update displayed inputs to show resolved values
  updateParamInputs(lastReverseOptions);

  // if currently in reverse mode, restart the reverse loop with the new step
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

  const {
    startPosition = buffer.duration / 2,
    segmentDuration = 1.25,     // chunk length
    step: stepOpt = null,       // jump amount (sec)
    period: periodOpt = null,   // how often to schedule (sec)
    overlapSec = 0.25,
    speed = 1
  } = options || {};

  // period: speed = length / period  =>  period = length / speed
  const safeSpeed = Math.max(Math.abs(speed), 1e-6);
  const computedPeriod = Math.max(segmentDuration - (overlapSec || 0), 1e-6) / safeSpeed;
  // prefer explicit period passed in options; otherwise use computed period
  const period = (periodOpt != null) ? periodOpt : computedPeriod;
  // prefer explicit step (jump) passed in options; otherwise default to period
  const stepJump = (stepOpt != null) ? stepOpt : period;

  updateParamInputs({ segmentDuration, period, step: stepJump, overlapSec });

  let cursor = startPosition;

  // single progress tracker for currently-scheduled segment
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
    // use user overlap if provided, otherwise use physical maxOverlap
    const desiredOverlap = (overlapSec != null && overlapSec > 0) ? overlapSec : maxOverlap;
    // cap total overlap to the actual segment duration
    const overlapApplied = Math.min(desiredOverlap, actualDuration);
    // split overlap between fade-in and fade-out
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

    // ensure node cleanup when done
    const removeSource = () => {
      const idx = activeSources.findIndex(o => o.src === src);
      if (idx !== -1) activeSources.splice(idx, 1);
      try { src.disconnect(); } catch (e) {}
      try { gain.disconnect(); } catch (e) {}
    };
    src.onended = removeSource;

    src.start(scheduledTime);
    src.stop(scheduledTime + actualDuration);

    // move cursor by jump amount (step)
    cursor -= stepJump;

    // wait period seconds before scheduling next chunk (or bail early on cancel)
    const waitMs = Math.max(0, (scheduledTime + period - audioCtx.currentTime) * 1000);
    const deadline = Date.now() + waitMs;
    // poll for cancellation during wait so we can break quickly if needed
    while (!cancelled() && Date.now() < deadline) {
      await sleep(Math.min(40, deadline - Date.now()));
    }
  }
}

// --- Stop reverse ---
function stopReverse() {
  // cancel any running reverse loop
  _reverseRunToken++;
  reverseLoopActive = false;
  // keep reverseActive = true so UI knows we're still in reverse mode (just paused)
  // remember current position so resume continues at same spot/speed
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
