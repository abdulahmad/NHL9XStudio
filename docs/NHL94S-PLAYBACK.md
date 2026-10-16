# NHL '94 (SNES) playback

`lib/audio/nhl94s-player.js` plays the extracted songs the way the game does: the main CPU's sequencer (ported from the NHL94SNES disassembly) sends commands through the four ports to the game's own SPC700 program, which runs on the sound unit from `snes-spc.js` and makes the sound through `snes-dsp.js`.

```js
const player = NhlNhl94sPlayer.create({ data: NhlNhl94sSoundData.load(pack) }); // { region: 'pal', mono: true } also
player.boot();                  // boot ROM upload of the 1,097-byte sound program at $0400
player.loadSet('game');         // SPCGameUpload: command $01, SoundInit, then command $03 for each sample
player.startSong('SongBrassBonanza');
player.record(); player.runFrames(1800); const pcm = player.stopRecording(); // 32 kHz stereo Int16
```

`node test/nhl94s-player.js` runs the checks (about 2 s).

## What is ported (labels are the disassembly's)

| Part | Routines |
| --- | --- |
| Per frame | `SoundUpdate`: `UpdateSfxVoices`, then `SequencerTick` |
| Tempo | `MusicStart` (tempo divides 10080 NTSC / 8160 PAL), `SequencerTick` (8-bit counter, +$40 a frame) |
| Tracks | `StepTrack`, `ReadTrackEvent`, `ReadVarLen`: notes, `$D9/$DA` stop, `$DB` loop, `$DC` instrument, `$DD` tempo, `$DE` volume, `$DF` controllers, `$E2` mark, `$E5` bend, `$E3/$E7/$EA` skipped |
| Voices | `StartSoundVoice`, `FindFreeVoice` (round robin, then steal), `ReleaseVoice`, `StopVoice`, `UpdateVoice(s)`, vibrato in `UpdateSfxVoices` |
| Commands | `SeqCmd07`, `SeqCmd08(Init)`, `SeqCmd0B`, `SeqCmd0C`, `SPCCmd01/03/0D/0E`, with the original handshakes |
| Volume maths | `MulFrac8` / `MulFrac16` (the hardware multiplier's result) |

Controllers handled: 7 (volume), `$0B/$0C` (left/right), `$32-$35` (echo voices, delay, volume, feedback), `$37` (master), `$39` (noise), `$40` (sustain). Others do nothing, as in the game.

## What is not ported

`MusicDuck`, the volume fade, the replay recording (`recsfx*`), the puck and collision effect routing (`PuckSfx`, `CollisionSfx`: which effect the game plays for which event, and their random pitch), and the Mode 7 software multiplier (taken only when `Mode7InUse` bit 6 is set; it computes the same product).

## Sound effects

`player.playSound(n)` is `QueueSound` + `PlaySoundEntry`: sound entry `n` of the loaded set starts on the effect track (`$10`) with velocity `SfxVelocity+1` (default `$70`), its note (`+5`), length (`+6`), bend range and volumes; a sound already playing is not restarted. Effect voices are released by `UpdateVoice` when their length ends, like note voices. `stopSound(n)` is `PlaySound.stop`.

Game-set entries 11 and 12 (`$DF80`, `$DFB0`) start only with a positive length, so `playEntry` gives them 30 ticks; entry 20 (`$E130`) is always 45 ticks. Entries 22-27 are the six streamed effects: `streamSfx(1..6)` is `StreamSfx`, and each frame `UpdateStreamSfx` frees sample RAM (`SPCCmd02`/`SPCCmd04`), sends the sample in blocks (`SPCStreamStart`/`SPCStreamNext`, commands `$0F`/`$10`) and plays it once the first block is in. `playEntry(n)` picks the right call for the sound test. `idle()` says when nothing is sounding.

## What the port settled

- **The pitch-offset word (+2 of a sound entry)** is added to the note's pitch for `VoicePitch`, which `UpdateSfxVoices` sends every frame from the frame after the key-on. The key-on itself sends the pitch without it (`SeqCmd07` sends `NotePitch`, `$5A`), so the offset takes effect one frame later.
- **Drum track (9)**: each note looks up sound `note - $2F` and plays it at fixed pitch `$3F` plus the entry's note offset, as in `StepTrack`.
- **Note bit 7**: the whole byte is added to the entry's note offset (8 bit), and the pitch table is indexed with the result `& $7F`.
- **`$E5` bend**: the two operands make `(((b2 << 8) | ((b1 << 1) & $FF)) - $4000) * 2 >> 8` (signed byte). It re-pitches the track's voices from their base note, but adds the pitch offset of whatever `InstPtr` was left pointing at, as the original does.
- **`$E3`, `$E7`, `$EA`**: no effect on playback (`$EA` stores a value nothing reads).
- **Loop point**: `$E2` stores the track pointer as of the last non-zero wait, so a mark that follows zero-delay events loops back to the start of that chain. `nhl94s-sound-data.js` `walk()` loops to the mark's own record; the two agree on the songs checked, but the player is the reference.

## Checked

- The number of key-ons and their video frames equal the notes of the independent reading in `nhl94s-sound-data.js` for SongBrassBonanza (114), TitleSong (426, with voice stealing) and SongBirthday (146).
- The output is deterministic and audible.

## Not checked

Accuracy by ear (no retail or emulator capture is used). The DSP is the simplified model in `SNES-SOUND-CORE.md`. The echo FIR and the other driver defaults come from the sound program; nothing here sets them.
