/** Every NHL 95 Instruments row (sound-test-view.js instRun) plays: the audition song on its load list drives the YM2612 or the PSG. */
const fs=require('fs'),path=require('path');const R=p=>require(path.resolve(p));
const Stream=R('lib/audio/nhl9x-stream'),AUD=R('lib/audio/nhl9x-gm-audition'),Chain=R('lib/audio/nhl92-sound-chain'),driver=R('lib/audio/nhl95-68k-harness');
const slice=fs.readFileSync('data/fixtures/nhl95-sound-slice.bin');const rom=new Uint8Array(0x7a000);rom.set(slice,0xaf44);
const map=JSON.parse(fs.readFileSync('data/audio/nhl95-gm-map.json'));
const run=(c)=>{let ym=0,psg=0,dac=0;const ch=Chain.create({rom:c.rom,driver,keepLogs:false,driverOpts:c.driverOpts,onYmWrite:(t,p,v)=>{ym++},onPsgWrite:()=>psg++});ch.step(null);ch.step([{song:c.id}]);for(let f=2;f<300;f++)ch.step(null);return [ym,psg]};
const base=run(Stream.romWithSong(95,rom,Stream.emptySong(95,1)));const base0=run(Stream.romWithSong(95,rom,Stream.emptySong(95,0)));
const assert=require("assert");
for(const e of map.patches){const p=e.patch;const song=AUD.patchSong(95,p,AUD.notesOf(AUD.plan(map,'n2g',p).picked));
song.loadList=e.loadLists.indexOf(1)<0&&e.loadLists.indexOf(0)>=0?0:1;const r=run(Stream.romWithSong(95,rom,song));assert.ok(r[0]>(song.loadList?base:base0)[0]+40||r[1]>(song.loadList?base:base0)[1]+10,"patch "+p+" "+e.kind+" plays: "+r);}
console.log("nhl95-instruments: all "+map.patches.length+" patch auditions play on the retail driver OK");
