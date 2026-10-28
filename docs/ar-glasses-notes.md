# AR glasses — research notes (not started)

Status: **idea only, nothing implemented.** These notes are a starting point for a later session on the laptop that has the XREAL SDK installed.

Goal: show the 4-layer Aurora Chess board as a 3D object you see "on the table" through AR glasses, and later interact with it directly by hand, in the spirit of HoloDesk.

---

## 1. The reference paper: HoloDesk (Hilliges et al., CHI 2012)

**Setup.** A half-silvered mirror (beamsplitter) reflects an LCD mounted above it. The user looks through the mirror and sees the 3D scene floating inside a desk-sized volume, and can put their hands into that volume. No glasses are worn.

* **Hand and object tracking:** a Kinect sees the hands and real objects in the volume.
* **Head tracking:** an RGB webcam with OpenCV face tracking follows the head. Each frame is rendered with a viewpoint-corrected, off-axis projection. That gives motion parallax ("fish-tank VR") without stereo.

**Physics interaction.**
* **Hand representation:** hands and objects become many small physics particles. Each particle moves with a depth-aware optical flow computed from the Kinect RGB and depth images.
* **Grasping:** particles that push into a virtual object caused unstable forces. The fix was a kinematic particle joined to each dynamic proxy by a spring.
* **Result:** users scoop, push, juggle and grasp virtual objects with the whole hand, with no scripted gestures.

**Findings that matter for us:**

| Finding | Implication for chess |
| --- | --- |
| Direct interaction (hands in the volume) beat indirect: 1737 ms vs 1962 ms per target. 9 of 12 users preferred direct. | Selecting pieces by reaching into the board should feel better than a pointer on a separate screen. |
| Stereo (shutter glasses) was faster still (1590 ms). Without stereo, users needed extra fine adjustment in depth. | AR glasses give stereo for free. It also helps tell the four layers apart. |
| Targets **in front of** the image plane were clearly slower (~2.0 s vs ~1.6 s on or behind it) because users overshot. | Keep the board at or behind the anchor plane, e.g. sitting on the table surface. |
| 7 of 12 users still preferred the setup without glasses; some found the stereo glasses uncomfortable. | Wearing glasses has a comfort cost. Keep sessions short and the frame rate steady. |
| Physics-based grasping is powerful but complex and needs dense depth data. | For chess, a simple pinch (or gaze + pinch) on a square is enough. No physics grasping needed. |

**The paper also points to a glasses-free variant.** Our web build plus a webcam-based off-axis projection on a monitor, projector or beamsplitter would be a HoloDesk-style "fish-tank" display with no glasses at all. That fits the earlier projector and hologram-illusion direction.

---

## 2. XREAL glasses: what the SDK release note tells us

From the pasted **XREAL SDK for Unity 3.1.0** release note (2025-11-25):

* **6DoF tracking** works on the **XREAL One series with XREAL Eye**, after a glasses firmware update. Without XREAL Eye, assume 3DoF (head rotation only).
* The SDK has **hand tracking** and **image tracking** (both appear in the bug-fix list).
* **Tested host devices:** **Beam Pro** and **Samsung S25**. These are Android hosts, so **SDK apps appear to run on an Android device connected to the glasses, not on the laptop.** The laptop is the Unity development machine. Verify this in the SDK docs before planning around it.
* The terms require apps to disclose that they run on the XREAL SDK and link XREAL's privacy policy.

General properties of this hardware class, to verify on the actual glasses:
* **Additive display:** XREAL glasses are optical see-through. Black pixels show as transparent, so `?bg=black` already makes the board appear to float in the room.
* **External display:** the glasses can act as a USB-C (DisplayPort) external monitor for a laptop or phone.
* **Side-by-side 3D:** many XREAL models have an SBS 3D mode, where a full-width frame is split into a left-eye and a right-eye image. Check whether yours supports it and at what resolution.

---

## 3. Suggested path: cheapest first

### Phase 0: no code (try first)
Plug the glasses into the laptop as a display. Open the GitHub Pages build fullscreen with `?bg=black`.
* **Gives:** a floating board, played with mouse and keyboard.
* **Limits:** it's a flat screen fixed to your head, with no depth and no anchoring to the table.

### Phase 1: stereo in the web build (small)
Add an SBS stereo render mode to the web app, e.g. `?stereo=sbs`. Three.js `StereoCamera` renders the left and right eye into the two halves of the canvas. With the glasses' SBS mode on, the layers get real depth.
* **Effort:** small. It's one render-loop change in the presentation layer; the game code is untouched.
* **Limits:** still head-locked (moves with your head) unless the glasses' own screen-anchoring mode is used.

### Phase 2: native XREAL app (Unity, Android host)
The board is anchored in the world, on the table (6DoF with XREAL Eye, or 3DoF placed in front of the user). Input comes from hand tracking (pinch a square) or the Beam Pro as a controller/ray.

The main question is how to bring the rules and bot into Unity:
1. **Reuse the bot's engine.** `js/07_bot.js` already contains a self-contained, DOM-free engine as a source string (`BOT_WORKER_SRC`, run in a Web Worker): its own board map, move generation and search. It could run inside Unity through a C# JavaScript interpreter (e.g. Jint). That keeps one rules implementation.
2. **Port to C#.** The rule and execution code is about 60 KB of JS: `06_moves.js`, `09_execution.js`, the board setup in `04_board.js`, and the bot. Port it, and check parity by having the JS engine generate legal-move lists for many positions and asserting the C# port matches.
3. **Web view inside Unity.** This shows the existing page on a panel. It's simple but flat, not spatial, so it doesn't meet the goal.

For a first prototype, options 1 or 2 are the realistic choices. Rebuild only the visuals in Unity: four stacked glass slabs and the existing piece GLBs, which are embedded base64 in `index.html` and can be extracted to files.

### Phase 3: HoloDesk-style interaction
Hand-tracked direct selection inside the board volume. Highlight the square under the fingertip; pinch to pick up and pinch to drop, including moves across layers.
* Respect the paper's finding: keep the playing layers at or behind the user's reach plane.
* Use generous hit volumes in depth.

---

## 4. Open questions for the laptop session
* Which XREAL model is it, and does it have XREAL Eye (needed for 6DoF)?
* Is there an Android host (Beam Pro or a supported phone), or only the laptop? This decides Phase 2 vs staying web-based.
* Does the model support SBS 3D over USB-C? (This decides whether Phase 1 is worth it.)
* Should input be hand tracking, a controller, or both?
