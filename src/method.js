// "How it works" page, one version per language.
export const METHOD = {
  it: `<h2>Come funziona (e dove è approssimativo)</h2>
    <h3>Motore</h3>
    <p>Stockfish 18 in versione "lite" WebAssembly, a un thread, eseguito nel browser. Ogni posizione è valutata alla profondità scelta con due varianti principali. È più debole e meno profondo dell'analisi dei grandi siti: alcune mosse cambieranno classificazione con una profondità maggiore.</p>
    <h3>Precisione</h3>
    <p>Ogni valutazione è convertita in probabilità di vittoria (formula pubblica di Lichess). La precisione di una mossa dipende da quanta probabilità di vittoria perdi rispetto alla mossa migliore; la precisione della partita combina media ponderata per la volatilità e media armonica, come fa Lichess. Le mosse di teoria contano 100.</p>
    <h3>Classificazione delle mosse</h3>
    <ul>
      <li><b>Teoria</b>: la posizione è nel database aperture (Lichess, CC0) e la partita non ne è ancora uscita.</li>
      <li><b>Migliore / Ottima / Buona</b>: perdita di probabilità di vittoria 0 / sotto 2 / sotto 5 punti.</li>
      <li><b>Imprecisione / Errore / Errore grave</b>: sotto 10 / sotto 20 / almeno 20 punti. Se dopo la mossa resti nettamente avanti (≥75% o ≥60%), la classe viene attenuata.</li>
      <li><b>Occasione persa</b>: l'avversario aveva appena sbagliato (o c'era un matto) e non hai approfittato.</li>
      <li><b>Grande</b>: l'unica mossa buona (la seconda scelta del motore perde almeno 15 punti), in una posizione non ancora decisa.</li>
      <li><b>Geniale</b>: mossa migliore o quasi che sacrifica almeno 2 punti di materiale (euristica di cattura a una mossa) senza peggiorare la posizione.</li>
    </ul>
    <h3>Elo stimato della partita</h3>
    <p>Se i tuoi PGN contengono i rating (WhiteElo/BlackElo), l'app si calibra da sola: prende la precisione e il rating reale di <i>entrambi</i> i giocatori di ogni partita analizzata e stima una retta rating = a + b·precisione (minimi quadrati, con la pendenza tirata verso un valore prudente finché i dati sono pochi). Servono almeno 6 rating. Senza rating usa una tabella fissa scelta a mano (70 ≈ 1200, 80 ≈ 1700, 90 ≈ 2350), che tende a sovrastimare.</p>
    <p>Anche calibrato, l'Elo di una singola partita resta molto rumoroso: l'app mostra l'errore tipico (±) calcolato sui tuoi dati, spesso 200–400 punti. Una partita contro un avversario che sbaglia molto ti fa sembrare più forte, e viceversa. Ha senso come media su molte partite.</p>
    <h3>Temi e rating per tema</h3>
    <p>Ogni tua mossa riceve dei temi: la fase (apertura, mediogioco, finale e tipo di finale), i motivi tattici presenti nella mossa migliore o in quella giocata (attacco doppio, inchiodatura, infilata, attacco di scoperta, sacrificio, attacco al re, guadagno di materiale, matto), e situazioni (difesa se eri sotto, conversione se eri avanti, mosse critiche con una sola mossa buona, zeitnot, pedoni passati avanzati, struttura pedonale per le mosse di pedone fuori dall'apertura). I motivi sono riconosciuti con euristiche geometriche a una mossa: sbagliano in qualche caso, soprattutto struttura pedonale e attacco al re.</p>
    <p>Il rating di un tema parte dal tuo rating di riferimento (mediana dei tuoi rating nei PGN, o in mancanza l'Elo stimato medio) e si sposta in base a quanto riesci nel tema rispetto alla tua media: R = base + 400·log10(quote nel tema / quote complessive). Le partite recenti pesano di più e i temi con pochi dati vengono tirati verso la media. Misura quindi i tuoi punti forti e deboli <i>relativi</i>, non una forza assoluta.</p>
    <h3>Esercizi</h3>
    <p>Ogni tuo errore, errore grave od occasione persa (perdita di almeno 10 punti) diventa un esercizio: la posizione prima della mossa, con la mossa del motore come soluzione. Se trovi un'altra mossa, il motore la verifica e la accetta se perde al massimo 3 punti. L'esercizio sparisce dopo N soluzioni corrette al primo tentativo.</p>
    <h3>Dati e licenze</h3>
    <h3>Dati e sincronizzazione</h3><p>I dati sono salvati nel browser (IndexedDB) e l'app funziona anche offline. Se hai effettuato l'accesso, ogni partita, esercizio e impostazione viene copiato nel tuo account (Supabase) e scaricato sugli altri dispositivi. In caso di conflitto vince la versione modificata più di recente su un dispositivo non ancora sincronizzato: se modifichi lo stesso esercizio su due dispositivi offline, una delle due modifiche va persa. L'analisi viene fatta una volta sola, sul dispositivo che importa la partita.</p><p> I nomi delle aperture vengono dal database di Lichess e restano in inglese. Stockfish è GPLv3; i pezzi sono il set "cburnett" (GPLv2+); il database aperture è di Lichess (CC0).</p>`,

  en: `<h2>How it works (and where it is approximate)</h2>
    <h3>Engine</h3>
    <p>Stockfish 18, "lite" single-threaded WebAssembly build, running in your browser. Each position is evaluated at the chosen depth with two principal variations. It is weaker and shallower than the analysis on the big sites: some moves will change class at a higher depth.</p>
    <h3>Accuracy</h3>
    <p>Each evaluation is converted into winning chances (Lichess' public formula). A move's accuracy depends on how many points of winning chances you lose compared with the best move; game accuracy combines a volatility-weighted mean and a harmonic mean, as Lichess does. Book moves count as 100.</p>
    <h3>Move classification</h3>
    <ul>
      <li><b>Book</b>: the position is in the opening database (Lichess, CC0) and the game has not left it yet.</li>
      <li><b>Best / Excellent / Good</b>: loss of winning chances 0 / under 2 / under 5 points.</li>
      <li><b>Inaccuracy / Mistake / Blunder</b>: under 10 / under 20 / at least 20 points. If you are still clearly ahead after the move (≥75% or ≥60%), the class is softened.</li>
      <li><b>Missed chance</b>: your opponent had just erred (or there was a mate) and you did not take advantage.</li>
      <li><b>Great</b>: the only good move (the engine's second choice loses at least 15 points) in a position that is not yet decided.</li>
      <li><b>Brilliant</b>: a best or near-best move that sacrifices at least 2 points of material (one-move capture heuristic) without worsening the position.</li>
    </ul>
    <h3>Estimated game Elo</h3>
    <p>If your PGN files contain ratings (WhiteElo/BlackElo), the app calibrates itself: it takes the accuracy and the real rating of <i>both</i> players in every analysed game and fits a line rating = a + b·accuracy (least squares, with the slope pulled towards a cautious value while data is scarce). At least 6 ratings are needed. Without ratings it uses a fixed hand-made table (70 ≈ 1200, 80 ≈ 1700, 90 ≈ 2350), which tends to overestimate.</p>
    <p>Even when calibrated, the Elo of a single game is very noisy: the app shows the typical error (±) computed from your data, often 200–400 points. A game against an opponent who makes many mistakes makes you look stronger, and vice versa. It is meaningful as an average over many games.</p>
    <h3>Themes and theme ratings</h3>
    <p>Each of your moves gets themes: the phase (opening, middlegame, endgame and endgame type), the tactical motifs in the best or the played move (fork, pin, skewer, discovered attack, sacrifice, king attack, winning material, mate), and situations (defence when you were worse, conversion when you were better, critical moves with only one good option, time trouble, advanced passed pawns, pawn structure for pawn moves after the opening). Motifs are detected with one-move geometric heuristics: they are sometimes wrong, especially pawn structure and king attack.</p>
    <p>A theme's rating starts from your reference rating (median of your PGN ratings, otherwise the average estimated Elo) and moves according to how well you do in that theme compared with your average: R = base + 400·log10(odds in theme / overall odds). Recent games weigh more and themes with little data are pulled towards the average. It measures your <i>relative</i> strengths and weaknesses, not an absolute strength.</p>
    <h3>Exercises</h3>
    <p>Each of your mistakes, blunders or missed chances (a loss of at least 10 points) becomes an exercise: the position before the move, with the engine's move as the solution. If you find another move, the engine checks it and accepts it if it loses at most 3 points. The exercise disappears after N correct first-try solutions.</p>
    <h3>Data and licences</h3>
    <h3>Data and sync</h3><p>Data is stored in your browser (IndexedDB) and the app also works offline. When you are signed in, every game, puzzle and setting is copied to your account (Supabase) and downloaded on your other devices. In a conflict, the unsynced local version wins: if you change the same puzzle on two offline devices, one of the two changes is lost. Analysis runs once, on the device that imports the game.</p><p> Opening names come from the Lichess database and are in English. Stockfish is GPLv3; pieces are the "cburnett" set (GPLv2+); the opening database is from Lichess (CC0).</p>`,

  fr: `<h2>Fonctionnement (et limites)</h2>
    <h3>Moteur</h3>
    <p>Stockfish 18 en version « lite » WebAssembly, sur un seul fil d'exécution, dans votre navigateur. Chaque position est évaluée à la profondeur choisie avec deux variantes principales. Il est plus faible et moins profond que l'analyse des grands sites : certains coups changeront de catégorie à plus grande profondeur.</p>
    <h3>Précision</h3>
    <p>Chaque évaluation est convertie en chances de gain (formule publique de Lichess). La précision d'un coup dépend des points de chances de gain perdus par rapport au meilleur coup ; la précision de la partie combine une moyenne pondérée par la volatilité et une moyenne harmonique, comme Lichess. Les coups de théorie comptent 100.</p>
    <h3>Classement des coups</h3>
    <ul>
      <li><b>Théorie</b> : la position figure dans la base d'ouvertures (Lichess, CC0) et la partie n'en est pas encore sortie.</li>
      <li><b>Meilleur / Excellent / Bon</b> : perte de chances de gain 0 / moins de 2 / moins de 5 points.</li>
      <li><b>Imprécision / Erreur / Gaffe</b> : moins de 10 / moins de 20 / au moins 20 points. Si vous restez nettement devant après le coup (≥75 % ou ≥60 %), la catégorie est atténuée.</li>
      <li><b>Occasion manquée</b> : l'adversaire venait de se tromper (ou il y avait un mat) et vous n'en avez pas profité.</li>
      <li><b>Très bon</b> : le seul bon coup (le deuxième choix du moteur perd au moins 15 points) dans une position encore indécise.</li>
      <li><b>Brillant</b> : un coup meilleur ou presque qui sacrifie au moins 2 points de matériel (heuristique de prise à un coup) sans dégrader la position.</li>
    </ul>
    <h3>Elo estimé de la partie</h3>
    <p>Si vos PGN contiennent les classements (WhiteElo/BlackElo), l'application se calibre seule : elle prend la précision et le classement réel des <i>deux</i> joueurs de chaque partie analysée et ajuste une droite classement = a + b·précision (moindres carrés, avec une pente ramenée vers une valeur prudente tant que les données sont rares). Il faut au moins 6 classements. Sans classements, elle utilise une table fixe choisie à la main (70 ≈ 1200, 80 ≈ 1700, 90 ≈ 2350), qui tend à surestimer.</p>
    <p>Même calibré, l'Elo d'une seule partie reste très bruité : l'application affiche l'erreur typique (±) calculée sur vos données, souvent 200 à 400 points. Une partie contre un adversaire qui se trompe beaucoup vous fait paraître plus fort, et inversement. Il a du sens en moyenne sur de nombreuses parties.</p>
    <h3>Thèmes et classement par thème</h3>
    <p>Chacun de vos coups reçoit des thèmes : la phase (ouverture, milieu de partie, finale et type de finale), les motifs tactiques présents dans le meilleur coup ou le coup joué (fourchette, clouage, enfilade, attaque à la découverte, sacrifice, attaque sur le roi, gain de matériel, mat), et des situations (défense si vous étiez moins bien, conversion si vous étiez mieux, coups critiques avec un seul bon coup, zeitnot, pions passés avancés, structure de pions pour les coups de pion après l'ouverture). Les motifs sont détectés par des heuristiques géométriques à un coup : elles se trompent parfois, surtout pour la structure de pions et l'attaque sur le roi.</p>
    <p>Le classement d'un thème part de votre classement de référence (médiane de vos classements PGN, sinon l'Elo estimé moyen) et varie selon votre réussite dans ce thème par rapport à votre moyenne : R = base + 400·log10(cote dans le thème / cote globale). Les parties récentes pèsent davantage et les thèmes avec peu de données sont ramenés vers la moyenne. Il mesure vos forces et faiblesses <i>relatives</i>, pas une force absolue.</p>
    <h3>Exercices</h3>
    <p>Chaque erreur, gaffe ou occasion manquée (perte d'au moins 10 points) devient un exercice : la position avant le coup, avec le coup du moteur comme solution. Si vous trouvez un autre coup, le moteur le vérifie et l'accepte s'il perd au plus 3 points. L'exercice disparaît après N solutions correctes du premier coup.</p>
    <h3>Données et licences</h3>
    <h3>Données et synchronisation</h3><p>Les données sont enregistrées dans le navigateur (IndexedDB) et l'application fonctionne aussi hors ligne. Une fois connecté, chaque partie, exercice et réglage est copié dans votre compte (Supabase) et téléchargé sur vos autres appareils. En cas de conflit, la version locale non synchronisée l'emporte : si vous modifiez le même exercice sur deux appareils hors ligne, l'une des deux modifications est perdue. L'analyse est faite une seule fois, sur l'appareil qui importe la partie.</p><p> Les noms d'ouvertures viennent de la base Lichess et restent en anglais. Stockfish est sous GPLv3 ; les pièces sont le jeu « cburnett » (GPLv2+) ; la base d'ouvertures vient de Lichess (CC0).</p>`,

  es: `<h2>Cómo funciona (y dónde es aproximado)</h2>
    <h3>Motor</h3>
    <p>Stockfish 18 en versión «lite» WebAssembly, de un solo hilo, ejecutado en el navegador. Cada posición se evalúa a la profundidad elegida con dos variantes principales. Es más débil y menos profundo que el análisis de los grandes sitios: algunas jugadas cambiarán de categoría con más profundidad.</p>
    <h3>Precisión</h3>
    <p>Cada evaluación se convierte en probabilidad de ganar (fórmula pública de Lichess). La precisión de una jugada depende de cuántos puntos de probabilidad de ganar pierdes frente a la mejor jugada; la precisión de la partida combina una media ponderada por la volatilidad y una media armónica, como hace Lichess. Las jugadas de teoría cuentan 100.</p>
    <h3>Clasificación de las jugadas</h3>
    <ul>
      <li><b>Teoría</b>: la posición está en la base de aperturas (Lichess, CC0) y la partida aún no ha salido de ella.</li>
      <li><b>Mejor / Excelente / Buena</b>: pérdida de probabilidad de ganar 0 / menos de 2 / menos de 5 puntos.</li>
      <li><b>Imprecisión / Error / Error grave</b>: menos de 10 / menos de 20 / al menos 20 puntos. Si tras la jugada sigues claramente por delante (≥75% o ≥60%), la categoría se suaviza.</li>
      <li><b>Ocasión perdida</b>: el rival acababa de equivocarse (o había un mate) y no lo aprovechaste.</li>
      <li><b>Muy buena</b>: la única jugada buena (la segunda opción del motor pierde al menos 15 puntos) en una posición aún no decidida.</li>
      <li><b>Genial</b>: una jugada mejor o casi que sacrifica al menos 2 puntos de material (heurística de captura a una jugada) sin empeorar la posición.</li>
    </ul>
    <h3>Elo estimado de la partida</h3>
    <p>Si tus PGN contienen ratings (WhiteElo/BlackElo), la app se calibra sola: toma la precisión y el rating real de <i>ambos</i> jugadores de cada partida analizada y ajusta una recta rating = a + b·precisión (mínimos cuadrados, con la pendiente llevada hacia un valor prudente mientras haya pocos datos). Hacen falta al menos 6 ratings. Sin ratings usa una tabla fija elegida a mano (70 ≈ 1200, 80 ≈ 1700, 90 ≈ 2350), que tiende a sobrestimar.</p>
    <p>Incluso calibrado, el Elo de una sola partida es muy ruidoso: la app muestra el error típico (±) calculado con tus datos, a menudo de 200 a 400 puntos. Una partida contra un rival que se equivoca mucho te hace parecer más fuerte, y al revés. Tiene sentido como media de muchas partidas.</p>
    <h3>Temas y rating por tema</h3>
    <p>Cada jugada tuya recibe temas: la fase (apertura, medio juego, final y tipo de final), los motivos tácticos de la mejor jugada o de la jugada hecha (ataque doble, clavada, enfilada, ataque a la descubierta, sacrificio, ataque al rey, ganancia de material, mate) y situaciones (defensa si estabas peor, conversión si estabas mejor, jugadas críticas con una sola buena opción, apuros de tiempo, peones pasados avanzados, estructura de peones en las jugadas de peón tras la apertura). Los motivos se detectan con heurísticas geométricas a una jugada: a veces fallan, sobre todo en estructura de peones y ataque al rey.</p>
    <p>El rating de un tema parte de tu rating de referencia (mediana de tus ratings en los PGN o, si no hay, el Elo estimado medio) y se mueve según lo bien que te va en ese tema frente a tu media: R = base + 400·log10(cuota en el tema / cuota global). Las partidas recientes pesan más y los temas con pocos datos se acercan a la media. Mide tus puntos fuertes y débiles <i>relativos</i>, no una fuerza absoluta.</p>
    <h3>Ejercicios</h3>
    <p>Cada error, error grave u ocasión perdida (pérdida de al menos 10 puntos) se convierte en un ejercicio: la posición antes de la jugada, con la jugada del motor como solución. Si encuentras otra jugada, el motor la comprueba y la acepta si pierde como mucho 3 puntos. El ejercicio desaparece tras N soluciones correctas al primer intento.</p>
    <h3>Datos y licencias</h3>
    <h3>Datos y sincronización</h3><p>Los datos se guardan en el navegador (IndexedDB) y la aplicación también funciona sin conexión. Con la sesión iniciada, cada partida, ejercicio y ajuste se copia en tu cuenta (Supabase) y se descarga en tus otros dispositivos. En caso de conflicto gana la versión local no sincronizada: si modificas el mismo ejercicio en dos dispositivos sin conexión, uno de los dos cambios se pierde. El análisis se hace una sola vez, en el dispositivo que importa la partida.</p><p> Los nombres de las aperturas vienen de la base de Lichess y están en inglés. Stockfish es GPLv3; las piezas son el juego «cburnett» (GPLv2+); la base de aperturas es de Lichess (CC0).</p>`,
};
