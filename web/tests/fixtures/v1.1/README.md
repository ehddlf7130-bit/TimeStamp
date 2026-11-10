# TimeStamp-v1.1 rendering references

These PNGs were produced by the user's saved `release/TimeStamp-v1.1/TimeStamp.exe`
using `--self-test`, rather than by the web renderer. They contain synthetic solid
backgrounds and the original v1.1 stamp. Browser checks compare the web output
against these images on every deployment, including all eight measured date/time
samples, three output sizes, and the calibrated shadow on white.

`source-sha256.json` records the 43 original release resources and settings. JSON
line endings are normalized to LF for Git checkouts; PNG bytes are hashed directly.
Keep the original logo, glyph images, metrics, and shadow settings unchanged unless
the user explicitly requests a design change.
