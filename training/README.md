# Atelier — apprendre ton style de retouche, en local

Ce dossier entraîne, **sur ton Mac et nulle part ailleurs**, un petit modèle qui
imite ta façon de retoucher une photo. À terme il donnera à Atelier :

1. une **LUT automatique par photo** (un fichier `.cube` qu'Atelier charge déjà
   comme un look) ;
2. puis des **réglages Develop prédits dans ton style** (exposition, tons,
   balance des blancs…).

Rien n'est envoyé nulle part : pas de service en ligne, pas de compte. Les
photos, le jeu FiveK et les modèles entraînés restent dans `training/data/` et
`training/runs/`, que git ignore.

> **État actuel : M2.** Installer, vérifier la machine, préparer les données,
> **entraîner** le modèle, le mesurer et exporter un `.cube` : tout se fait
> depuis le Terminal. Le tableau de bord (courbes, grilles d'images, boutons)
> arrive en M3 — voir [`PLAN.md`](PLAN.md).

---

## 1. Installer (une seule fois)

Ouvre le Terminal et tape :

```bash
# 1. uv, le gestionnaire Python (il installe aussi le bon Python tout seul)
curl -LsSf https://astral.sh/uv/install.sh | sh
# ferme puis rouvre le Terminal

# 2. tout le reste, depuis le dossier du dépôt
cd chemin/vers/atelier/training
make setup
```

`make setup` installe Python 3.12, PyTorch (qui utilise la puce graphique du
Mac, « MPS »), la lecture des RAW (rawpy) et MLX (optionnel). Compte quelques
minutes la première fois. Tout va dans `training/.venv/` ; pour tout effacer,
supprime ce dossier.

## 2. Premier lancement

```bash
make doctor     # la machine est-elle prête ? que manque-t-il ?
make synth      # fabrique un petit jeu de données artificiel
uv run atelier-train ingest --source synthetic   # le prépare comme un vrai
```

`make doctor` affiche une ligne par point vérifié :

- `✓` tout va bien ;
- `!` à regarder, mais rien n'est bloqué (par exemple « FiveK absent ») ;
- `✗` à corriger avant d'aller plus loin — la ligne `→` en dessous dit quoi faire ;
- `·` simple information.

Le jeu **synthétique** sert à tout essayer sans vraies photos : des images
fabriquées et des retouches **connues** (chaud, contraste, teal & orange,
délavé, plus lumineux). Leur LUT exacte est rangée à côté
(`data/synthetic/luts/*.cube`), ce qui permettra en M2 de vérifier que le
modèle retrouve la bonne réponse.

## 3. Où mettre FiveK

MIT-Adobe FiveK : 5 000 photos RAW, chacune retouchée par 5 experts (A à E).
**Licence recherche, non commerciale : ne jamais le committer ni le partager.**

Place le dossier téléchargé tel quel dans :

```
training/data/fivek/
```

Le lecteur est tolérant sur l'organisation, et `make doctor` dit ce qu'il a trouvé.
Ce qu'il suppose :

- une photo se reconnaît à son nom : `a0001…a5000` au début
  (`a0001-jmac_DSC1459.dng`, `a0001.jpg`, `a0001.tif`) ;
- les retouches d'un expert sont dans un dossier nommé `expertC`, `expert_c`,
  `Expert-C` ou simplement `C` (idem pour A, B, D, E) ;
- tout le reste (`raw_photos/`, `input/`…) est une photo **d'origine** ;
- si une photo a plusieurs fichiers d'origine (un DNG et un JPEG 480p), le
  premier type de `fivek_input_prefer` gagne (TIFF, puis PNG, JPEG, et le DNG
  en dernier).

**Attention :** dans le téléchargement officiel, les retouches des experts ne
sont pas des images mais des réglages dans le catalogue Lightroom
(`fivek.lrcat`). Il faut les **exporter** (en TIFF de préférence) dans
`training/data/fivek/expertC/`, ou utiliser une version déjà exportée du jeu.
`make doctor` le signale s'il trouve le catalogue sans export.

C'est l'expert **C** qui est utilisé par défaut (c'est l'usage dans les
publications) ; pour en changer : `--set ingest.fivek_expert=A`.

## 4. Tes paires

Tes données à toi : des **groupes**, chacun = **une photo d'origine + plusieurs
retouches** de cette photo. Un dossier par groupe, dans :

```
training/data/pairs/
  2024-07-sydney-0412/            un dossier par photo d'origine (nom libre)
    manifest.toml                 dit quel fichier est l'origine
    DSC01234.ARW                  l'origine (RAW, TIFF, JPEG ou PNG)
    DSC01234-chaud.jpg            une retouche
    edits/DSC01234-nb.jpg         les retouches peuvent être dans des sous-dossiers
  _de-cote/                       un dossier qui commence par _ est ignoré
```

Le fichier `manifest.toml` :

```toml
original = "DSC01234.ARW"
title = "Sydney, le port au crépuscule"   # facultatif

[[edits]]
file = "DSC01234-chaud.jpg"
label = "chaud"                            # facultatif

[[edits]]
file = "edits/DSC01234-nb.jpg"
```

Pas envie de l'écrire à la main ? Cette commande le devine (elle prend pour
origine le fichier qui contient « original » dans son nom, sinon le seul RAW,
sinon le nom le plus court dont les autres dérivent), puis **relis-le** :

