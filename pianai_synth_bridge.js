
// pianai_moog_bridge.js
// Bridges new UI controls to existing engine functions (if present), adds split routing & active key highlight & MIDI mapping.
(function(){
  // ----- Helpers -----
  const NOTE_NAMES = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B'];

  function midiToNoteName(m){
    const n = NOTE_NAMES[m % 12];
    const oct = Math.floor(m/12) - 1;
    return `${n}${oct}`;
  }
  function noteNameToMidi(name){
    const m = String(name).trim();
    const mm = m.match(/^([A-Ga-g])(#|s)?(-?\d+)$/);
    if(!mm) return null;
    const letter = mm[1].toUpperCase();
    const sharp = (mm[2]==='#' || mm[2]==='s') ? 's' : '';
    const oct = parseInt(mm[3],10);
    const key = letter + sharp;
    const idx = NOTE_NAMES.indexOf(key);
    if(idx<0) return null;
    return (oct+1)*12 + idx;
  }

  // ----- Split / routing state -----
  let splitMidi = noteNameToMidi('C4') ?? 60;
  let routing = { left:'bass', right:'piano', mode:'split', single:'piano' };

  window.__pianai_set_split = (noteName)=>{
    const m = noteNameToMidi(noteName.replace('#','s'));
    if(m==null) return;
    splitMidi = m;
    // Update label if present
    const el = document.querySelector('.split-label');
    if(el) el.innerHTML = `Split: <strong>${noteName.replace('s','#')}</strong> (sinistra = ${routing.left.toUpperCase()}, destra = ${routing.right.toUpperCase()})`;
  };

  window.__pianai_set_routing = (r)=>{
    routing = {...routing, ...r};
    const el = document.querySelector('.split-label');
    if(el){
      const sName = midiToNoteName(splitMidi).replace('s','#');
      el.innerHTML = `Split: <strong>${sName}</strong> (sinistra = ${routing.left.toUpperCase()}, destra = ${routing.right.toUpperCase()})`;
    }
  };

  // ----- Active key highlight -----
  const activeKeys = new Set();
  function setKeyActive(noteName, on){
    const keyEl = document.querySelector(`[data-note="${noteName}"]`);
    if(!keyEl) return;
    if(on) keyEl.classList.add('active');
    else keyEl.classList.remove('active');
  }

  // ----- Preset loader wrapper (robust URLs) -----
  // We create a robust preset loader if the existing one isn't robust.
  async function robustFetch(url){
    const res = await fetch(url, {cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  // Map preset name -> folder
  const PRESET_FOLDERS = {
    piano: 'sounds/piano_sine/',
    guitar: 'sounds/guitar/',
    bass: 'sounds/bass/'
  };

  // Keep in-memory AudioBuffers per preset
  const buffers = { piano:new Map(), guitar:new Map(), bass:new Map() };
  let audioCtx = null;
  function getCtx(){
    audioCtx = audioCtx || (window.AudioContext ? new AudioContext() : new webkitAudioContext());
    return audioCtx;
  }

  async function loadWavToBuffer(url){
    const ctx = getCtx();
    const res = await robustFetch(url);
    const arr = await res.arrayBuffer();
    return await ctx.decodeAudioData(arr);
  }

  async function loadPresetMultisample(preset){
    const folder = PRESET_FOLDERS[preset];
    if(!folder) throw new Error('Preset sconosciuto');
    const notes = [];
    for(let midi=36; midi<=84; midi++){ // C2..C6
      notes.push(midiToNoteName(midi));
    }
    const map = buffers[preset];
    // Load missing only
    const tasks = notes.map(async(n)=>{
      if(map.has(n)) return;
      const filename = encodeURIComponent(n) + '.wav';
      const url = new URL(folder + filename, location.href).toString();
      const buf = await loadWavToBuffer(url);
      map.set(n, buf);
    });
    await Promise.all(tasks);
    return true;
  }

  window.__pianai_load_preset = async (preset)=>{
    await loadPresetMultisample(preset);
  };

  // ----- Simple synth chain (macro filter + mix) -----
  const chain = {
    masterGain: null,
    limiter: null,
    filter: null,
    bassEQ: null,
    brightEQ: null
  };
  function ensureChain(){
    const ctx = getCtx();
    if(chain.masterGain) return;
    const master = ctx.createGain();
    master.gain.value = 0.85;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 14000;
    filter.Q.value = 0.6;

    const bassEQ = ctx.createBiquadFilter();
    bassEQ.type = 'lowshelf';
    bassEQ.frequency.value = 140;
    bassEQ.gain.value = 0;

    const brightEQ = ctx.createBiquadFilter();
    brightEQ.type = 'highshelf';
    brightEQ.frequency.value = 3500;
    brightEQ.gain.value = 0;

    // Limiter via dynamics compressor
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    filter.connect(bassEQ);
    bassEQ.connect(brightEQ);
    brightEQ.connect(limiter);
    limiter.connect(master);
    master.connect(ctx.destination);

    chain.masterGain = master;
    chain.filter = filter;
    chain.bassEQ = bassEQ;
    chain.brightEQ = brightEQ;
    chain.limiter = limiter;
  }

  // Mix state
  let mix = { piano:0.85, guitar:0.65, bass:0.80, master:0.85 };
  window.__pianai_apply_mix = (m)=>{ mix = {...mix, ...m}; ensureChain(); chain.masterGain.gain.value = mix.master; };

  // Macro state -> filter & EQ
  window.__pianai_apply_macro = ({tone, bright, bass})=>{
    ensureChain();
    // Tone: lowpass cutoff 300..16000 (exp-ish)
    const t = Math.max(0, Math.min(100, tone));
    const cutoff = 300 * Math.pow(16000/300, t/100);
    chain.filter.frequency.setTargetAtTime(cutoff, getCtx().currentTime, 0.02);

    // Bright: highshelf -6..+8 dB
    const b = Math.max(0, Math.min(100, bright));
    const brightDb = -6 + (b/100)*14;
    chain.brightEQ.gain.setTargetAtTime(brightDb, getCtx().currentTime, 0.02);

    // Bass: lowshelf -6..+10 dB
    const bs = Math.max(0, Math.min(100, bass));
    const bassDb = -6 + (bs/100)*16;
    chain.bassEQ.gain.setTargetAtTime(bassDb, getCtx().currentTime, 0.02);
  };

  // ADSR state
  let adsr = { a:15, d:180, s:0.7, r:220 };
  window.__pianai_set_adsr = (v)=>{ adsr = {...adsr, ...v}; };

  // ----- Play note (sample) -----
  // If existing engine exposes a playNote function, we can call it; else use our own.
  function playSample(preset, noteName, velocity=1){
    ensureChain();
    const ctx = getCtx();
    const map = buffers[preset];
    const buf = map.get(noteName);
    if(!buf) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const g = ctx.createGain();
    const vel = Math.max(0.05, Math.min(1, velocity));
    // ADSR envelope
    const now = ctx.currentTime;
    const a = adsr.a/1000, d = adsr.d/1000, r = adsr.r/1000, s = adsr.s;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(vel, now + a);
    g.gain.linearRampToValueAtTime(vel*s, now + a + d);

    // per-preset gain
    const presetGain = ctx.createGain();
    presetGain.gain.value = mix[preset] ?? 0.8;

    src.connect(g);
    g.connect(presetGain);
    presetGain.connect(chain.filter);

    src.start();
    return { src, g, presetGain, stop: ()=>{
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0.0001, t + r);
      src.stop(t + r + 0.02);
    }};
  }

  // Track voices by midi note
  const voices = new Map();

  function choosePresetForMidi(midi){
    if(routing.mode==='layer') return ['piano','guitar','bass'];
    if(routing.mode==='single') return [routing.single];
    // split
    return (midi <= splitMidi) ? [routing.left] : [routing.right];
  }

  async function ensurePresetsLoaded(presets){
    // Load missing presets on demand
    await Promise.all(presets.map(p=>{
      const map = buffers[p];
      // if empty, load
      if(map && map.size>0) return Promise.resolve();
      return loadPresetMultisample(p);
    }));
  }

  async function noteOn(midi, velocity=127){
    const noteName = midiToNoteName(midi);
    setKeyActive(noteName, true);
    activeKeys.add(noteName);

    const presets = choosePresetForMidi(midi);
    await ensurePresetsLoaded(presets);

    const vel = velocity/127;
    const v = presets.map(p=>playSample(p, noteName, vel)).filter(Boolean);
    if(v.length) voices.set(midi, v);
  }

  function noteOff(midi){
    const noteName = midiToNoteName(midi);
    setKeyActive(noteName, false);
    activeKeys.delete(noteName);

    const v = voices.get(midi);
    if(v){
      v.forEach(x=>x?.stop?.());
      voices.delete(midi);
    }
  }

  // Expose for MIDI hook
  window.__pianai_midi_noteon = (midi, vel)=>{ noteOn(midi, vel).catch(()=>{}); };
  window.__pianai_midi_noteoff = (midi)=>{ noteOff(midi); };

  // Hook clicks on keys created by existing keyboard renderer: we expect keys with data-note
  // If keyboard isn't rendered yet, wait and attach using event delegation.
  document.addEventListener('click', async (e)=>{
    const key = e.target.closest('.key');
    if(!key) return;
    const noteName = key.getAttribute('data-note');
    if(!noteName) return;
    const midi = noteNameToMidi(noteName);
    if(midi==null) return;
    // start audio context on user gesture
    getCtx().resume?.();
    await noteOn(midi, 110);
    // auto release if click (short)
    setTimeout(()=>noteOff(midi), 140);
  });

  // Keyboard input (PC): map row to notes around C4
  const KEYMAP = {
    'z': 'C3','s':'Cs3','x':'D3','d':'Ds3','c':'E3','v':'F3','g':'Fs3','b':'G3','h':'Gs3','n':'A3','j':'As3','m':'B3',
    ',':'C4','l':'Cs4','.':'D4',';':'Ds4','/':'E4',
    'q':'C4','2':'Cs4','w':'D4','3':'Ds4','e':'E4','r':'F4','5':'Fs4','t':'G4','6':'Gs4','y':'A4','7':'As4','u':'B4','i':'C5'
  };
  const down = new Set();
  window.addEventListener('keydown', (e)=>{
    if(e.repeat) return;
    const n = KEYMAP[e.key];
    if(!n) return;
    const midi = noteNameToMidi(n);
    if(midi==null) return;
    if(down.has(e.key)) return;
    down.add(e.key);
    getCtx().resume?.();
    noteOn(midi, 110).catch(()=>{});
  });
  window.addEventListener('keyup', (e)=>{
    const n = KEYMAP[e.key];
    if(!n) return;
    down.delete(e.key);
    const midi = noteNameToMidi(n);
    if(midi==null) return;
    noteOff(midi);
  });

  // Limiter toggle
  const chkLimiter = document.getElementById('chkLimiter');
  if(chkLimiter){
    chkLimiter.addEventListener('change', ()=>{
      ensureChain();
      // bypass by changing ratio/threshold
      if(chkLimiter.checked){
        chain.limiter.threshold.value = -8;
        chain.limiter.ratio.value = 20;
      }else{
        chain.limiter.threshold.value = 0;
        chain.limiter.ratio.value = 1;
      }
    });
  }

})();
