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

> **État actuel : M3.** Installer, vérifier la machine, préparer les données,
> **entraîner** le modèle, le mesurer, exporter un `.cube`, et tout piloter
> depuis un **tableau de bord** local (`make serve`). La suite — l'import
> depuis Winnow, l'affinage sur tes paires, les réglages Develop — est dans
> [`PLAN.md`](PLAN.md).

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
Mac, « MPS »), la lecture des RAW (rawpy), l'export ONNX du second modèle et
MLX (optionnel). Compte quelques minutes la première fois. Tout va dans
`training/.venv/` ; pour tout effacer, supprime ce dossier. Pour réinstaller,
repasse toujours par `make setup` : un `uv sync` à la main avec un seul
`--extra` désinstalle les autres (PyTorch compris).

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

## 4 bis. Tes paires depuis Winnow

Winnow relie chaque export de ta Galerie à l'original dont il vient. Cette
commande lit ces liens et range les fichiers dans `data/pairs/`, un dossier
par original, avec le `manifest.toml` déjà prêt :

```bash
export WINNOW_HOST=https://ton-instance        # une fois pour toutes dans ton ~/.zshrc
uv run atelier-train winnow-import --dry-run   # liste ce qui serait rapatrié, n'écrit rien
uv run atelier-train winnow-import --slim      # rapatrie en gardant le disque léger (recommandé)
uv run atelier-train winnow-import             # rapatrie et GARDE les fichiers entiers
uv run atelier-train winnow-import --since 2026-01-01 --limit 50
```

**Place sur le disque.** Un original pèse 40 à 75 Mo (un DNG de drone, un
ARW), et tes ~1 900 paires dépassent largement 100 Go. Or l'entraînement ne
lit que le cache : des vignettes de 512 px, quelques Mo par paire. Avec
`--slim`, chaque dossier est rapatrié, **préparé** dans `data/cache/`, puis
ses fichiers sont **supprimés** avant le suivant — le disque ne porte qu'un
dossier à la fois. Il ne reste que le `manifest.toml` et le `winnow.json`
(qui note ce qui a été préparé). Les dossiers déjà rapatriés en entier sont
allégés au passage, sans rien retélécharger : c'est aussi la façon de
récupérer la place si un import sans `--slim` a déjà rempli le disque.
Ensuite `uv run atelier-train ingest --source pairs` les reprend tels quels.

Sans Winnow et sans rien redécoder, `uv run atelier-train slim-pairs` allège
les dossiers dont **toutes** les retouches sont déjà dans le cache
(`--dry-run` dit d'abord combien de Go il libère). Un dossier dont une retouche
manque au cache garde ses fichiers. **Ne supprime pas `data/pairs/` à la
main** : le prochain `ingest` complet des paires les retirerait toutes de
l'index, et l'affinage sur tes paires deviendrait impossible sans tout
retélécharger. Et garde `data/cache/` : après l'allègement, c'est lui seul qui
porte tes paires.

Le prix : une paire allégée ne peut pas être refaite à une autre taille
(`ingest.long_edge`) ni avec `--force` ; pour cela, supprime son dossier et
son cache, et relance `winnow-import --slim`, qui la retélécharge. Si son
cache disparaît, `ingest` le dit et la même commande la retélécharge.

**Identifiants** — trois façons, de la plus simple à la plus manuelle :
`--login <utilisateur>` (le mot de passe est demandé au clavier, le cookie
vit le temps de la commande), un jeton d'application de Winnow (créé dans ta
page de compte) dans `$WINNOW_TOKEN`, ou `--token-file <fichier>` — un fichier
**hors du dépôt** (`~/.config/atelier-training/winnow.token`, `chmod 600`).
Rien n'est jamais écrit sous `training/`.

Ce que la commande fait : **lecture seule** (des GET, plus le login), un
original dont Winnow ne connaît pas de retouche est ignoré, une vidéo aussi.
Une capture Sony listée par son `.HIF` est rapatriée par son `.ARW` compagnon
(le RAW apprend mieux). Chaque dossier garde un `winnow.json` (ids, empreintes)
pour qu'une relance ne refasse rien.

## 5. Les commandes

