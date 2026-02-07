# Piano WebAudio (PHP one-page) + Sound Library + Layer Mixing + 16 Drum Pads

## Contenuto
- `index.php` — pagina unica con piano C2→C6 (diesis + bemolli), layer mixing (somma suoni), drum pad 16
- `api/list_sounds.php` — endpoint PHP che scansiona `./sounds/` e restituisce JSON con cartelle e file WAV
- `sounds/` — libreria di esempio (WAV generati) con:
  - `sine/` (sine reference)
  - `bass/` (rawbass)
  - `guitar/` (pluck)
  - `drums/` (kick/snare/hihat/tom/perc ...)

## Come usare
1. Carica l'intera cartella su un hosting PHP (o localhost con PHP).
2. Apri `index.php`.
3. Premi **Attiva Audio**.
4. Suona la tastiera (scroll orizzontale nel box) e/o i Drum Pads.
5. Se aggiungi WAV personali: mettili in `sounds/<nomecartella>/`.
   - I drums devono stare in `sounds/drums/<categoria>/file.wav` (categorie libere).

## Note tecniche
- I layer vengono sommati nel dominio audio (più BufferSource -> Gain -> Master).
- Pitching via `playbackRate` (no time-stretch).
- Cache dei buffer in memoria (decode una volta).

