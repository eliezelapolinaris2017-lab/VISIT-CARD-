# Oasis Visit Card — Fix PDF + QR

Versión corregida:
- PDF abre una ventana imprimible premium.
- En esa ventana presiona "Guardar / Imprimir PDF".
- QR abre una ventana con código QR imprimible.
- WhatsApp sigue funcionando.
- Firebase Auth, Firestore y Storage se mantienen igual.

## Subida a GitHub
Reemplaza en tu repositorio:
- index.html
- styles.css
- app.js
- manifest.json

Sube al root, no dentro de carpeta.

## Reglas Firestore
```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write:
      if request.auth != null
      && request.auth.uid == userId;
    }
  }
}
```

## Reglas Storage
```js
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write:
      if request.auth != null
      && request.auth.uid == userId;
    }
  }
}
```