```bash
uv run atelier-train init-group "data/pairs/2024-07-sydney-0412"
```

Puis vérifie tout :

```bash
make validate
```

Chaque problème est listé en clair : manifest absent, fichier introuvable,
fichier présent mais pas listé, retouche **recadrée ou tournée** (elle est
ignorée pour l'instant : aligner ces paires, c'est M5).

## 5. Les commandes

| Commande | Ce qu'elle fait |
| --- | --- |
| `make doctor` | vérifie la machine et les dossiers de données |
| `make synth` | fabrique le jeu synthétique |
| `make validate` | vérifie tes groupes de paires |
| `make ingest` | prépare les paires pour l'entraînement (redimensionnées, en cache) |
| `uv run atelier-train init-group <dossier>` | écrit un `manifest.toml` deviné |
| `make bench` | chronomètre un pas d'entraînement sur ce Mac et estime la durée d'un run |
| `make train` | entraîne le modèle sur les paires préparées |
| `make eval` | mesure le dernier run (PSNR, ΔE) et dessine les grilles origine \| retouche \| modèle |
| `make export` | écrit le look appris en `.cube` |
| `make test` | lance les tests |

`make ingest` lit les sources de `ingest.sources` (FiveK et tes paires par
défaut) ; `--source synthetic` pour le jeu artificiel, `--limit 50` pour un
essai rapide, `--force` pour tout refaire. Les paires sont préparées **en
parallèle** sur la moitié des cœurs du Mac (`--workers 8` pour forcer, `1` pour
désactiver ; `ingest.workers` dans la config). Le résultat va dans
`data/cache/` : pour chaque paire, l'origine et la retouche à la même taille
(512 px sur le grand côté par défaut, en 16 bits) et un aperçu côte à côte
(`preview.jpg`). Une paire déjà préparée n'est pas refaite : on peut
interrompre et relancer.

## 6. Entraîner, mesurer, exporter

Le modèle (Zeng et al. 2020) est petit : un réseau regarde une **miniature**
de la photo et choisit comment mélanger quelques LUT 3D apprises ; la LUT
obtenue s'applique à la photo entière, exactement comme un `.cube` dans
Atelier. Ce qu'il apprend sort donc en `.cube`, sans rien d'autre à installer
côté Atelier.

```bash
make bench                       # combien de temps prendra un run sur ce Mac ?
make train                       # entraîne sur ingest.sources (FiveK + tes paires)
uv run atelier-train train --source fivek --name fivek-c   # une source, un nom de run
uv run atelier-train train --resume runs/<dossier>          # reprend un run interrompu
uv run atelier-train train --init runs/<run FiveK> --source pairs --name moi   # affinage (M5)
make eval                        # le dernier run : PSNR, ΔE2000, grilles d'images
make export                      # runs/<dossier>/style.cube — le look moyen appris
uv run atelier-train export --image photo.jpg   # la LUT que le modèle prédit pour UNE photo
```

Chaque run est un dossier `runs/<date>-<nom>/` :

- `config.toml` — tous les réglages du run, figés ;
- `metrics.jsonl` — une ligne par époque : perte, PSNR et ΔE de validation ;
- `best.pt` et `last.pt` — les poids (le meilleur en validation, le dernier) ;
- `split.json` — quelles paires ont servi à apprendre, lesquelles à vérifier
  (**des groupes entiers** : deux retouches d'un même original ne sont jamais
  des deux côtés) ;
- `eval/<split>.json` et `eval/grids/*.jpg` — les mesures et les grilles,
  les pires ΔE en premier ;
- `style.cube` — le look moyen, à déposer dans Atelier (« Upload .cube », où
  un look créatif se pose à 40 % par défaut).

**Ce que mesurent les chiffres** : le PSNR (en dB, plus c'est haut mieux
c'est ; au-delà de 25 dB sur FiveK, le modèle est au niveau des publications)
et le ΔE2000, l'écart de couleur tel que l'œil le voit (≈ 1 : à peine
perceptible ; 2 à 3 : visible). Un ΔE moyen qui descend, c'est le modèle qui
se rapproche de tes retouches.

Pour interrompre un entraînement : `Ctrl-C` ; `--resume` repart de la
dernière époque sauvegardée.

## 7. Les réglages

Tous les paramètres sont dans `configs/default.toml`, commentés. Pour un essai :

```bash
cp configs/default.toml configs/mon-essai.toml   # garde seulement ce que tu changes
uv run atelier-train ingest --config configs/mon-essai.toml
uv run atelier-train ingest --set ingest.long_edge=768   # un seul réglage, ponctuellement
```

Les chemins peuvent pointer ailleurs, par exemple un disque externe :
`--set paths.fivek=/Volumes/Photos/fivek`.

## 8. Ce qui reste privé

`training/.gitignore` exclut `data/`, `runs/`, les checkpoints et `.venv/`.
FiveK, tes photos et tes modèles ne partent jamais dans git. La suite (M3 à M6),
c'est [`PLAN.md`](PLAN.md).
