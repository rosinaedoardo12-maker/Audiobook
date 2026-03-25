# Audiobook Studio

Audiobook Studio e una web app installabile che trasforma PDF testuali in audiolibri con voci naturali.

## Funziona su

- Windows
- macOS
- iPhone e iPad tramite Safari come web app installabile
- Android tramite browser/PWA

## Avvio locale

```powershell
npm install
npm start
```

Poi apri `http://localhost:3000`.

## Installazione come app

- iPhone: apri il sito in Safari, tocca `Condividi`, poi `Aggiungi alla schermata Home`
- Desktop Chromium: apri il sito e usa il pulsante `Installa app`

## Deploy

Il progetto e pronto per essere pubblicato su un server Node oppure tramite container Docker.

### Docker

```bash
docker build -t audiobook-studio .
docker run -p 3000:3000 audiobook-studio
```

### Node hosting

```bash
npm install
npm start
```

Servono soltanto:

- un hosting Node.js pubblico
- connessione internet per le voci Edge Neural gratuite

## Note

- La PWA installa l'interfaccia come app, ma la generazione audio richiede rete.
- Per pubblicare in App Store come app nativa iOS servirebbe un wrapper mobile separato e un account Apple Developer.

  test
  
