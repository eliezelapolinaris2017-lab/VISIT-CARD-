# Oasis Visit Card

Proyecto listo para GitHub Pages con Firebase Auth, Firestore y Storage.

## Archivos
- index.html
- styles.css
- app.js
- manifest.json

## Firebase ya integrado
Proyecto:
oasis-visit-card

## Activar en Firebase
1. Authentication > Sign-in method > Google > Enable
2. Firestore Database > Create Database
3. Storage > Get Started
4. Authentication > Settings > Authorized domains
   - añade tu dominio GitHub Pages: tuusuario.github.io
   - añade tu dominio propio si aplica

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

## GitHub Pages
1. Sube los archivos al root del repositorio.
2. Settings > Pages.
3. Source: main.
4. Folder: /root.
5. Abre el enlace publicado.

## Prueba
1. Entrar con Google.
2. Configurar negocio.
3. Crear visita.
4. Subir fotos.
5. Guardar.
6. Generar PDF o QR.
