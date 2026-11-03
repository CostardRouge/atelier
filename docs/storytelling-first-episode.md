# EP.00 for real — the first episode on your Mac

Phase 2 of the Storytelling strategy (2026-11-02): everything below was built and driven headless,
on a sample script and colour tiles. This is the one evening that turns « built » into « works » —
your trip, your Winnow, your voice, an export, a look on your phone. Each step says what to check
and what to send back when something is wrong; the fixes are the agent's.

Allow about an hour. Steps 1–2 are once; 3–10 are the episode.

## Before you start (once)

1. **Winnow knows the new kind.** Merge CostardRouge/winnow#345 and let Watchtower pull it: your
   instance then keeps Storytelling scripts (`story`) and mosaics. Without it, step 3's *Keep on…*
   is not offered — everything else still works.
2. **Winnow lets Atelier in.** On the Optiplex, `CORS_ALLOWED_ORIGINS` must list the exact address
   you open Atelier from: `http://localhost:5173` for `npm run dev` on the Mac, and/or
   `https://atelier.steeve.website` for the published site. Then mint an **editor** app token
   (Winnow › Users › App tokens) and connect it under Atelier's `#/sources`. *Getting started* ›
   *Check the connection* says in one line whether the instance answers.

## The episode

3. **The script.** `#/storytelling` → *Load script…* (your `.story.json`) — or *Series kept on
   <Winnow>…* if another browser already kept it. Then Script › *Keep on <Winnow>*. From now on
   the line under *Kept on* should read « saved to … · just now » a few seconds after each edit.
   *Versions on this device* fills as you work.
4. **The trip.** Trips (`#/roadtrip`) → open the trip from Winnow or import its `.roadtrip.json`.
   Back in Storytelling: Sources › the trip, untick the stages the series leaves out (Bali).
   **Check**: the map of EP.00 starts in Sydney and follows the road, not straight lines.
5. **Count.** Sources › the Winnow → *Count*. **Check**: the numbers in the captions are yours
   (not `{media.total}`), the wall shows your thumbnails within a minute. Wall rules if the
   pictures are not the ones you want.
6. **The sound.** Sound & effects → your voice (start at 0.5 s), a music bed (level ~25 %).
   Play the post with Space: the voice follows the playhead when you scrub.
7. **Before you export.** Export & archive → *Published on* = where it goes first (Reels or
   TikTok). Fix every line marked red (it would show in the file); look at the grey ones. Each
   line's link takes you to the thing to move.
8. **Export.** *Export video*. **Check** the line under *Measured on this device*: it should say
   `H.264 High + AAC` on the Mac's Chrome or Safari (Opus means AAC was refused — tell the agent),
   and how many × real time it ran. Press *Copy* and paste the lines to the agent.
9. **On your phone.** AirDrop the MP4. Play it with sound, then load it as a Reels/TikTok draft:
   do the captions and the badge clear the app's buttons? Is the voice above the music? Note the
   second where anything looks wrong.
10. **The other device.** On the phone, open Atelier (`atelier.steeve.website`), connect the same
    Winnow, *Getting started* → *Series kept on…* → *Open*. Change one word; back on the Mac,
    switch tabs away and back: the word should arrive. Change one on each before either saves to
    see the conflict: *Keep mine* or *Take theirs*, nothing lost (the other stays a version).

## What to send back

- the *Measured on this device* lines (Copy), from the Mac and from the phone if you exported there;
- for anything wrong: the post, the second, a screenshot — and the *Before you export* lines if
  they did not warn about it (that is a gap in the check, worth fixing first);
- whether the mix's balance is right (the one thing no headless run can hear).

`story.exports` gives the same lines to an agent driving the page (`window.atelier`).