| Commande | Ce qu'elle fait |
| --- | --- |
| `make doctor` | vérifie la machine et les dossiers de données |
| `make synth` | fabrique le jeu synthétique |
| `make validate` | vérifie tes groupes de paires |
| `make ingest` | prépare les paires pour l'entraînement (redimensionnées, en cache) |
| `uv run atelier-train init-group <dossier>` | écrit un `manifest.toml` deviné |
| `uv run atelier-train slim-pairs` | allège hors ligne les paires déjà préparées (fichiers supprimés, cache gardé) |
| `uv run atelier-train winnow-import --slim` | rapatrie tes paires original → final depuis ton Winnow (lecture seule), préparées puis supprimées une à une |
| `make serve` | ouvre le tableau de bord dans le navigateur (boutons, courbes, grilles) |
| `make bench` | chronomètre un pas d'entraînement sur ce Mac et estime la durée d'un run |
| `make train` | entraîne le modèle sur les paires préparées |
| `make eval` | mesure le dernier run (PSNR, ΔE) et dessine les grilles origine \| retouche \| modèle |
| `make export` | écrit le look appris en `.cube` |
| `make records FILE=…` | déballe le fichier d'entraînement écrit par Atelier (Develop → Learning) |
| `make train-develop` / `make export-develop` | entraîne le prédicteur de curseurs Develop, l'exporte en ONNX |
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
make finetune INIT=runs/<run FiveK>   # affinage sur TES paires, depuis le run FiveK (configs/finetune.toml)
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

`eval` donne aussi le score de **« ne rien faire »** (l'original tel quel
contre ta retouche) : c'est la barre à battre, un modèle qui en reste proche
n'a rien appris. Et il liste les paires **qui ne se superposent pas** (une
retouche tournée, retournée ou recadrée ailleurs que ce qu'a trouvé
l'alignement), avec leur grille : une paire pareille n'apprend que du bruit.
`train` les laisse de côté tout seul (`train.skip_misaligned`, activé par
défaut) et les liste dans `split.json` sous `left_out` ; la validation les
garde, pour que deux runs restent comparables. Le seuil (0,5) est une
estimation, pas une mesure sur tes photos.

Pour savoir si le modèle est trop petit ou s'il apprend par cœur, compare
`eval --split train` à la validation (`eval` relit le `split.json` du run :
`--split train` = les paires vraiment apprises). Nettement meilleur en train :
il apprend par cœur (plus de paires, FiveK). À peu près pareil : soit il manque
de place, soit ta retouche ne se lit pas dans la photo seule. Sur tes paires,
un modèle 2,7 × plus gros (`--set model.basis=8 --set model.width=32`) n'a pas
fait mieux. Pour trancher, **le test du par cœur** : quelques paires
seulement, revues des centaines de fois.

```bash
uv run atelier-train train --source pairs --name parcoeur --epochs 300 \
  --set train.subset=50 --set train.eval_every=25
```

Chaque validation affiche aussi `seen ΔE00 … (ceiling …)` sur ces 50 paires.
S'il descend vers le plafond, le modèle sait dessiner tes retouches et c'est
la prédiction qui coince ; s'il reste vers 11, c'est le modèle qui limite.

C'est ce test qui a montré que le petit réseau qui choisit le look ne voyait,
à l'entraînement, qu'un morceau de 256 px de la photo, alors qu'on le juge sur
la photo entière. Depuis, il voit toujours la photo entière
(`train.whole_thumbnail`, activé par défaut) ; les runs d'avant ne se
comparent qu'entre eux.

Pour interrompre un entraînement : `Ctrl-C` ; `--resume` repart de la
dernière époque sauvegardée.

**L'affinage sur tes paires** (`make finetune INIT=runs/<run FiveK>`) repart
des poids FiveK avec un pas dix fois plus petit (`configs/finetune.toml`) et
garde un cinquième des **groupes** pour vérifier — jamais une retouche d'un
original dont une autre retouche a servi à apprendre. `freeze_luts = true`
dans ce fichier garde les looks appris sur FiveK et n'apprend que la façon
de les doser par photo : utile avec peu de paires. `make eval` liste ensuite
les groupes où le modèle est le plus loin de toi (tableau « worst groups »,
aussi dans le tableau de bord).

