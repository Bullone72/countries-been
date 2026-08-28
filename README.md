# 🌍 Countries Been 3D

App per segnare tutte le **nazioni** e **città** che visiti su un **mappamondo 3D**,
con statistiche (numero di nazioni visitate, percentuale sul totale mondiale delle 195
nazioni, città visitate) e salvataggio permanente dei dati.

## Come funziona

- **Tocca una nazione** sul globo → si seleziona (azzurra) e si apre il pannello con l'elenco
  delle sue città (con ricerca).
- **«Segna come visitata»** → la nazione diventa verde e si alza dal globo.
- Tocca le città nell'elenco o i puntini sul globo → diventano **dorate**.
- Le statistiche in alto si aggiornano in tempo reale.
- I dati restano salvati sul dispositivo (localStorage), anche dopo la chiusura.
- **⬇ / ⬆** = esporta/importa backup JSON dei dati (consigliato prima di cambiare telefono).

## Provarla sul PC

**Doppio clic su `avvia.bat`**: avvia il mini-server locale e apre il browser da solo
(serve Node.js installato). In alternativa, manualmente:

```
cd countries-been
python -m http.server 8080
```

poi apri `http://localhost:8080`.

> ⚠️ Non aprire `index.html` con doppio clic (file://): il browser blocca il caricamento
> dei dati e l'app mostra l'errore "serve internet". Va sempre aperta tramite
> `http://localhost:8080`.

> La prima apertura richiede internet: scarica mappa, elenco città (~5 MB) e librerie.
> Dopo vengono messe in cache e funziona anche offline.

## Installarla sul telefono (senza mai reinstallare)

L'app è una **PWA**: l'APK/icona è solo un "guscio", il contenuto vero viene caricato da internet
e si aggiorna da solo.

1. **Pubblica la cartella online gratis**, ad esempio:
   - [Netlify Drop](https://app.netlify.com/drop): trascina dentro la cartella `countries-been` → ottieni un indirizzo tipo `https://tuoapp.netlify.app`
   - oppure GitHub Pages.
2. **Installala**: apri l'indirizzo con Chrome sul telefono → menu ⋮ → *"Aggiungi a schermata Home"* → "Installa app".
   - *(Opzionale)* Se vuoi un vero **file APK**: vai su [PWABuilder.com](https://www.pwabuilder.com), incolla l'indirizzo del sito e scarica l'Android package (.apk). Installalo **una volta sola**.
3. **Aggiornamenti automatici**: ogni volta che pubblichi una versione nuova (sostituisci i file sul sito),
   l'app si aggiorna da sola al prossimo avvio — **nessuna reinstallazione**.
   Se non vedessi subito le novità, chiudi completamente l'app e riaprila.

> Nota per lo sviluppatore: quando modifichi i file dell'app, aumenta la costante
> `VERSIONE` in cima a `sw.js` (es. `v1.0.1`): così tutti i dispositivi scaricano subito la nuova versione.

⚠️ Prima di disinstallare l'app o cancellare i dati del browser, fai un backup con **⬇ Esporta**:
i dati sono salvati nel dispositivo e il backup è l'unico modo per recuperarli.

## Struttura

```
countries-been/
├── index.html            interfaccia
├── css/style.css         stili
├── js/app.js             logica (mappa, statistiche, salvataggio)
├── js/data.js            alias nomi nazioni + utilità
├── sw.js                 cache offline + aggiornamenti automatici
├── manifest.webmanifest  metadati PWA
└── icons/                icone app
```

Dati usati (open data):
- Confini nazioni: [world-atlas 50m](https://github.com/topojson/world-atlas)
- Città: [Natural Earth populated places](https://www.naturalearthdata.com/) (~7.000 città principali)
- Nomi/bandiere: [mledoze/countries](https://github.com/mledoze/countries)
