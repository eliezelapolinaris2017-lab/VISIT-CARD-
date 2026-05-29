# Oasis Visit Card Enterprise

Base reconstruida.

## Enfoque
- Clientes ocultos por defecto.
- Búsqueda para abrir expedientes.
- Dashboard interno con agenda y observaciones.
- Diagnóstico técnico separado.
- PDF plano, blanco, elegante y corporativo.

## Subir a GitHub
Sube al root:
- index.html
- styles.css
- app.js
- manifest.json

Abre con:
?enterprise=1

## Reglas Firestore
```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
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
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