**Une retouche recadrée, tournée ou redressée** est retrouvée dans son
original par `ingest` (`align.py`, par corrélation de luminance ; un
redressement jusqu'à ±6°) et la paire est préparée sur les mêmes pixels. Une
retouche qui n'est pas une découpe de l'original (perspective corrigée,
contenu déplacé) est ignorée et dite. Une retouche **du même format** (un
recadrage qui garde le 3:2, un redressement recadré au 3:2) est cherchée elle
aussi dès que ses deux moitiés ne se superposent pas. Une préparation faite
avant cette vérification est mesurée au prochain `ingest`, et seules les
paires décalées sont refaites. `ingest.align = "always"` cherche dans toutes
les paires.

## 6 bis. Le second modèle : tes réglages Develop

Le premier modèle sort une LUT. Le second prédit **les onze curseurs de
Develop** (exposition, luminosité, contraste, hautes lumières, ombres,
blancs, noirs, température, teinte, saturation, vibrance) à partir de la
photo telle qu'elle sort du boîtier. Ses données, c'est Atelier qui les
produit : dans Develop, *Réglages → Learning → Training file* écrit un `.json`
avec, pour chaque photo, sa vignette telle que décodée, ses statistiques et
tes réglages. Un réglage écrit par un agent est laissé de côté (le modèle
apprend ton goût, pas celui d'une machine).

```bash
make records FILE=~/Downloads/atelier-training-pairs.json   # déballe le fichier dans data/records
make train-develop                                           # entraîne le prédicteur
uv run atelier-train eval-develop                            # erreur moyenne par curseur, contre « ne rien faire »
make export-develop                                          # runs/<run>/develop-net.onnx + develop-net.json
```

`eval-develop` donne l'erreur moyenne de chaque curseur dans son unité
(± stops pour l'exposition, ± points pour les autres) et la compare à celle
d'un modèle qui ne toucherait à rien : tant que la seconde n'est pas battue
nettement, il manque des paires. Les deux fichiers exportés, `develop-net.onnx`
et `develop-net.json`, se chargent **ensemble** dans Atelier : Develop →
⚙ → *Learning* → *Your model* → *Load…*. Ils restent sur cet appareil
(jamais sur un roll, jamais sur le site) et le verbe **My own** apparaît dans
la rangée Auto : un clic écrit les onze curseurs d'un coup, un second les
remet comme avant ; dans *Automatic*, l'étape *My own* le fait courir avec
Auto. Le moteur qui l'exécute (ONNX Runtime, 14 Mo) est servi par le site
lui-même et chargé au premier clic — rien ne sort.

## 7. Le tableau de bord

Pour piloter sans le Terminal :

```bash
make serve        # ouvre http://127.0.0.1:8765 dans ton navigateur
```

La page montre, de haut en bas : l'état de la machine (les mêmes lignes que
`doctor`), les **boutons** (Doctor, Synthetic set, Ingest, Bench, Train avec
sa source, son nom et ses époques, Eval, Export, Stop) dont la sortie défile
en direct dans le cadre noir ; les **runs** avec leurs chiffres (époques, PSNR
et ΔE2000 de validation, les `.cube` à télécharger) et, pour ceux que tu
coches — jusqu'à quatre —, trois **courbes** sur une seule échelle chacune
(perte, PSNR, ΔE2000 ; survole pour lire les valeurs) ; les **grilles** du
run sélectionné (`origine | ta retouche | modèle`, les pires ΔE en premier) ;
et un aperçu des paires préparées.

Chaque bouton lance exactement la commande du Terminal, dans un processus à
part : un entraînement qui plante ne ferme pas la page, et son journal est
gardé dans `runs/dashboard/`. Une seule action à la fois (un entraînement,
c'est toute la puce graphique). La page n'écoute que sur `127.0.0.1` : rien
ne sort du Mac. Elle suit le thème clair ou sombre du système.

## 8. Les réglages

Tous les paramètres sont dans `configs/default.toml`, commentés. Pour un essai :

```bash
cp configs/default.toml configs/mon-essai.toml   # garde seulement ce que tu changes
uv run atelier-train ingest --config configs/mon-essai.toml
uv run atelier-train ingest --set ingest.long_edge=768   # un seul réglage, ponctuellement
```

Les chemins peuvent pointer ailleurs, par exemple un disque externe :
`--set paths.fivek=/Volumes/Photos/fivek`.

## 9. Ce qui reste privé

`training/.gitignore` exclut `data/`, `runs/`, les checkpoints et `.venv/`.
FiveK, tes photos et tes modèles ne partent jamais dans git. La suite (M3 à M6),
c'est [`PLAN.md`](PLAN.md).
