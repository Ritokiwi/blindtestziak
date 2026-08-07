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

Le dépôt officiel est disponible sur [GitHub](https://github.com/Ritokiwi/blindtestziak) et est relié à Vercel. Chaque push sur `main` déclenche automatiquement un nouveau déploiement sur [blindtestziak.vercel.app](https://blindtestziak.vercel.app). Le projet est un site statique : aucun réglage de build n'est nécessaire.

> N'ajoutez que des extraits audio que vous êtes autorisé à distribuer ou utiliser.
