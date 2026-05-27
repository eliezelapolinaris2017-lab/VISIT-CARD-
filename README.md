# Oasis Visit Card

App web estática para GitHub Pages con Firebase Auth, Firestore, Storage, generación de PDF y QR.

## Archivos
- `index.html`
- `styles.css`
- `app.js`
- `firebase-config.example.js`

## Instalación
1. Crea un proyecto en Firebase.
2. Activa Authentication > Google.
3. Activa Firestore Database.
4. Activa Storage.
5. Copia `firebase-config.example.js` y renómbralo a `firebase-config.js`.
6. Pega tu configuración real de Firebase.
7. Sube todos los archivos a GitHub Pages.

## Reglas Firestore sugeridas
```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## Reglas Storage sugeridas
```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
