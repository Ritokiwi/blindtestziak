# Ziak // Blind Test

Jeu de blind test statique en HTML, CSS et JavaScript vanilla.

## Ajouter votre catalogue

1. Placez vos extraits audio autorisés (MP3, idéalement 15 à 20 secondes) dans `assets/audio/`.
2. Ajoutez une entrée par morceau dans `songs.json` :

```json
[
  {
    "id": "identifiant-unique",
    "title": "Titre du morceau",
    "project": "Album ou mixtape",
    "year": 2024,
    "audio": "assets/audio/mon-extrait.mp3"
  }
]
```

Le jeu ne charge que les entrées qui possèdent au moins `title` et `audio`.

Vous pouvez aussi utiliser le lecteur officiel Deezer sans héberger de fichier audio :

```json
{
  "id": "identifiant-unique",
  "title": "Titre du morceau",
  "project": "Album ou mixtape",
  "year": 2024,
  "deezerTrackId": 123456789
}
```

L'identifiant correspond au nombre situé à la fin de l'URL Deezer d'une piste (`deezer.com/track/123456789`).

## Déployer sur Vercel

Importez ce dossier dans un dépôt Git, puis importez ce dépôt dans Vercel. Le projet est un site statique : aucun réglage de build n'est nécessaire. Vous pouvez aussi déposer le dossier directement avec la CLI Vercel après vous être connecté à votre compte.

> N'ajoutez que des extraits audio que vous êtes autorisé à distribuer ou utiliser.
