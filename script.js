let audioCtx;
let buffer;
let source;
let playing = false;

let jump = 2;
let segment = 2;
let interval = 2;

const playBtn = document.getElementById("play");
const reverse = document.getElementById("reverse");
const slider = document.getElementById("slider");
const playbackRateDisplay = document.getElementById("playbackRate");

const audioElement = new Audio('song.mp3');
audioElement.loop = true;
audioElement.crossOrigin = 'anonymous';

if ('preservesPitch' in audioElement) audioElement.preservesPitch = true;
if ('webkitPreservesPitch' in audioElement) audioElement.webkitPreservesPitch = true;
if ('mozPreservesPitch' in audioElement) audioElement.mozPreservesPitch = true;

let mediaSource;

playBtn.addEventListener("click", async () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    mediaSource = audioCtx.createMediaElementSource(audioElement);
    const gain = audioCtx.createGain();
    mediaSource.connect(gain).connect(audioCtx.destination);
  }

  if (audioCtx.state === 'suspended') await audioCtx.resume();

  if (!playing) {
    await audioElement.play();
    playing = true;
  } else {
    audioElement.pause();
    playing = false;
  }
});

slider.oninput = () => {
  const rate = slider.value / 100;
  playbackRateDisplay.textContent = rate.toFixed(1);
  audioElement.playbackRate = rate;
};

let reverseActive = false;
let reverseTimer = null;
let reverseCycle = 0;
let reverseInitialStart = 0;

async function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    mediaSource = audioCtx.createMediaElementSource(audioElement);
    const gain = audioCtx.createGain();
    mediaSource.connect(gain).connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}

function stopReverse() {
  reverseActive = false;
  if (reverseTimer) {
    clearTimeout(reverseTimer);
    reverseTimer = null;
  }
  try { audioElement.pause(); } catch (e) {}
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function playOneSegment(startTime) {
  audioElement.currentTime = startTime;
  await audioElement.play();
  await sleep(Math.max(0, segment) * 1000);
  try { audioElement.pause(); } catch (e) {}
}

reverse.addEventListener("click", async () => {
  if (reverseActive) {
    stopReverse();
    return;
  }

  await ensureAudioContext();
  if (!isFinite(audioElement.duration) || audioElement.duration === 0) {
    await new Promise(resolve => {
      const onLoaded = () => {
        audioElement.removeEventListener('loadedmetadata', onLoaded);
        resolve();
      };
      audioElement.addEventListener('loadedmetadata', onLoaded);
      try { audioElement.load(); } catch(e) {}
    });
  }

  reverseActive = true;
  reverseCycle = 0;
  reverseInitialStart = Math.min(audioElement.currentTime || 0, audioElement.duration || Infinity);

  const runCycle = async () => {
    if (!reverseActive) return;

    const start = Math.max(0, reverseInitialStart - (reverseCycle * jump));
    await playOneSegment(start);
    reverseCycle++;

    if (start <= 0) {
      stopReverse();
      return;
    }

    const delayMs = Math.max(0, (interval - segment) * 1000);
    reverseTimer = setTimeout(() => {
      reverseTimer = null;
      runCycle();
    }, delayMs);
  };

  runCycle();
});