# Drawproof pitch deck

- `Drawproof-Pitch.pptx`: the six-slide deck ([storyline](../08-pitch-storyline.md)). Light theme, Aptos, same palette as `apps/web`.
- `Drawproof-Pitch.pdf`: backup export (rendered by PowerPoint).
- `build-deck.cjs`: generator. Edit copy and layout here, then rebuild, so the deck stays reproducible.

```bash
mkdir -p /tmp/deck-tools && (cd /tmp/deck-tools && npm i pptxgenjs sharp react react-dom react-icons)
DECK_DEPS=/private/tmp/deck-tools node docs/pitch/build-deck.cjs
```

Slide 5 has a `VIDEO_PLACEHOLDER` frame: insert the recorded MP4 (Insert › Video › This Device) at that size after the final build.
Speaker notes on every slide carry the narration, timing and sources.
