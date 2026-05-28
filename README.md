# Oasis Visit Card Premium

Reconstrucción completa.

## Incluye
- Firebase Auth con Google
- Firestore
- Storage
- Dashboard premium
- Clientes agrupados
- Equipos por área
- Diagnóstico guiado
- Próxima visita automática 6 meses editable
- Health Score
- Expediente por cliente
- PDF Premium compartible/descargable
- Configuración de negocio

## Subir a GitHub Pages
Sube al root:
- index.html
- styles.css
- app.js
- manifest.json

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

## Importante
Después de subir, abre con:
?premium=1

Ejemplo:
https://TUUSUARIO.github.io/oasis-visit-card/?premium=1
