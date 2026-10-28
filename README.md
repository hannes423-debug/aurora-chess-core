# aurora-chess-core
True volumetric chess stripped down version

A minimal presentation of **Aurora Chess**: the original 4-layer (8×8×4) 3D chess game with the decoration removed, so the board fills the screen. It is meant to run on a normal screen today and to be tried on projectors and hologram-style displays later.

The game itself is unchanged: same board, rules, pieces, bot, local and online play, puzzles and replays. Only the presentation around it was cut down.

## Running it

**Online:** https://hannes423-debug.github.io/aurora-chess-core/ (GitHub Pages, served from the repository root; `.nojekyll` is included).

**Locally:**

It is a static web app with no build step and no dependencies. Serve the folder over HTTP and open `index.html`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Opening `index.html` straight from disk (`file://`) mostly works, but the browser refuses to `fetch` some assets that way (e.g. `chess-banner.glb`), so use a local server.

Any static host works as well, e.g. GitHub Pages. The service worker only registers over `https:`.

## Playing

The start screen has two buttons, **vs Computer** and **2 Players**. Below them you choose the bot strength (Easy / Medium / Hard / Max) and your colour. **More…** opens the original full menu: the step-by-step Play flow (Arcade and Capture-the-Flag modes, online play, time controls), Puzzles, game review, settings, profile and help.

During a game the screen shows only the board: no buttons and no text.

* **Menu:** tap or click the top centre of the screen (where the turn indicator used to be), or press **Esc**. The pause menu has Resume, Restart, a row of view controls (camera mode, flip 180°, fullscreen, background), Offer Draw, Resign, Settings and Exit. The start screen only appears when no game is running.
* **Changing layer:** swipe up/down on the board (touch), or use Q / E, 1–4 or Shift+scroll (keyboard and mouse).
* Hint and undo are not available in this version.

### Keyboard

| Key | Action |
| --- | --- |
| Click / tap | select and move pieces (unchanged) |
| Q / E, 1–4 | change layer |
| Tab (hold) | show all layers |
| V | cycle camera mode (Tilt / Free / Flat / Slice) |
| R / F | flip the board 180° |
| + / − , scroll | zoom |
| M | move list |
| Space | deselect |
| Esc | pause menu (or deselect a selected piece) |
| **P** | fullscreen on/off *(new)* |
| **B** | cycle background *(new)* |

Mouse, touch and gamepad input work as in the original.

## Display configuration

### Background

The default background is a plain dark colour. Press **B** or the background button to cycle through the presets. You can also set one in the URL:

| `?bg=` | Result |
| --- | --- |
| `midnight` (default) | solid dark indigo, close to the original colour scheme |
| `black` | pure black. Best for projectors and Pepper's-ghost / reflective "hologram" setups, where black reads as empty space |
| `gradient` | soft dark radial gradient |
| `transparent` | clears the page background |
| `%23RRGGBB` | any solid colour, e.g. `?bg=%23101820` (`%23` is `#`) |

The choice is remembered per browser.

**About `transparent`:** the 3D canvas is already rendered with alpha, and this option also clears the page behind it. Whether anything actually shows through depends on the host, not on the page. A normal browser tab still draws an opaque window. You need a host that composites transparency: a transparent app window (e.g. an Electron `BrowserWindow` with `transparent: true`), a streaming/capture tool's browser source, or similar. The OS, window manager and display hardware also have to support it.

### Fullscreen and resolution

* Use **P**, the fullscreen button, or the browser's own fullscreen (F11).
* The renderer scales to any window size.
* In the Tilt and Free camera modes, the camera backs off just far enough to keep all four layers in view, whatever the aspect ratio (4:3, 16:9, 21:9, portrait, 4K). It keeps the original viewing angle and re-frames when the window is resized.
* For a bare board on a projector, use: fullscreen (**P**) and the `black` background (**B**).

## What changed from Aurora Chess

**Removed (decoration only, no game logic):**

* the animated aurora-wave background (menu and in-game canvases) and its falling-star particles
* the landscape background artwork and its pointer/tilt parallax (`assets/backgrounds/`)
* the `#globalBg` overlay: the perspective grid, floating chess glyphs and scan-line sweep

**Disabled or hidden (code kept):**

* The original background system (grid / stars / nebula / photo) is pinned to a plain colour. Its settings section is hidden.
* The first-run welcome wizard is skipped. Help and the tutorial are still in **More…**.
* Ambient music is off by default. It can be turned back on in Settings → Sound.
* The menu subtitle is hidden. Login, server status and support links moved under **More…**.
* All in-game buttons are hidden: ☰ (tap the top centre or press Esc), the turn indicator ("White to move"), hint, undo, the layer minimap (use swipe or Q/E), Moves (M), Layers/All (Tab), Pan, TTS threat scan, Quick panel, help, the theme dock and the hide-UI toggle. Camera, flip, fullscreen and background moved into the pause menu.
* Games started from the core start screen have hint and undo turned off.
* Esc now reliably opens the pause menu. In the original it was immediately closed again by the menu keyboard-navigation handler.
* The online status pill only appears during an online match.
* The profile, tutorial and UI-settings entries are hidden from the pause menu. Settings is still there, and the rest are under **More…** on the start screen.

**Unchanged:** the four 8×8 layers and their geometry; the rules and move generation, including cross-layer moves, captures, special moves, check and mate; the bot (web worker); local pass-and-play; online play; puzzles; replays and replay export; the 3D pieces and board materials; the move animations, highlights and layer labels.

### Files

* `js/30_core.js`, `css/core.css`: new. The minimal presentation layer: background, start screen, board-only match screen, camera framing, shortcuts.
* `index.html`: removes the aurora canvases, their CSS and script, and the `#globalBg` canvas. Loads the two new files.
* `js/17_themes.js`: removes the `#globalBg` animation.
* `js/24_cozy_ui.js`, `css/cozy-ui.css`: remove the background artwork, parallax and background-stack styles.
* `service-worker.js`: cache version bumped.

`aurora-chess-main.zip` is the untouched original snapshot this version was built from.

## Verifying

There is no automated test suite. `tools/cdp.py` is the original project's headless-Chrome helper. It evaluates a JS file in the page and can save a screenshot. It needs `pip install websocket-client`, a Chrome or Chromium binary, and the game served on port 8123:

```sh
python3 -m http.server 8123 &
python3 tools/cdp.py check.js --shot out.png --size 1920x1080
```
