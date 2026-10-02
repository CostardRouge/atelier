# Deduce against twenty UI/UX laws

*2026-10-02. The maintainer's report on the Deduce window built in #214 — «
l'interface est très encombrée … beaucoup de texte partout » — and the list of
twenty principles he shared as the measure. This file maps each one to the
window, says what it changed and what already held. The pass it describes is
built; the window's design record stays in `docs/memory/roadtrip.md`.*

## The list as given

Read from his screenshot, in its order. Two lines are not what they seem:
**14** is cut off on the right and reads *Uniform connectedness* (the Gestalt
law the list's others come from); **16 and 17 are both «Postel's law»**, a
duplicate — the common lists of these laws carry the *Goal-gradient effect* or
the *Aesthetic-usability effect* at that place, and 17 is read here as the
goal-gradient one, the one a multi-step window can act on. Say so if another
was meant.

## What the window was

Before the pass, on a 1280 × 900 screen, ten things stood between the title
and the first stage: a subtitle per tab, three tabs with key letters, a draft
pill with its own Clear (drawn even with no draft), a strip of three facts
about the read (days, flaws, source and age), the count with a sentence, the
slider and its four labels, the frieze, a row of three bulk verbs, two
hand-offs, and a line of keyboard hints. Every card said its verb twice (an uppercase pill and a select), carried
four controls, and the map had a standing sentence for its legend. On a 390 px
phone, no stage was on the first screen at all.

## Law by law

| # | Law | What it asks | In Deduce |
| --- | --- | --- | --- |
| 1 | Hick's law | Fewer visible choices, faster decisions | The three bulk verbs became one **All…** menu; the two top hand-offs went (the cards, the tabs and the keys carry them); a card shows one verb control instead of a pill and a select. |
| 2 | Fitts's law | Big targets, near the hand | The verb select is 36 px tall on a phone; *One by one* moves through chapters with arrows beside its counter instead of a Back button at the foot. |
| 3 | Jakob's law | Use the words and shapes people already know | The tabs said *Le grain · Le calque · Le paquet* — the lab's names, in French, in an English interface — while the hand-offs already said *One by one* and *Against my stages*. The tabs now say **All stages · Against mine · One by one**, the hand-offs the same words. |
| 4 | Law of proximity | What belongs together sits together | What was read from the instance is one chip in the tabs' row, opening the Data pane where its detail lives; the draft sits beside it. |
| 5 | Miller's law | About seven chunks at once | The head is the title and one row (tabs · ⓘ · read · draft, wrapping on a phone) instead of four rows; seven things now precede the first stage instead of ten, and the draft chip appears only once there is a draft. |
| 6 | Doherty threshold | Answer under 400 ms | Already held: one request per opening, every slider move recomputed from the days in hand. Nothing changed. |
| 7 | Von Restorff effect | What must be noticed is the one thing that differs | The frieze's histogram is neutral now, so the proposals' colours and an ignored day stand out; the verb select wears the warn tone only for a stage that would sit over one of yours. |
| 8 | Minimize target distance | Put the control where the eye already is | The verb sits on the card's first line, beside its name; the chapter arrows sit on the counter they move. |
| 9 | Serial position effect | First and last are remembered | The title opens, the counts and **Review N** close; the key hints left the middle for an ⓘ. |
| 10 | Peak-end rule | The end of a task is how it is remembered | *Written* opens on one line — ✓ 4 stages added — with Undo beside Close; the paragraph after it became one sentence. |
| 11 | Zeigarnik effect | Unfinished work is remembered | The draft chip counts the changes not yet written; *One by one*'s counter says how many chapters are answered. |
| 12 | Law of Prägnanz | The simplest reading wins | The frieze is lighter; an empty section of Review is not drawn (“Stages of yours, completed 0 · None.” said nothing). |
| 13 | Law of similarity | Alike looks the same, different looks different | One verb, one look: the select carries the pill's colours instead of sitting beside it; the hand-offs and the tabs share their words. |
| 14 | Uniform connectedness | Visually linked things read as one | Already held: a card's colour bar, its bar on the frieze and its route on the map share one tint, and hovering one lights the others. |
| 15 | Tesler's law | The system absorbs the complexity | Already held: a safe verb is chosen for every chapter and nothing needs answering before Review; the thresholds stay under *Fine settings*, whose summary is now one word (*changed*) instead of six values. |
| 16 | Postel's law | Accept loosely, give back strictly | Already held: a day without a position, an outlier, a halt nobody can name are read and said, never refused; Write gives back only what Review listed. |
| 17 | *(read as the Goal-gradient effect)* | Progress shown speeds the finish | *One by one* shows *3 / 6 · 1 answered*; the foot shows what Review will write at every moment. |
| 18 | Parkinson's law | A task swells to the time it is given | The shortest path is visible from the first screen: open, glance, **Review N**, Write — two clicks with the safe verbs. |
| 19 | Occam's razor | Remove what is not needed | Gone: the per-tab subtitle (now the tab's tooltip), the key-hint line (now behind ⓘ), the map's legend sentence (now its tooltip), the source and read time in the window (in the Data pane), *Against mine*'s five-item legend (three), its three intent hints (one, for the chosen intent), *One by one*'s closing paragraph, the explanatory callouts of Review, Written and Data, and *Written* saying its result three times (a heading and the foot sentence repeated the ✓ line). |
| 20 | Pareto principle | The few paths most people take | *All stages* is the first tab and the slider its first control; the rarer verbs live in menus and in the other two windows. |

## Left as is, deliberately

- The three windows themselves: his call of 2026-10-02 («je les veux toutes»).
- The map on a phone still sits above the cards, sticky; it is half the first
  screen, and making it a toggle is a design question for him.
- Hover-only hand-offs show at all times on a touch screen, where there is no
  hover to reveal them.
