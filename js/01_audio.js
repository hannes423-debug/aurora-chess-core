
/* ======================================================
   ── AUDIO ENGINE (Web Audio API — no files)
====================================================== */
let _AC = null;
function getAC() {
  if (!_AC) _AC = new (window.AudioContext || window.webkitAudioContext)();
  if (_AC.state === 'suspended') _AC.resume();
  return _AC;
}
const SND = {
  on: true, vol: 0.6,
  _p(fn) { if (!SND.on) return; try { fn(getAC()); } catch(e) {} },
  ui()      { SND._p(c => {
    const o=c.createOscillator(),g=c.createGain(),f=c.createBiquadFilter();
    f.type='highpass';f.frequency.value=800;
    o.connect(f);f.connect(g);g.connect(c.destination);
    o.type='square';
    o.frequency.setValueAtTime(1100,c.currentTime);
    o.frequency.exponentialRampToValueAtTime(750,c.currentTime+0.038);
    g.gain.setValueAtTime(SND.vol*0.055,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.048);
    o.start();o.stop(c.currentTime+0.05);
  }); },
  confirm() { SND._p(c => {
    [[0,880],[0.06,1320]].forEach(([t,f])=>{
      const o=c.createOscillator(),g=c.createGain();
      o.connect(g);g.connect(c.destination);
      o.type='square';o.frequency.value=f;
      g.gain.setValueAtTime(SND.vol*0.065,c.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+t+0.055);
      o.start(c.currentTime+t);o.stop(c.currentTime+t+0.06);
    });
  }); },
  select()  { SND._p(c => {
    const jit=0.93+Math.random()*0.14;
    const o=c.createOscillator(),g=c.createGain(),f=c.createBiquadFilter();
    f.type='highpass';f.frequency.value=700;
    o.connect(f);f.connect(g);g.connect(c.destination);
    o.type='square';
    o.frequency.setValueAtTime(900*jit,c.currentTime);
    o.frequency.exponentialRampToValueAtTime(600*jit,c.currentTime+0.042);
    g.gain.setValueAtTime(SND.vol*0.08,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.055);
    o.start();o.stop(c.currentTime+0.06);
  }); },
  place()   { SND._p(c => {
    const jit=0.92+Math.random()*0.16;
    const len=Math.floor(c.sampleRate*0.11);
    const buf=c.createBuffer(1,len,c.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const env=Math.sin((i/len)*Math.PI);
      d[i]=(Math.random()*2-1)*env*0.6;
    }
    const ns=c.createBufferSource(),ng=c.createGain();
    const lp=c.createBiquadFilter(),hp=c.createBiquadFilter();
    lp.type='lowpass'; lp.frequency.value=2800*jit;
    hp.type='highpass';hp.frequency.value=400;
    ns.buffer=buf;ns.connect(hp);hp.connect(lp);lp.connect(ng);ng.connect(c.destination);
    ng.gain.setValueAtTime(SND.vol*0.38,c.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.12);
    ns.start();
    const o=c.createOscillator(),g=c.createGain();
    o.connect(g);g.connect(c.destination);
    o.type='sine';o.frequency.setValueAtTime(140*jit,c.currentTime+0.07);
    o.frequency.exponentialRampToValueAtTime(60,c.currentTime+0.14);
    g.gain.setValueAtTime(0,c.currentTime+0.07);
    g.gain.linearRampToValueAtTime(SND.vol*0.22,c.currentTime+0.09);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.17);
    o.start(c.currentTime+0.07);o.stop(c.currentTime+0.18);
  }); },
  placeLayer() { SND._p(c => {
    const tlen=Math.floor(c.sampleRate*0.008);
    const tbuf=c.createBuffer(1,tlen,c.sampleRate),td=tbuf.getChannelData(0);
    for(let i=0;i<tlen;i++) td[i]=(Math.random()*2-1)*Math.pow(1-i/tlen,1.8);
    const tns=c.createBufferSource(),tng=c.createGain(),tnf=c.createBiquadFilter();
    tnf.type='bandpass';tnf.frequency.value=5500;tnf.Q.value=1.2;
    tns.buffer=tbuf;tns.connect(tnf);tnf.connect(tng);tng.connect(c.destination);
    tng.gain.setValueAtTime(SND.vol*1.1,c.currentTime);
    tng.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.01);
    tns.start();
    const o=c.createOscillator(),g=c.createGain(),bq=c.createBiquadFilter();
    bq.type='peaking';bq.frequency.value=6000;bq.gain.value=8;bq.Q.value=8;
    o.connect(bq);bq.connect(g);g.connect(c.destination);
    o.type='triangle';o.frequency.value=5200;
    g.gain.setValueAtTime(SND.vol*0.14,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.09);
    o.start();o.stop(c.currentTime+0.1);
    const o2=c.createOscillator(),g2=c.createGain();
    o2.connect(g2);g2.connect(c.destination);
    o2.type='sine';o2.frequency.setValueAtTime(220,c.currentTime);
    o2.frequency.exponentialRampToValueAtTime(55,c.currentTime+0.06);
    g2.gain.setValueAtTime(SND.vol*0.4,c.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.08);
    o2.start();o2.stop(c.currentTime+0.09);
  }); },
  glide()   { SND._p(c => {
    // Slide: lighter/higher than place() — static filter freqs (no BiquadFilter scheduling)
    const len=Math.floor(c.sampleRate*0.13);
    const buf=c.createBuffer(1,len,c.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<len;i++){const env=Math.sin((i/len)*Math.PI);d[i]=(Math.random()*2-1)*env*0.7;}
    const ns=c.createBufferSource(),ng=c.createGain();
    const hp=c.createBiquadFilter(),lp=c.createBiquadFilter();
    hp.type='highpass';hp.frequency.value=1200;
    lp.type='lowpass'; lp.frequency.value=5500;
    ns.buffer=buf;ns.connect(hp);hp.connect(lp);lp.connect(ng);ng.connect(c.destination);
    ng.gain.setValueAtTime(SND.vol*0.5,c.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.14);
    ns.start();
    // Rising chirp for "slide" feel (oscillator freq scheduling is reliable)
    const o=c.createOscillator(),g=c.createGain();
    o.connect(g);g.connect(c.destination);
    o.type='sine';
    o.frequency.setValueAtTime(300,c.currentTime);
    o.frequency.exponentialRampToValueAtTime(900,c.currentTime+0.07);
    o.frequency.exponentialRampToValueAtTime(300,c.currentTime+0.13);
    g.gain.setValueAtTime(0,c.currentTime);
    g.gain.linearRampToValueAtTime(SND.vol*0.18,c.currentTime+0.04);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.14);
    o.start();o.stop(c.currentTime+0.15);
  }); },
  capture() { SND._p(c => {
    const jit=0.9+Math.random()*0.2;
    const buf=c.createBuffer(1,Math.floor(c.sampleRate*0.22),c.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,1.15);
    const ns=c.createBufferSource(),ng=c.createGain(),nf=c.createBiquadFilter();
    nf.type='bandpass';nf.frequency.value=2000*jit;nf.Q.value=0.35;
    ns.buffer=buf;ns.connect(nf);nf.connect(ng);ng.connect(c.destination);
    ng.gain.setValueAtTime(SND.vol*1.5,c.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.2);
    ns.start();
    const o=c.createOscillator(),g=c.createGain();
    o.connect(g);g.connect(c.destination);
    o.type='sawtooth';
    o.frequency.setValueAtTime(820*jit,c.currentTime);
    o.frequency.exponentialRampToValueAtTime(55,c.currentTime+0.19);
    g.gain.setValueAtTime(SND.vol*0.25,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.21);
    o.start();o.stop(c.currentTime+0.22);
  }); },
  layer(z)  { SND._p(c => {
    // Whoosh sweep — 80ms, clearly audible layer change
    const len=Math.floor(c.sampleRate*0.08);
    const buf=c.createBuffer(1,len,c.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<len;i++){const env=Math.sin((i/len)*Math.PI);d[i]=(Math.random()*2-1)*env;}
    const ns=c.createBufferSource(),ng=c.createGain(),nf=c.createBiquadFilter();
    nf.type='bandpass';nf.frequency.value=3000+z*400;nf.Q.value=0.8;
    ns.buffer=buf;ns.connect(nf);nf.connect(ng);ng.connect(c.destination);
    ng.gain.setValueAtTime(SND.vol*1.2,c.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.09);
    ns.start();
    // Pitched chirp — direction conveys up/down layer
    const o=c.createOscillator(),g=c.createGain();
    o.connect(g);g.connect(c.destination);
    o.type='sine';
    const fBase=600+z*180;
    o.frequency.setValueAtTime(fBase,c.currentTime);
    o.frequency.exponentialRampToValueAtTime(fBase*1.4,c.currentTime+0.05);
    g.gain.setValueAtTime(SND.vol*0.35,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.07);
    o.start();o.stop(c.currentTime+0.08);
  }); },
  check()   { SND._p(c => {
    [0,0.08,0.16].forEach((t,i)=>{
      const o=c.createOscillator(),g=c.createGain();
      o.connect(g);g.connect(c.destination);
      o.type='square';o.frequency.value=760+i*190;
      g.gain.setValueAtTime(0,c.currentTime+t);
      g.gain.linearRampToValueAtTime(SND.vol*0.15,c.currentTime+t+0.007);
      g.gain.setValueAtTime(SND.vol*0.15,c.currentTime+t+0.048);
      g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+t+0.072);
      o.start(c.currentTime+t);o.stop(c.currentTime+t+0.078);
    });
  }); },
  end(win)  { SND._p(c => {
    if(win){
      [523,659,784,1047].forEach((f,i)=>{
        const o=c.createOscillator(),g=c.createGain();
        o.connect(g);g.connect(c.destination);
        o.type='square';o.frequency.value=f;
        g.gain.setValueAtTime(0,c.currentTime+i*0.09);
        g.gain.linearRampToValueAtTime(SND.vol*0.1,c.currentTime+i*0.09+0.01);
        g.gain.setValueAtTime(SND.vol*0.1,c.currentTime+i*0.09+0.055);
        g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+i*0.09+0.5);
        o.start(c.currentTime+i*0.09);o.stop(c.currentTime+i*0.09+0.55);
      });
    } else {
      [330,247,185,110].forEach((f,i)=>{
        const o=c.createOscillator(),g=c.createGain();
        o.connect(g);g.connect(c.destination);
        o.type='sawtooth';o.frequency.value=f;
        g.gain.setValueAtTime(0,c.currentTime+i*0.14);
        g.gain.linearRampToValueAtTime(SND.vol*0.18,c.currentTime+i*0.14+0.012);
        g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+i*0.14+0.72);
        o.start(c.currentTime+i*0.14);o.stop(c.currentTime+i*0.14+0.76);
      });
    }
  }); }
};

/* ======================================================
   ── HAPTICS
====================================================== */
const HAP = {
  on: true, intensity: 'medium',
  _pat: {
    select:  { light:[8],           medium:[15],        strong:[25] },
    place:   { light:[12,8,8],      medium:[20,10,15],  strong:[40,10,20] },
    capture: { light:[20,5,20],     medium:[30,8,30],   strong:[60,10,40] },
    layer:   { light:[5],           medium:[8],         strong:[12] },
    check:   { light:[15,5,15,5,15],medium:[25,8,25,8,25],strong:[40,10,40,10,40] },
    ui:      { light:[4],           medium:[6],         strong:[10] }
  },
  vib(type) { if (!HAP.on || !navigator.vibrate) return; navigator.vibrate(HAP._pat[type]?.[HAP.intensity] || [10]); }
};

