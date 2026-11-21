# Taccuino Scacchi

App web (installabile su telefono come PWA) per analizzare le proprie partite di scacchi,
misurare le abilità per tema e allenarsi sui propri errori. Tutto gira nel browser:
nessun server, nessun account, i dati restano in IndexedDB.

## Funzioni

- **Import incrementale**: file PGN, testo incollato, oppure download dalle API pubbliche
  di Lichess e Chess.com. Le partite duplicate vengono saltate; ogni partita nuova entra in
  una coda di analisi e, quando finisce, radar, statistiche ed esercizi si aggiornano.
- **Analisi partita**: Stockfish 18 (WASM lite, single-thread) con due varianti per posizione;
  classificazione delle mosse (geniale, grande, teoria, migliore, ottima, buona, imprecisione,
  errore, occasione persa, errore grave), precisione, Elo stimato, grafico della valutazione,
  mossa migliore con continuazione.
- **Radar delle abilità**: ~20 temi (fasi, tipi di finale, motivi tattici, difesa, conversione,
  mosse critiche, zeitnot, pedoni passati, struttura pedonale) con un rating per tema.
- **Statistiche**: aperture per colore con risultati e precisione, fasi, finali raggiunti,
  occasioni tattiche colte/mancate, conversione dei vantaggi, rimonte, zeitnot, cadenze,
  andamento nel tempo, elenco di mosse geniali e grandi.
- **Allenamento**: esercizi generati dai propri errori; si accettano anche mosse alternative
  verificate dal motore; un esercizio sparisce dopo N soluzioni corrette al primo tentativo
  (N configurabile).

La pagina **Metodo** dentro l'app spiega tutte le formule e dove sono approssimative.

## Sviluppo

```bash
npm install
npm run dev        # server di sviluppo
npm run build      # build statica in dist/
npm run preview    # serve dist/
npm test           # test di motivi tattici e pipeline di analisi (usa Stockfish in Node)
```

`dist/` è un sito statico: può essere pubblicato su qualsiasi hosting (GitHub Pages, Netlify,
Cloudflare Pages). Per installarla sul telefono serve HTTPS.

`scripts/build-openings.mjs` rigenera `src/openings.json` dai TSV di
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) in `data/`.

## Struttura

| File | Ruolo |
| --- | --- |
| `src/pgn.js` | split multi-partita, parsing, colore dell'utente, orologi, cadenza |
| `src/engine.js` | wrapper UCI di Stockfish in un Web Worker |
| `src/analysis.js` | probabilità di vittoria, precisione, classificazione, temi, esercizi |
| `src/motifs.js` | euristiche: attacco doppio, inchiodatura, infilata, scoperta, sacrificio, attacco al re, fasi |
| `src/stats.js` | rating per tema e statistiche aggregate |
| `src/queue.js` | import, coda di analisi, download da Lichess/Chess.com |
| `src/board.js`, `src/charts.js` | scacchiera SVG e grafici SVG |
| `src/main.js` | interfaccia e routing |

## Licenze

Stockfish è GPLv3, quindi l'app è distribuita come GPL-3.0-or-later. Pezzi: set "cburnett"
di Colin M.L. Burnett (GPLv2+). Database aperture: Lichess (CC0).
