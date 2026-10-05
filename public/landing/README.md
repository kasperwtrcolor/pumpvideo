# Landing videos

Drop the videos for the desktop landing's 3D phone here. Nothing else needed —
the landing finds them at runtime, no code change.

Two ways, pick one:

**1. Just number them** (simplest). Name the files `1.mp4` … `6.mp4`. Up to six.
Each one is probed before use, so a gap or a missing file is skipped rather
than shown as a broken frame.

**2. A manifest.** Add `manifest.json` alongside the videos:

```json
["launch.mp4", "reaction.mp4", "the-dog.mp4"]
```

or

```json
{ "videos": ["launch.mp4", "reaction.mp4"] }
```

Values may be bare filenames (resolved against `/landing/`) or full URLs.

## Notes

- **Format:** H.264 MP4 plays everywhere. Keep them **vertical (9:16)** — they
  are displayed inside a phone-shaped screen, so landscape video gets cropped.
- **Size:** these load on the hero, i.e. the first thing every visitor sees.
  Aim for **under ~3 MB each**; the screen is ~300px wide so a 1080×1920 source
  is already more than enough.
- **Audio:** ignored. The phone plays muted.
- If this folder is empty the landing falls back to the app's own most recent
  uploaded clips, which is why it works with nothing here.
