/* ======================================================
   ── PUZZLE GLOBALS  (moved from 07_camera.js)
   v12: localStorage persistence, string solved keys
====================================================== */
let PUZZLE_MODE       = false;
let PUZZLE_ACTIVE     = -1;
let PUZZLE_MOVES_MADE = 0;
let PUZZLE_TUT_KEY    = -1;

// Persist solved set across page loads via localStorage.
// Keys: "m<id>" for main puzzles, "t<tutKey>" for tutorial puzzles.
const PUZZLE_SOLVED_KEY = 'auroraChess_v1_solved';
function _loadSolved() {
  try { return new Set(JSON.parse(localStorage.getItem(PUZZLE_SOLVED_KEY)) || []); }
  catch(e) { return new Set(); }
}
function _saveSolved() {
  try { localStorage.setItem(PUZZLE_SOLVED_KEY, JSON.stringify([...PUZZLE_SOLVED])); }
  catch(e) {}
}
let PUZZLE_SOLVED = _loadSolved();

/* ======================================================
   ── PUZZLE DATA
   All checkmate positions are 3D-verified (every king escape
   square on all reachable layers explicitly covered).
   "check" / "capture" puzzles use simple one-piece attacks
   verified by inspection.

   Fields per puzzle:
     id         — unique numeric ID (stable; do not reorder)
     name       — display name
     difficulty — "beginner" | "intermediate" | "advanced"
     category   — "smothered" | "rook_lift" | "queen" | "bishop"
                  "rook" | "fork" | "layer" | "capture" | "endgame"
     objective  — shown in puzzle bar
     hint       — shown when HINT button pressed
     solution   — [{from:{x,y,z}, to:{x,y,z}}] move sequence
     turn       — "white" | "black"
     goal       — "checkmate" | "check" | "escape" | "capture"
                  "pawnMove" | "knightMove" | "any"
     movesAllowed — number of moves allowed before failure
     pieces     — starting position
====================================================== */
const PUZZLES = [
  // ──────────────── SMOTHERED KNIGHT (0-3) ────────────────
  // King corner on z=0, 7 own pawns fill all neighbours.
  // Knight jumps to a square on z=1 that attacks the king via
  // a cross-layer L-shape; landing square verified uncapturable.
  {
    id:0, name:"Smothered I", difficulty:"beginner", category:"smothered",
    objective:"White to move — Checkmate in 1. The king has 7 neighbours — all filled!",
    hint:"The knight on layer 2 can jump to a square that forks through layers",
    solution:[{from:{x:3,y:6,z:1},to:{x:5,y:7,z:1}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:0,y:0,z:0, moved:true},
      {type:"knight", color:"white", x:3,y:6,z:1, moved:true},
      {type:"king",   color:"black", x:7,y:7,z:0, moved:true},
      {type:"pawn",   color:"black", x:6,y:7,z:0, moved:true},
      {type:"pawn",   color:"black", x:7,y:6,z:0, moved:true},
      {type:"pawn",   color:"black", x:6,y:6,z:0, moved:true},
      {type:"pawn",   color:"black", x:7,y:7,z:1, moved:true},
      {type:"pawn",   color:"black", x:6,y:7,z:1, moved:true},
      {type:"pawn",   color:"black", x:7,y:6,z:1, moved:true},
      {type:"pawn",   color:"black", x:6,y:6,z:1, moved:true}
    ]
  },
  {
    id:1, name:"Smothered II", difficulty:"beginner", category:"smothered",
    objective:"White to move — Checkmate in 1. Check all layers — the king is boxed in!",
    hint:"The knight can reach a square on layer 2 from which it attacks diagonally down",
    solution:[{from:{x:1,y:5,z:1},to:{x:2,y:7,z:1}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:7,y:7,z:3, moved:true},
      {type:"knight", color:"white", x:1,y:5,z:1, moved:true},
      {type:"king",   color:"black", x:0,y:7,z:0, moved:true},
      {type:"pawn",   color:"black", x:1,y:7,z:0, moved:true},
      {type:"pawn",   color:"black", x:0,y:6,z:0, moved:true},
      {type:"pawn",   color:"black", x:1,y:6,z:0, moved:true},
      {type:"pawn",   color:"black", x:0,y:7,z:1, moved:true},
      {type:"pawn",   color:"black", x:1,y:7,z:1, moved:true},
      {type:"pawn",   color:"black", x:0,y:6,z:1, moved:true},
      {type:"pawn",   color:"black", x:1,y:6,z:1, moved:true}
    ]
  },
  {
    id:2, name:"Smothered III", difficulty:"beginner", category:"smothered",
    // Knight (4,3,0)→(6,2,0) via (+2,-1,0). From (6,2,0): attacks king (7,0,0) via (+1,-2,0).
    // Old landing (5,1,0) was capturable by pawn (6,1,1) via XZ-diagonal (x-1,y,z-1).
    // New landing (6,2,0): no black pawn can reach it (nearest pawns are at y=0,1 — row 2 is clear).
    objective:"White to move — Checkmate in 1. The black king is trapped on two layers!",
    hint:"The knight jumps to a square two rows away from the king — check the (+1,-2) L-shape",
    solution:[{from:{x:4,y:3,z:0},to:{x:6,y:2,z:0}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:0,y:7,z:3, moved:true},
      {type:"knight", color:"white", x:4,y:3,z:0, moved:true},
      {type:"king",   color:"black", x:7,y:0,z:0, moved:true},
      {type:"pawn",   color:"black", x:6,y:0,z:0, moved:true},
      {type:"pawn",   color:"black", x:7,y:1,z:0, moved:true},
      {type:"pawn",   color:"black", x:6,y:1,z:0, moved:true},
      {type:"pawn",   color:"black", x:7,y:0,z:1, moved:true},
      {type:"pawn",   color:"black", x:6,y:0,z:1, moved:true},
      {type:"pawn",   color:"black", x:7,y:1,z:1, moved:true},
      {type:"pawn",   color:"black", x:6,y:1,z:1, moved:true}
    ]
  },
  {
    id:3, name:"Smothered IV", difficulty:"beginner", category:"smothered",
    // Knight (3,3,0)→(1,2,0) via (-2,-1,0). From (1,2,0): attacks king (0,0,0) via (-1,-2,0).
    // Old landing (2,1,0) was capturable by pawn (1,1,1) via XZ-diagonal (x+1,y,z-1).
    // New landing (1,2,0): no black pawn at y=2 or z=1 rows can reach it.
    objective:"White to move — Checkmate in 1. The king can't escape to layer 2 either!",
    hint:"The knight crosses two files and one rank — find the (-1,-2) L-shape onto an empty square",
    solution:[{from:{x:3,y:3,z:0},to:{x:1,y:2,z:0}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:7,y:7,z:3, moved:true},
      {type:"knight", color:"white", x:3,y:3,z:0, moved:true},
      {type:"king",   color:"black", x:0,y:0,z:0, moved:true},
      {type:"pawn",   color:"black", x:1,y:0,z:0, moved:true},
      {type:"pawn",   color:"black", x:0,y:1,z:0, moved:true},
      {type:"pawn",   color:"black", x:1,y:1,z:0, moved:true},
      {type:"pawn",   color:"black", x:0,y:0,z:1, moved:true},
      {type:"pawn",   color:"black", x:1,y:0,z:1, moved:true},
      {type:"pawn",   color:"black", x:0,y:1,z:1, moved:true},
      {type:"pawn",   color:"black", x:1,y:1,z:1, moved:true}
    ]
  },

  // ──────────────── ROOK LIFT (4-7) ────────────────
  // Black king on top layer (z=3) corner, surrounded by three covering rooks
  // on z=0 that seal all adjacent escape squares via the z-axis.
  // The lifting rook starts on z=1 (queen at z=0 guards behind it), captures
  // the blocking pawn at z=2, and checks the king at z=3.
  // After the lift, queen at z=0 guards the rook through the now-empty z=1.
  {
    id:4, name:"Rook Lift I", difficulty:"beginner", category:"rook_lift",
    objective:"White to move — Checkmate in 1. The king is on layer 4 — lift the rook up the Z-axis!",
    hint:"Capture the pawn to lift the rook — the queen guards it from below",
    solution:[{from:{x:7,y:7,z:1},to:{x:7,y:7,z:2}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:0,z:0, moved:true},
      {type:"queen", color:"white", x:7,y:7,z:0, moved:true},
      {type:"rook",  color:"white", x:7,y:7,z:1, moved:true},
      {type:"rook",  color:"white", x:6,y:7,z:0, moved:true},
      {type:"rook",  color:"white", x:7,y:6,z:0, moved:true},
      {type:"rook",  color:"white", x:6,y:6,z:0, moved:true},
      {type:"king",  color:"black", x:7,y:7,z:3, moved:true},
      {type:"pawn",  color:"black", x:7,y:7,z:2, moved:true}
    ]
  },
  {
    id:5, name:"Rook Lift II", difficulty:"beginner", category:"rook_lift",
    objective:"White to move — Checkmate in 1. The king sits on layer 4 corner — use the Z-axis!",
    hint:"Capture the pawn to lift the rook — the queen guards it from below",
    solution:[{from:{x:0,y:0,z:1},to:{x:0,y:0,z:2}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:7,y:7,z:0, moved:true},
      {type:"queen", color:"white", x:0,y:0,z:0, moved:true},
      {type:"rook",  color:"white", x:0,y:0,z:1, moved:true},
      {type:"rook",  color:"white", x:1,y:0,z:0, moved:true},
      {type:"rook",  color:"white", x:0,y:1,z:0, moved:true},
      {type:"rook",  color:"white", x:1,y:1,z:0, moved:true},
      {type:"king",  color:"black", x:0,y:0,z:3, moved:true},
      {type:"pawn",  color:"black", x:0,y:0,z:2, moved:true}
    ]
  },
  {
    id:6, name:"Rook Lift III", difficulty:"beginner", category:"rook_lift",
    objective:"White to move — Checkmate in 1. Layer 4 corner — all escape squares sealed!",
    hint:"The rook on the Z-axis just needs to clear one pawn",
    solution:[{from:{x:0,y:7,z:1},to:{x:0,y:7,z:2}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:7,y:0,z:0, moved:true},
      {type:"queen", color:"white", x:0,y:7,z:0, moved:true},
      {type:"rook",  color:"white", x:0,y:7,z:1, moved:true},
      {type:"rook",  color:"white", x:1,y:7,z:0, moved:true},
      {type:"rook",  color:"white", x:0,y:6,z:0, moved:true},
      {type:"rook",  color:"white", x:1,y:6,z:0, moved:true},
      {type:"king",  color:"black", x:0,y:7,z:3, moved:true},
      {type:"pawn",  color:"black", x:0,y:7,z:2, moved:true}
    ]
  },
  {
    id:7, name:"Rook Lift IV", difficulty:"beginner", category:"rook_lift",
    objective:"White to move — Checkmate in 1. Layer 4 corner — same pattern, different corner!",
    hint:"Lift the rook by capturing the pawn — the queen guards from below",
    solution:[{from:{x:7,y:0,z:1},to:{x:7,y:0,z:2}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:7,z:0, moved:true},
      {type:"queen", color:"white", x:7,y:0,z:0, moved:true},
      {type:"rook",  color:"white", x:7,y:0,z:1, moved:true},
      {type:"rook",  color:"white", x:6,y:0,z:0, moved:true},
      {type:"rook",  color:"white", x:7,y:1,z:0, moved:true},
      {type:"rook",  color:"white", x:6,y:1,z:0, moved:true},
      {type:"king",  color:"black", x:7,y:0,z:3, moved:true},
      {type:"pawn",  color:"black", x:7,y:0,z:2, moved:true}
    ]
  },

  // ──────────────── QUEEN CHECKMATES (8-9) ────────────────
  {
    id:8, name:"Queen Sweep", difficulty:"beginner", category:"queen",
    objective:"White to move — Checkmate in 1. The queen captures AND seals the last exit!",
    hint:"Capture the blocking pawn — the queen will cover two squares at once",
    solution:[{from:{x:4,y:7,z:0},to:{x:5,y:7,z:0}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:0,z:0, moved:true},
      {type:"queen", color:"white", x:4,y:7,z:0, moved:true},
      {type:"rook",  color:"white", x:6,y:7,z:3, moved:true},
      {type:"king",  color:"black", x:7,y:7,z:0, moved:true},
      {type:"pawn",  color:"black", x:5,y:7,z:0, moved:true},
      {type:"pawn",  color:"black", x:7,y:6,z:0, moved:true},
      {type:"pawn",  color:"black", x:6,y:6,z:0, moved:true},
      {type:"pawn",  color:"black", x:7,y:7,z:1, moved:true},
      {type:"pawn",  color:"black", x:7,y:6,z:1, moved:true},
      {type:"pawn",  color:"black", x:6,y:6,z:1, moved:true}
    ]
  },
  {
    id:9, name:"Queen Diagonal", difficulty:"beginner", category:"queen",
    // Queen (3,1,0)→(1,1,0) along y=1 rank; from (1,1,0) diagonal (-1,-1,0) checks king at (0,0,0).
    // Rook at (1,7,0) guards queen via x=1 file — king can't capture.
    // All 7 escape squares from (0,0,0) are blocked by own pawns or covered.
    // NOTE: queen must NOT start on the (3,3)→(0,0) diagonal — that would pre-check the king.
    objective:"White to move — Checkmate in 1. Slide the queen along the rank, then the diagonal does the rest!",
    hint:"The queen lands one square diagonally adjacent to the king — the rook on the same file guards it",
    solution:[{from:{x:3,y:1,z:0},to:{x:1,y:1,z:0}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:7,y:7,z:3, moved:true},
      {type:"queen", color:"white", x:3,y:1,z:0, moved:true},
      {type:"rook",  color:"white", x:1,y:7,z:0, moved:true},
      {type:"king",  color:"black", x:0,y:0,z:0, moved:true},
      {type:"pawn",  color:"black", x:1,y:0,z:0, moved:true},
      {type:"pawn",  color:"black", x:0,y:1,z:0, moved:true},
      {type:"pawn",  color:"black", x:0,y:0,z:1, moved:true},
      {type:"pawn",  color:"black", x:1,y:0,z:1, moved:true},
      {type:"pawn",  color:"black", x:1,y:1,z:1, moved:true}
    ]
  },

  // ──────────────── FORK / TACTIC (10-11) ────────────────
  {
    id:10, name:"Knight Fork", difficulty:"beginner", category:"fork",
    // Knight (2,5,0)→(4,4,0) via (+2,-1,0) ✓
    // From (4,4,0): attacks king (3,2,0) via (-1,-2,0) ✓
    //              attacks rook (5,6,0) via (+1,+2,0) ✓
    // King NOT in check before move (knight attacks list doesn't include (3,2,0)) ✓
    objective:"White to move — Fork the king and rook with one knight leap!",
    hint:"Find a central square where the knight threatens two black pieces at once",
    solution:[{from:{x:2,y:5,z:0},to:{x:4,y:4,z:0}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:0,y:0,z:3, moved:true},
      {type:"knight", color:"white", x:2,y:5,z:0, moved:true},
      {type:"king",   color:"black", x:3,y:2,z:0, moved:true},
      {type:"rook",   color:"black", x:5,y:6,z:0, moved:true}
    ]
  },
  {
    id:11, name:"Z-Axis Pierce", difficulty:"beginner", category:"layer",
    // Rook (4,4,0)→(4,4,2) captures pawn at (4,4,2).
    // From (4,4,2): checks king (4,4,3) straight up z-axis.
    // Path through (4,4,1) is clear ✓
    // King NOT in check before move (pawn at (4,4,2) blocks rook) ✓
    objective:"White to move — Punch through the pawn and check the king above!",
    hint:"The rook travels straight up between layers — one piece blocks the way",
    solution:[{from:{x:4,y:4,z:0},to:{x:4,y:4,z:2}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:0,z:0, moved:true},
      {type:"rook",  color:"white", x:4,y:4,z:0, moved:true},
      {type:"king",  color:"black", x:4,y:4,z:3, moved:true},
      {type:"pawn",  color:"black", x:4,y:4,z:2, moved:true},
      {type:"rook",  color:"black", x:7,y:7,z:3, moved:true}
    ]
  },

  // ──────────────── BISHOP TACTICS (12) ────────────────
  {
    id:12, name:"Bishop Clearance", difficulty:"beginner", category:"bishop",
    // Bishop (4,0,3) captures pawn (5,1,3) via (+1,+1,0) ✓ same-layer diagonal.
    // From (5,1,3): checks king (7,3,3) via (+2,+2,0) — path (6,2,3) clear ✓
    // King NOT in check before move (pawn at (5,1,3) blocks diagonal) ✓
    objective:"White to move — Capture the pawn to reveal a diagonal attack on the king!",
    hint:"The bishop's diagonal is blocked by one pawn — remove it",
    solution:[{from:{x:4,y:0,z:3},to:{x:5,y:1,z:3}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:0,y:7,z:3, moved:true},
      {type:"bishop", color:"white", x:4,y:0,z:3, moved:true},
      {type:"king",   color:"black", x:7,y:3,z:3, moved:true},
      {type:"pawn",   color:"black", x:5,y:1,z:3, moved:true},
      {type:"rook",   color:"black", x:0,y:0,z:0, moved:true}
    ]
  },

  // ──────────────── ROOK FILE/RANK TACTICS (13) ────────────
  {
    id:13, name:"File Pierce", difficulty:"beginner", category:"rook",
    // Rook (5,0,0) captures pawn (5,4,0) along x=5 file ✓
    // From (5,4,0): checks king (5,7,0) — path (5,5,0),(5,6,0) clear ✓
    // King NOT in check before move (pawn at (5,4,0) blocks) ✓
    objective:"White to move — Clear the file and give check!",
    hint:"Capture the pawn to open the rook's line to the king",
    solution:[{from:{x:5,y:0,z:0},to:{x:5,y:4,z:0}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:7,y:7,z:3, moved:true},
      {type:"rook",  color:"white", x:5,y:0,z:0, moved:true},
      {type:"king",  color:"black", x:5,y:7,z:0, moved:true},
      {type:"pawn",  color:"black", x:5,y:4,z:0, moved:true},
      {type:"rook",  color:"black", x:0,y:0,z:0, moved:true}
    ]
  },

  // ──────────────── QUEEN LAYER ATTACK (14) ────────────────
  {
    id:14, name:"Queen Spear", difficulty:"beginner", category:"queen",
    // Queen (3,3,0) captures pawn (3,3,2) moving straight up z-axis ✓
    // From (3,3,2): checks king (3,3,3) — path through (3,3,1) is clear ✓
    // King NOT in check before move (pawn at (3,3,2) blocks z-axis) ✓
    objective:"White to move — Clear the Z-axis and skewer the king above!",
    hint:"The queen can travel straight up between layers — something is in the way",
    solution:[{from:{x:3,y:3,z:0},to:{x:3,y:3,z:2}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:0,z:0, moved:true},
      {type:"queen", color:"white", x:3,y:3,z:0, moved:true},
      {type:"king",  color:"black", x:3,y:3,z:3, moved:true},
      {type:"pawn",  color:"black", x:3,y:3,z:2, moved:true},
      {type:"rook",  color:"black", x:7,y:7,z:0, moved:true}
    ]
  },

  // ── Add more puzzles here. Fields required: id, name, difficulty,
  //    category, objective, hint, solution, turn, goal, movesAllowed, pieces

  // ──────────────── 3D LAYER TACTICS (15-22) ────────────────

  // Discovered check through Z-axis — move knight off z-column to reveal rook's vertical attack
  {
    id:15, name:"3D Discovery", difficulty:"beginner", category:"layer",
    objective:"White to move — Check! Move the knight to uncover a hidden attack through the layers!",
    hint:"The knight is blocking the rook's Z-axis line. Any knight move off that column reveals the attack",
    solution:[{from:{x:4,y:3,z:2},to:{x:6,y:4,z:2}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:0,y:7,z:0, moved:true},
      {type:"rook",   color:"white", x:4,y:3,z:0, moved:true},
      {type:"knight", color:"white", x:4,y:3,z:2, moved:true},
      {type:"king",   color:"black", x:4,y:3,z:3, moved:true},
      {type:"rook",   color:"black", x:7,y:0,z:3, moved:true}
    ]
  },

  // Bishop uses the unique 3D diagonal (±1,±1,±1) that only bishops have
  {
    id:16, name:"Bishop's 3D Diagonal", difficulty:"beginner", category:"bishop",
    objective:"White to move — Check! The bishop has a secret weapon: the true 3D diagonal!",
    hint:"Capture the pawn to open the 3D diagonal line (+1,+1,+1) — it cuts through all three dimensions at once",
    solution:[{from:{x:2,y:2,z:0},to:{x:3,y:3,z:1}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:7,y:0,z:0, moved:true},
      {type:"bishop", color:"white", x:2,y:2,z:0, moved:true},
      {type:"king",   color:"black", x:5,y:5,z:3, moved:true},
      {type:"pawn",   color:"black", x:3,y:3,z:1, moved:true},
      {type:"rook",   color:"black", x:0,y:7,z:3, moved:true}
    ]
  },

  // Queen delivers checkmate via Z-axis from below — king trapped by own rooks and pawns on top layer
  // Inspired by the Epaulette Mate: king flanked by own rooks, unable to escape
  {
    id:17, name:"Epaulette Mate 3D", difficulty:"beginner", category:"queen",
    objective:"White to move — Checkmate! The king is flanked by its own rooks — strike from below!",
    hint:"Slide the queen up the file to layer 3. She'll check straight up through the Z-axis — the rook below guards her",
    solution:[{from:{x:4,y:3,z:2},to:{x:4,y:7,z:2}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:0,z:0, moved:true},
      {type:"queen", color:"white", x:4,y:3,z:2, moved:true},
      {type:"rook",  color:"white", x:4,y:0,z:2, moved:true},
      {type:"king",  color:"black", x:4,y:7,z:3, moved:true},
      {type:"rook",  color:"black", x:3,y:7,z:3, moved:true},
      {type:"rook",  color:"black", x:5,y:7,z:3, moved:true},
      {type:"pawn",  color:"black", x:3,y:6,z:3, moved:true},
      {type:"pawn",  color:"black", x:4,y:6,z:3, moved:true},
      {type:"pawn",  color:"black", x:5,y:6,z:3, moved:true}
    ]
  },

  // Knight delivers checkmate from layer 2 via cross-layer L-shape (+2,0,+1) to king on layer 3
  // King is smothered in corner by own rook and pawns — a 3D twist on the classic smothered mate
  {
    id:18, name:"Cross-Layer Knight Mate", difficulty:"beginner", category:"smothered",
    objective:"White to move — Checkmate! The knight can reach through layers — find the cross-dimensional L-shape!",
    hint:"The knight jumps (+2,+1,0) to a square on layer 2 from which it attacks the king on layer 3 via (+2,0,+1)",
    solution:[{from:{x:3,y:6,z:2},to:{x:5,y:7,z:2}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:0,y:0,z:0, moved:true},
      {type:"knight", color:"white", x:3,y:6,z:2, moved:true},
      {type:"king",   color:"black", x:7,y:7,z:3, moved:true},
      {type:"rook",   color:"black", x:6,y:7,z:3, moved:true},
      {type:"pawn",   color:"black", x:7,y:6,z:3, moved:true},
      {type:"pawn",   color:"black", x:6,y:6,z:3, moved:true},
      {type:"pawn",   color:"black", x:7,y:7,z:2, moved:true}
    ]
  },

  // Knight forks king on layer 2 and queen on layer 0 using cross-layer L-shapes
  // Exploits the knight's unique ability to attack across two layers with (+1,0,-2)
  {
    id:19, name:"3D Knight Fork", difficulty:"beginner", category:"fork",
    objective:"White to move — Fork! One knight leap threatens both the king AND the queen across layers!",
    hint:"Jump to the square that attacks the king via (-1,+2,0) and the queen below via (+1,0,-2)",
    solution:[{from:{x:2,y:4,z:2},to:{x:4,y:3,z:2}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:7,y:0,z:0, moved:true},
      {type:"knight", color:"white", x:2,y:4,z:2, moved:true},
      {type:"king",   color:"black", x:3,y:5,z:2, moved:true},
      {type:"queen",  color:"black", x:5,y:3,z:0, moved:true},
      {type:"rook",   color:"black", x:0,y:7,z:3, moved:true}
    ]
  },

  // Rook captures bishop to reveal Z-axis pin/check — vertical pin through layers
  {
    id:20, name:"Vertical Pin", difficulty:"beginner", category:"rook",
    objective:"White to move — Check! Punch through the bishop to pin down the Z-axis!",
    hint:"The rook can capture the bishop and open a vertical line straight to the king above",
    solution:[{from:{x:3,y:3,z:0},to:{x:3,y:3,z:1}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:0,z:0, moved:true},
      {type:"rook",  color:"white", x:3,y:3,z:0, moved:true},
      {type:"king",   color:"black", x:3,y:3,z:3, moved:true},
      {type:"bishop", color:"black", x:3,y:3,z:1, moved:true},
      {type:"rook",   color:"black", x:7,y:7,z:3, moved:true}
    ]
  },

  // Moving bishop off Z-column reveals rook discovered check AND bishop delivers its own check
  // Double check — king MUST move, inspired by the Windmill/Discovery pattern
  {
    id:21, name:"Double Discovery", difficulty:"beginner", category:"layer",
    objective:"White to move — Double check! One move, two check lines through different dimensions!",
    hint:"Move the bishop to deliver check on layer 4 — it also uncovers the rook's Z-axis attack from below",
    solution:[{from:{x:4,y:4,z:2},to:{x:5,y:5,z:3}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:0,y:0,z:0, moved:true},
      {type:"rook",   color:"white", x:4,y:4,z:0, moved:true},
      {type:"bishop", color:"white", x:4,y:4,z:2, moved:true},
      {type:"king",   color:"black", x:4,y:4,z:3, moved:true},
      {type:"rook",   color:"black", x:7,y:0,z:3, moved:true}
    ]
  },

  // Queen uses the plus-diagonal — the cross-layer move unique to queens (0,±1,±1)
  // King is trapped on layer 4 corner by own pieces, queen mates from the layer below
  // Inspired by Philidor's suffocation theme adapted for 3D geometry
  {
    id:22, name:"Queen's Plus-Diagonal", difficulty:"beginner", category:"queen",
    objective:"White to move — Checkmate! The queen has a cross-layer diagonal that even bishops can't use!",
    hint:"Slide the queen up the file to a square where the plus-diagonal (0,+1,+1) strikes the king diagonally through layers",
    solution:[{from:{x:0,y:2,z:2},to:{x:0,y:6,z:2}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:7,y:0,z:0, moved:true},
      {type:"queen", color:"white", x:0,y:2,z:2, moved:true},
      {type:"king",  color:"black", x:0,y:7,z:3, moved:true},
      {type:"rook",  color:"black", x:1,y:7,z:3, moved:true},
      {type:"pawn",  color:"black", x:0,y:6,z:3, moved:true},
      {type:"rook",  color:"black", x:1,y:6,z:3, moved:true},
      {type:"pawn",  color:"black", x:0,y:7,z:2, moved:true}
    ]
  },

   // ────────────────── NEW PUZZLES (23-27) ──────────────────
  {
    id:23, name:"Z‑Axis Interception", difficulty:"beginner", category:"escape",
    objective:"White to move — Escape check by blocking the queen’s vertical line!",
    hint:"Slide your rook one layer up – it will cut the queen’s attack through the Z‑column.",
    solution:[{from:{x:4,y:4,z:1},to:{x:4,y:4,z:2}}],
    turn:"white", goal:"escape", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:4,y:4,z:0, moved:true},
      {type:"rook",  color:"white", x:4,y:4,z:1, moved:true},
      {type:"queen", color:"black", x:4,y:4,z:3, moved:true},
      {type:"king",  color:"black", x:0,y:0,z:3, moved:true}
    ]
  },
  {
    id:24, name:"King Slips Up", difficulty:"beginner", category:"escape",
    objective:"White to move — Escape check. The king can step into the third dimension!",
    hint:"The rook only sees you on this layer – move to a square it cannot reach.",
    solution:[{from:{x:0,y:0,z:0},to:{x:0,y:0,z:1}}],
    turn:"white", goal:"escape", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:0,z:0, moved:true},
      {type:"rook",  color:"black", x:1,y:0,z:0, moved:true},
      {type:"pawn",  color:"black", x:0,y:1,z:0, moved:true},
      {type:"king",  color:"black", x:7,y:7,z:3, moved:true}
    ]
  },
  {
    id:25, name:"Queen’s Plus‑Fork", difficulty:"beginner", category:"fork",
    objective:"White to move — Check! One queen move gives check AND threatens a rook on a different layer.",
    hint:"Slide the queen along the plus‑diagonal (+1,0,+1) – it will attack the king straight up and the rook sideways through the layers.",
    solution:[{from:{x:4,y:5,z:1},to:{x:3,y:5,z:2}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:0,z:0, moved:true},
      {type:"queen", color:"white", x:4,y:5,z:1, moved:true},
      {type:"king",  color:"black", x:5,y:5,z:3, moved:true},
      {type:"rook",  color:"black", x:2,y:5,z:0, moved:true}
    ]
  },
  {
    id:26, name:"Bishop’s 3D Mate", difficulty:"beginner", category:"bishop",
    objective:"White to move — Checkmate! Unleash the bishop’s true 3D diagonal and seal every escape with pieces lurking below.",
    hint:"The bishop can leap along (+1,+1,+1). Move it to a square that attacks the king through all three dimensions – your rooks and queen below will cover the rest.",
    solution:[{from:{x:6,y:6,z:3},to:{x:3,y:3,z:0}}],
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white", x:0,y:7,z:3, moved:true},
      {type:"rook",   color:"white", x:0,y:3,z:2, moved:true},
      {type:"bishop", color:"white", x:6,y:6,z:3, moved:true},
      {type:"king",   color:"black", x:0,y:0,z:3, moved:true},
      {type:"pawn",   color:"black", x:1,y:0,z:3, moved:true},
      {type:"pawn",   color:"black", x:0,y:1,z:3, moved:true},
      {type:"knight",   color:"black", x:1,y:1,z:3, moved:true}
    ]
  },
  {
    id:27, name:"Pawn Discovery Check", difficulty:"beginner", category:"layer",
    objective:"White to move — Check! Move the pawn to reveal a hidden queen attack through the layers.",
    hint:"The pawn is blocking your queen’s plus‑diagonal (0,+1,+1). Push it forward and the line opens.",
    solution:[{from:{x:3,y:4,z:1},to:{x:3,y:5,z:1}}],
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:0,z:0, moved:true},
      {type:"queen", color:"white", x:3,y:3,z:0, moved:true},
      {type:"pawn",  color:"white", x:3,y:4,z:1, moved:true},
      {type:"king",  color:"black", x:3,y:6,z:3, moved:true}
    ]
  },
  {
  id: 28, name: "False 9", difficulty: "intermediate", category: "smothered",
  objective: "Find a checkmate in one move",
  hint: "Sometimes the most effective attacks come from below",
  solution: [{from: {x:5, y:6, z:2}, to: {x:7, y:6, z:1}}],
  turn: "white", goal: "checkmate", movesAllowed: 1,
  pieces: [
    {type:"king", color:"white", x:0, y:0, z:0, moved:true},
    {type:"knight", color:"white", x:5, y:6, z:2, moved:true},
    {type:"king", color:"black", x:7, y:7, z:3, moved:true},
    {type:"queen", color:"white", x:0, y:6, z:3, moved:true},
    {type:"queen", color:"white", x:6, y:0, z:3, moved:true},
    {type:"rook", color:"white", x:6, y:6, z:3, moved:true},
    {type:"rook", color:"white", x:6, y:6, z:2, moved:true},
    {type:"rook", color:"white", x:6, y:7, z:2, moved:true},
    {type:"rook", color:"white", x:7, y:5, z:2, moved:true},
    {type:"bishop", color:"white", x:7, y:7, z:2, moved:true},
    {type:"bishop", color:"white", x:6, y:7, z:3, moved:true},
    {type:"bishop", color:"white", x:7, y:6, z:3, moved:true},

  ]
}
];

/* ======================================================
   ── TUTORIAL PUZZLES
   Accessed separately from PUZZLES via tutKey index.
   Solved keys stored as "t<n>" in PUZZLE_SOLVED.
====================================================== */
const TUT_PUZZLES = [
  {
    name:"Pawn Basics", objective:"Move a pawn forward — try two squares!",
    turn:"white", goal:"pawnMove", movesAllowed:1,
    pieces:[
      {type:"king", color:"white",x:4,y:0,z:0,moved:true},
      {type:"pawn", color:"white",x:4,y:1,z:0,moved:false},
      {type:"king", color:"black",x:4,y:7,z:0,moved:true}
    ]
  },
  {
    name:"Rook Check", objective:"Move the rook to give check",
    turn:"white", goal:"check", movesAllowed:1,
    pieces:[
      {type:"king", color:"white",x:0,y:0,z:0,moved:true},
      {type:"rook", color:"white",x:0,y:5,z:0,moved:true},
      {type:"king", color:"black",x:7,y:7,z:0,moved:true}
    ]
  },
  {
    name:"Bishop Strike", objective:"Capture the black bishop",
    turn:"white", goal:"capture", targetAt:{x:5,y:5,z:0}, movesAllowed:1,
    pieces:[
      {type:"king",   color:"white",x:0,y:0,z:0,moved:true},
      {type:"bishop", color:"white",x:2,y:2,z:0,moved:true},
      {type:"bishop", color:"black",x:5,y:5,z:0,moved:true},
      {type:"king",   color:"black",x:7,y:7,z:0,moved:true}
    ]
  },
  {
    name:"Knight Leap", objective:"Move the knight in an L-shape",
    turn:"white", goal:"knightMove", movesAllowed:1,
    pieces:[
      {type:"king",   color:"white",x:0,y:0,z:0,moved:true},
      {type:"knight", color:"white",x:3,y:3,z:0,moved:true},
      {type:"king",   color:"black",x:7,y:7,z:0,moved:true}
    ]
  },
  {
    name:"Queen Checkmate", objective:"Checkmate the black king in one move",
    turn:"white", goal:"checkmate", movesAllowed:1,
    pieces:[
      {type:"king",  color:"white", x:0,y:0,z:0, moved:true},
      {type:"queen", color:"white", x:4,y:7,z:0, moved:true},
      {type:"rook",  color:"white", x:6,y:7,z:3, moved:true},
      {type:"king",  color:"black", x:7,y:7,z:0, moved:true},
      {type:"pawn",  color:"black", x:5,y:7,z:0, moved:true},
      {type:"pawn",  color:"black", x:7,y:6,z:0, moved:true},
      {type:"pawn",  color:"black", x:6,y:6,z:0, moved:true},
      {type:"pawn",  color:"black", x:7,y:7,z:1, moved:true},
      {type:"pawn",  color:"black", x:7,y:6,z:1, moved:true},
      {type:"pawn",  color:"black", x:6,y:6,z:1, moved:true}
    ]
  },
  {
    name:"King Safety", objective:"Move the king to escape check",
    turn:"white", goal:"escape", movesAllowed:1,
    pieces:[
      {type:"king", color:"white",x:4,y:4,z:0,moved:true},
      {type:"rook", color:"black",x:4,y:0,z:0,moved:true},
      {type:"king", color:"black",x:7,y:7,z:0,moved:true}
    ]
  }
];

/* ======================================================
   ── TUTORIAL SECTIONS + STEPS
====================================================== */
const TUT_SECTIONS = [
  { id:'chess_basics', label:'Chess Basics', icon:'♟' },
  { id:'cubic_chess',  label:'Volumetric 3d Chess',  icon:'⬡' },
  { id:'arcade',       label:'Arcade Mode',  icon:'⚡' },
  { id:'ctf',          label:'Flag Mode',    icon:'⚑' }
];

const TUTS = [
  // ── Chess Basics ──────────────────────────────────────────────
  {
    section:'chess_basics',
    title: "The Pawn ♟",
    text:  "Pawns move FORWARD — toward higher-numbered rows (Y+) or higher-numbered layers (Z+). On first move they can advance 2 steps. Captures are diagonal. In 3D, pawns can also step one layer forward.",
    demo:   "·  ↑  ·\n·  ♟  ·    forward move\n×  ·  ×    diagonal captures\n\nCan also step 1 layer up/down on first move.",
    puzzle: { text: "Move the pawn two squares forward.", tutKey: 0 }, highlight: null
  },
  {
    section:'chess_basics',
    title: "The Rook ♜",
    text:  "Rooks move in straight lines: left/right (X), up/down the board (Y), or straight through layers (Z). Any number of squares in one direction per move. They cannot jump over pieces.",
    demo:   "       ↑\n       ♜\n← · · ♜ · · →    any distance\n       ↓\n\nAlso moves ↑↓ between layers (Z-axis).",
    puzzle: { text: "Move the rook to give check.", tutKey: 1 }, highlight: null
  },
  {
    section:'chess_basics',
    title: "The Bishop ♝",
    text:  "Bishops move diagonally. In 3D they also travel on TRUE 3D diagonals — where X, Y, and Z all change simultaneously. This gives each bishop access to 13 directions and coverage across layers.",
    demo:   "↖  ·  ↗\n ·  ♝  ·    diagonal only\n↙  ·  ↘\n\nBonus: full 3D diagonals (±1,±1,±1)\nBishop owns the diagonal highways!",
    puzzle: { text: "Capture the enemy bishop diagonally.", tutKey: 2 }, highlight: null
  },
  {
    section:'chess_basics',
    title: "The Knight ♞",
    text:  "Knights move in an L-shape: 2 squares in one axis and 1 perpendicular — across all three dimensions! Knights JUMP over any pieces and are especially tricky in 3D.",
    demo:   "·  🟡  ·  🟡  ·\n🟡  ·  ·  ·  🟡\n·  ·  ♞  ·  ·\n🟡  ·  ·  ·  🟡\n·  🟡  ·  🟡  ·\n\nAll 24 L-shapes in 3D — can also jump layers!",
    puzzle: { text: "Move the knight — observe its L-shaped jump.", tutKey: 3 }, highlight: null
  },
  {
    section:'chess_basics',
    title: "The Queen ♛",
    text:  "The Queen is the most powerful piece. Within a layer she moves like a rook AND bishop combined. Between layers she goes straight up/down and on edge-diagonals. The full 3D diagonal (±1,±1,±1) is reserved for the Bishop.",
    demo:   "Same layer: all 8 directions (any distance)\nCross-layer: straight up/down\n            + edge diagonals (xz and yz)\nNOT: (±1,±1,±1) — bishop only!\n\nTip: queen dominates open layers.",
    puzzle: { text: "Checkmate the black king in one move.", tutKey: 4 }, highlight: null
  },
  {
    section:'chess_basics',
    title: "The King ♚",
    text:  "The King moves ONE square in any direction — including to adjacent layers. The King must NEVER move into check. In 3D chess, threats can arrive from any of 26 directions.",
    demo:   "🟡🟡🟡\n🟡♚🟡    1 square any direction\n🟡🟡🟡\n\nAlso moves 1 layer ↑↓ (26 squares total).",
    puzzle: { text: "Move the king out of check — find safety.", tutKey: 5 }, highlight: null
  },
  {
    section:'chess_basics',
    title: "Check & Checkmate",
    text:  "CHECK means your King is under attack — you must escape immediately (block, move, or capture the attacker). CHECKMATE means you cannot escape and the game ends. In 3D chess, CHECK can come from any layer!",
    demo: null, puzzle: null, highlight: null
  },
  {
    section:'chess_basics',
    title: "Castling & Promotion",
    text:  "CASTLING: King and Rook swap positions when the path is clear, neither has moved, the king is not in check, and the king does not pass through an attacked square. PROMOTION: a pawn reaching rank 8 (Y=7, white) or rank 1 (Y=0, black) on any layer promotes to any piece.",
    demo: null, puzzle: null, highlight: null
  },

  // ── Aurora Chess ──────────────────────────────────────────────
  {
    section:'cubic_chess',
    title: "Welcome to Aurora Chess 4L",
    text:  "Aurora Chess 4L is played on an 8×8×4 board — 4 chess layers stacked vertically. The smaller Z-axis makes the game faster and the AI stronger. Standard chess rules apply but pieces move freely between layers.",
    demo: null, puzzle: null, highlight: null
  },
  {
    section:'cubic_chess',
    title: "Starting Position",
    text:  "White's major pieces start on layer 0 (bottom). Black's major pieces are on layer 3 (top). Each side has three pawn walls spread across layers 0–1 (white) and 2–3 (black), blocking the Z-axis like pawns block ranks.",
    demo:   "Layer 3 — Black major pieces + pawn wall\nLayer 2 — Black pawn walls\nLayer 1 — White pawn walls\nLayer 0 — White major pieces + pawn wall",
    puzzle: null, highlight: null
  },
  {
    section:'cubic_chess',
    title: "Navigating Layers",
    text:  "Use the LAYER SLIDER on the right edge of the screen to change which layer you are viewing. On mobile, swipe one finger up or down on the board. The corner indicator shows your current layer (L1–L4).",
    demo: null, puzzle: null, highlight: "zSlider"
  },
  {
    section:'cubic_chess',
    title: "The Active Layer",
    text:  "Pieces on the ACTIVE LAYER appear solid. Pieces on other layers appear semi-transparent — they still exist and can threaten your king! You can only select and move pieces on the active layer.",
    demo: null, puzzle: null, highlight: null
  },
  {
    section:'cubic_chess',
    title: "Promotion",
    text:  "A pawn promotes when it reaches the back rank — rank 8 for white (Y=7), rank 1 for black (Y=0) — on any layer. The Z-axis height does not matter; only the Y rank triggers promotion.",
    demo:   "White promotion: Y=7 on any layer\nBlack promotion: Y=0 on any layer\nLayer position does not affect promotion",
    puzzle: null, highlight: null
  },
  {
    section:'cubic_chess',
    title: "Thinking in 3D",
    text:  "A piece safe on one layer can be attacked from above or below. With only 4 layers the board is compact — every piece is at most 3 layers from your king. Rooks and queens dominate open Z-columns. Knights leap across all three axes.",
    demo:   "Same layer — familiar 2D tactics\nZ-axis    — rooks/queens control columns\n3D diag   — bishops reach far corners\nKnight    — 24 landing squares in 3D",
    puzzle: null, highlight: null
  },
  {
    section:'cubic_chess',
    title: "You're Ready! ✓",
    text:  "You now know Aurora Chess 4L. The compact 4-layer board makes the AI formidable and tactics sharper. Check adjacent layers for threats and race to reach the back rank for promotion. Good luck!",
    demo: null, puzzle: null, highlight: null
  },

  // ── Arcade Mode ──────────────────────────────────────────────
  {
    section:'arcade',
    title: "What is Arcade Mode?",
    text:  "Arcade Mode adds Power Orbs to the board. Orbs spawn randomly each turn. Move a piece onto an orb to collect it — that piece gains a special power for the rest of the game!",
    demo:   "⚡ ORBS spawn on empty squares\nStep on an orb to collect it\nEach piece type has its own orb color",
    puzzle: null, highlight: null
  },
  {
    section:'arcade',
    title: "The Orbs",
    text:  "GODDESS ORB (queen) — moves all 26 directions. PHANTOM ORB (knight) — invisible for 2 turns. CHAMPION ORB (pawn) — captures forward. SIEGE ORB (rook) — pushes enemies. SPIRIT ORB (bishop) — phases through allies. FREEZE / SPEED — wild effects!",
    demo:   "Gold   = Goddess  (Queen)\nGreen  = Phantom  (Knight)\nLime   = Champion (Pawn)\nRed    = Siege    (Rook)\nPurple = Spirit   (Bishop)\nCyan / Yellow = Wild orbs",
    puzzle: null, highlight: null
  },
  {
    section:'arcade',
    title: "Arcade Settings",
    text:  "Before starting Arcade Mode you can toggle orb types on/off, set spawn rate (Low / Medium / High), enable random events, and configure the laser and regen systems. Experiment to find your preferred chaos level!",
    demo: null, puzzle: null, highlight: null
  },

  // ── Capture the Flag ─────────────────────────────────────────
  {
    section:'ctf',
    title: "What is Capture the Flag?",
    text:  "Each team has a FLAG on their home square. Capture the enemy flag with any piece and carry it to your home row to score. Captured pieces respawn after a few turns — the game keeps going!",
    demo:   "White flag: (4,0,0) — white home row\nBlack flag: (4,7,3) — black home row\nCapture and deliver to win!",
    puzzle: null, highlight: null
  },
  {
    section:'ctf',
    title: "Flag Rules",
    text:  "Move onto the enemy flag square to pick it up. Deliver the flag to your home row (Y=7 for white, Y=0 for black) on any layer to score. If the carrier is captured, the flag drops and can be picked up again.",
    demo:   "Pick up:  move onto the flag square\nCarry:    the piece holds the flag\nDeliver:  reach your home row (any layer)\nDrop:     carrier captured → flag falls",
    puzzle: null, highlight: null
  },
  {
    section:'ctf',
    title: "Respawning",
    text:  "In CTF mode, captured pieces respawn after 4 turns on their starting square. Protect your flag carrier — they are the most important piece. Plan your routes to avoid getting caught!",
    demo: null, puzzle: null, highlight: null
  }
];

let tutStep    = 0;
let tutSection = TUT_SECTIONS[0].id;
const tutOverlay = document.getElementById('tutorialOverlay');

/* ======================================================
   ── PUZZLE SYSTEM FUNCTIONS
====================================================== */
function loadPuzzlePieces(puzData) {
  clearThreatLines();
  for (const k in boardMap) delete boardMap[k];
  pieces.forEach(p => { if (p.parent) p.parent.remove(p); });
  pieces.length = 0;
  movePlates.forEach(m => pivot.remove(m)); movePlates = []; pulsePlates = [];
  if (selPlate) pivot.remove(selPlate); selPlate = null; selectedPawn = null;
  lastMoveSquares.forEach(p => pivot.remove(p)); lastMoveSquares = [];
  reviewArrows.forEach(a => pivot.remove(a)); reviewArrows = [];
  if (startMessageMesh) { pivot.remove(startMessageMesh); startMessageMesh = null; }

  puzData.pieces.forEach(s => {
    const p = buildPiece(s.type, s.color);
    if (!p) return;
    place(p, s.x, s.y, s.z);
    p.userData.moved = !!s.moved;
  });
  turn = puzData.turn || 'white';
  playerColor = puzData.turn || 'white';
  botColor = null;
  moveLog = []; moveNumber = 1; history = []; snapshots = [];
  document.getElementById('movePanel').innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:6px;"><button id="copyMoves" class="copyBtn"><div class="copySq1"></div><div class="copySq2"></div></button></div>`;
  rebuildCopyButton();
  activeZ = 0;
  document.getElementById('zSlider').value = 0;
  update(); coords();
  gameStarted = true; setReviewing(false);
}

function startPuzzle(index, tutKey) {
  const isTut   = (tutKey !== undefined && tutKey >= 0);
  const puzData = isTut ? TUT_PUZZLES[tutKey] : PUZZLES[index];
  if (!puzData) return;

  PUZZLE_MODE       = true;
  PUZZLE_ACTIVE     = isTut ? -1 : index;
  PUZZLE_MOVES_MADE = 0;
  PUZZLE_TUT_KEY    = isTut ? tutKey : -1;
  if (window.Steam && window.Steam.isAvailable) {
    window.Steam.setRichPresence('steam_display', '#Status_Playing');
    window.Steam.setRichPresence('status', isTut ? 'Tutorial' : 'Solving Puzzle #' + (index + 1));
  }

  if (typeof resetArcadeState === 'function') resetArcadeState();
  ['mainMenu','modeMenu','botMenu','tutorialOverlay','puzzleSelectOverlay','endMenu','pauseMenu'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  setGameInputEnabled(true);
  (function(){ const rb = document.getElementById('rotateBoardBtn'); if (rb) rb.style.display='block'; })();
  (function(){ const h=document.getElementById('hintBtn'), u=document.getElementById('undoBtn'); if(h) h.style.display='block'; if(u) u.style.display='block'; })();

  loadPuzzlePieces(puzData);

  document.getElementById('puzzleBarName').textContent   = puzData.name.toUpperCase();
  document.getElementById('puzzleBarStatus').textContent = puzData.objective;
  document.getElementById('puzzleBarName').style.color   = '';
  document.getElementById('hud').textContent = turn.charAt(0).toUpperCase() + turn.slice(1) + ' to move';

  // Show info popup — auto-collapses after 3.5s; toggle button stays visible
  (function() {
    const btn = document.getElementById('puzzleInfoToggle');
    const pop = document.getElementById('puzzleInfoPopup');
    if (btn) btn.style.display = 'block';
    if (pop) {
      pop.style.display = 'block';
      clearTimeout(window._puzzleInfoAutoHide);
      window._puzzleInfoAutoHide = setTimeout(() => {
        if (pop) pop.style.display = 'none';
      }, 3500);
    }
  })();

  setPOV();
  if (isInCheck('white')) {
    document.getElementById('puzzleBarStatus').textContent = '⚠ Your king is in check!';
  }
  SND.confirm();
}

function exitPuzzleMode() {
  PUZZLE_MODE = false; PUZZLE_ACTIVE = -1; PUZZLE_TUT_KEY = -1;
  clearTimeout(window._puzzleInfoAutoHide);
  document.getElementById('puzzleSuccess').style.display = 'none';
  (function(){
    const h=document.getElementById('hintBtn'), u=document.getElementById('undoBtn');
    if(h) h.style.display='none'; if(u) u.style.display='none';
    const btn=document.getElementById('puzzleInfoToggle'), pop=document.getElementById('puzzleInfoPopup');
    if(btn) btn.style.display='none'; if(pop) pop.style.display='none';
  })();
}

function checkPuzzleCondition(puzData, movedPiece, target) {
  if (!puzData) return false;
  const g = puzData.goal;
  if (g === 'checkmate')  return isInCheck('black') && !hasLegalMoves('black');
  if (g === 'check')      return isInCheck('black');
  if (g === 'escape')     return !isInCheck('white');
  if (g === 'pawnMove')   return movedPiece && movedPiece.userData.type === 'pawn';
  if (g === 'knightMove') return movedPiece && movedPiece.userData.type === 'knight';
  if (g === 'capture')    return (target && puzData.targetAt &&
                            target.x === puzData.targetAt.x &&
                            target.y === puzData.targetAt.y &&
                            target.z === puzData.targetAt.z);
  if (g === 'any')        return true;
  return false;
}

function showPuzzleSuccess(puzData) {
  const solvedKey = PUZZLE_TUT_KEY >= 0 ? 't' + PUZZLE_TUT_KEY : 'm' + PUZZLE_ACTIVE;
  PUZZLE_SOLVED.add(solvedKey);
  _saveSolved();
  // Steam achievement on first puzzle solve
  if (window.Steam && window.Steam.isAvailable) {
    window.Steam.unlockAchievement('FIRST_PUZZLE');
    const totalSolved = [...PUZZLE_SOLVED].filter(k => k[0] === 'm').length;
    if (totalSolved >= 10)  window.Steam.unlockAchievement('PUZZLES_10');
    if (totalSolved >= 50)  window.Steam.unlockAchievement('PUZZLES_50');
  }

  clearTimeout(window._puzzleInfoAutoHide);
  const _infoP = document.getElementById('puzzleInfoPopup'); if (_infoP) _infoP.style.display = 'none';
  const el = document.getElementById('puzzleSuccess');
  document.getElementById('puzSuccessTitle').textContent = puzData.name.toUpperCase();
  document.getElementById('puzSuccessDesc').textContent  = 'Solved! ' + puzData.objective;

  const nextBtn  = document.getElementById('puzSuccessNext');
  const menuBtn2 = document.getElementById('puzSuccessMenu');

  if (PUZZLE_TUT_KEY >= 0) {
    const returnStep = PUZZLE_TUT_KEY + 1;
    nextBtn.textContent = 'Back to Tutorial ▶';
    nextBtn.onclick = () => {
      el.style.display = 'none';
      exitPuzzleMode();
      setGameInputEnabled(false);
      tutStep = returnStep < TUTS.length ? returnStep : TUTS.length - 1;
      tutOverlay.style.display = 'flex';
      renderTutStep();
    };
  } else {
    const nextIdx = PUZZLE_ACTIVE + 1;
    nextBtn.textContent = nextIdx < PUZZLES.length ? 'Next Puzzle ▶' : 'Puzzle List';
    nextBtn.onclick = () => {
      el.style.display = 'none';
      exitPuzzleMode();
      if (nextIdx < PUZZLES.length) startPuzzle(nextIdx);
      else showPuzzleSelect();
    };
  }
  menuBtn2.onclick = () => {
    el.style.display = 'none';
    exitPuzzleMode();
    showPuzzleSelect();
    const rb = document.getElementById('rotateBoardBtn');
    if (rb) rb.style.display = 'none';
  };
  el.style.display = 'flex';
  SND.end(true); HAP.vib('check');
}

// Wrap executeMove to add puzzle hooks
const _origExecuteMove = executeMove;
executeMove = function(piece, moveTarget) {
  const prevOcc = occ(moveTarget.x, moveTarget.y, moveTarget.z);
  _origExecuteMove.call(this, piece, moveTarget);
  if (!PUZZLE_MODE) return;
  PUZZLE_MOVES_MADE++;
  const puzData = PUZZLE_TUT_KEY >= 0 ? TUT_PUZZLES[PUZZLE_TUT_KEY] : PUZZLES[PUZZLE_ACTIVE];
  if (!puzData) return;
  setTimeout(() => {
    const captureProxy = prevOcc ? { x: moveTarget.x, y: moveTarget.y, z: moveTarget.z } : null;
    if (checkPuzzleCondition(puzData, piece, captureProxy)) {
      showPuzzleSuccess(puzData);
    } else if (puzData.movesAllowed && PUZZLE_MOVES_MADE >= puzData.movesAllowed) {
      document.getElementById('puzzleBarStatus').textContent = '✗ Try again — ' + puzData.objective;
      document.getElementById('puzzleBarName').style.color = '#ff6666';
      // Briefly show the popup so the fail message is visible
      const _failPop = document.getElementById('puzzleInfoPopup');
      if (_failPop) {
        _failPop.style.display = 'block';
        clearTimeout(window._puzzleInfoAutoHide);
        window._puzzleInfoAutoHide = setTimeout(() => { if(_failPop) _failPop.style.display='none'; }, 3500);
      }
      SND.ui();
    }
  }, 350);
};

/* ── Puzzle select with category + difficulty filter ── */
let _puzzleFilterCat  = 'all';
let _puzzleFilterDiff = 'all';

function showPuzzleSelect() {
  document.getElementById('puzzleSelectOverlay').style.display = 'flex';
  // Double-RAF: first frame processes display:flex, second frame has stable grid width
  requestAnimationFrame(() => requestAnimationFrame(_renderPuzzleList));
}

function _renderPuzzleList() {
  const list = document.getElementById('puzzleList');
  list.innerHTML = '';

  const solvedCount = PUZZLES.filter(p => PUZZLE_SOLVED.has('m' + p.id)).length;
  document.getElementById('puzzleSolvedCount').textContent = solvedCount + ' / ' + PUZZLES.length + ' SOLVED';

  // Highlight active filter buttons
  document.querySelectorAll('[data-puz-cat]').forEach(b => {
    const on = b.dataset.puzCat === _puzzleFilterCat;
    b.style.color       = on ? '#fff' : '#555';
    b.style.borderColor = on ? '#555' : '#252525';
  });
  document.querySelectorAll('[data-puz-diff]').forEach(b => {
    const on = b.dataset.puzDiff === _puzzleFilterDiff;
    b.style.color       = on ? '#fff' : '#555';
    b.style.borderColor = on ? '#555' : '#252525';
  });

  const filtered = PUZZLES.filter(p => {
    const catOk  = _puzzleFilterCat  === 'all' || p.category  === _puzzleFilterCat;
    const diffOk = _puzzleFilterDiff === 'all' || p.difficulty === _puzzleFilterDiff;
    return catOk && diffOk;
  });

  if (!filtered.length) {
    list.innerHTML = '<div style="padding:24px;color:#444;font-size:11px;text-align:center;">No puzzles match this filter.</div>';
    return;
  }

  // Find first unsolved puzzle in the filtered list for progress indicator
  const firstUnsolved = filtered.find(p => !PUZZLE_SOLVED.has('m' + p.id));
  let nextCard = null;

  filtered.forEach(p => {
    const solved  = PUZZLE_SOLVED.has('m' + p.id);
    const isNext  = firstUnsolved && p.id === firstUnsolved.id;
    const borderCol = solved ? '#335533' : isNext ? '#ce93d8' : '#252525';
    const card   = document.createElement('div');
    card.style.cssText = 'background:#0e0e0e;border:1px solid ' + borderCol + ';padding:12px 10px;cursor:pointer;border-radius:2px;transition:border-color 0.15s;position:relative;';
    const diffColor = {beginner:'#44ff88', intermediate:'#ffaa00', advanced:'#ff6644'}[p.difficulty] || '#555';
    const badge = isNext ? '<div style="position:absolute;top:6px;right:6px;font-size:8px;color:#ce93d8;letter-spacing:1px;">▶ NEXT</div>' : '';
    card.innerHTML =
      badge
      + `<div style="font-size:9px;color:${solved ? '#44ff88' : isNext ? '#ce93d8' : '#555'};letter-spacing:1px;margin-bottom:4px;">${solved ? '✓ SOLVED' : '#' + (p.id + 1)}</div>`
      + `<div style="font-size:13px;margin-bottom:4px;">${p.name}</div>`
      + `<div style="font-size:9px;color:${diffColor};letter-spacing:1px;margin-bottom:4px;">${(p.difficulty || '').toUpperCase()}</div>`
      + `<div style="font-size:10px;color:#555;line-height:1.5;">${p.objective}</div>`;
    card.onmouseenter = () => { card.style.borderColor = solved ? '#44ff88' : isNext ? '#e0b0ff' : '#555'; };
    card.onmouseleave = () => { card.style.borderColor = borderCol; };
    card.onclick = () => {
      document.getElementById('puzzleSelectOverlay').style.display = 'none';
      startPuzzle(p.id);
    };
    list.appendChild(card);
    if (isNext) nextCard = card;
  });

  // Scroll the next puzzle into view
  if (nextCard) nextCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

document.getElementById('closePuzzleSelect').onclick = () => {
  SND.ui();
  document.getElementById('puzzleSelectOverlay').style.display = 'none';
  document.getElementById('mainMenu').style.display = 'flex';
};
function doPuzzleUndo() {
  const puzData = PUZZLE_TUT_KEY >= 0 ? TUT_PUZZLES[PUZZLE_TUT_KEY] : PUZZLES[PUZZLE_ACTIVE];
  if (!puzData) return;
  if (history.length <= 1) {
    PUZZLE_MOVES_MADE = 0;
    loadPuzzlePieces(puzData);
    document.getElementById('puzzleBarName').textContent   = puzData.name.toUpperCase();
    document.getElementById('puzzleBarStatus').textContent = puzData.objective;
    document.getElementById('puzzleBarName').style.color   = '';
    document.getElementById('hud').textContent = puzData.turn.charAt(0).toUpperCase() + puzData.turn.slice(1) + ' to move';
    SND.ui();
    return;
  }
  const prevLen = history.length;
  doUndo();
  if (history.length < prevLen) {
    PUZZLE_MOVES_MADE = Math.max(0, PUZZLE_MOVES_MADE - 1);
    document.getElementById('puzzleBarStatus').textContent = puzData.objective;
    document.getElementById('puzzleBarName').style.color   = '';
  }
}
// Wire puzzle info toggle button
(function() {
  const btn = document.getElementById('puzzleInfoToggle');
  const pop = document.getElementById('puzzleInfoPopup');
  if (btn && pop) {
    btn.addEventListener('click', () => {
      clearTimeout(window._puzzleInfoAutoHide);
      pop.style.display = pop.style.display === 'none' ? 'block' : 'none';
    });
  }
})();

// Highlight (pulse) the piece that needs to move next in the puzzle solution.
// Tracks PUZZLE_MOVES_MADE so multi-move hints stay accurate throughout.
function flashHintPiece(puzData) {
  if (!puzData || !puzData.solution) return;
  const moveIdx = PUZZLE_MOVES_MADE;
  if (moveIdx >= puzData.solution.length) return;
  const from = puzData.solution[moveIdx].from;
  // Switch to the piece's layer so it's fully visible regardless of where user is
  if (typeof jumpToLayer === 'function') jumpToLayer(from.z);
  const piece = occ(from.x, from.y, from.z);
  if (!piece) return;

  const meshes = [];
  piece.traverse(o => {
    if (o.isMesh && !o.userData.isOutline && !o.userData.isHighlightEffect) meshes.push(o);
  });
  if (!meshes.length) return;

  const origEmissives = meshes.map(m => ({
    r: m.material.emissive ? m.material.emissive.r : 0,
    g: m.material.emissive ? m.material.emissive.g : 0,
    b: m.material.emissive ? m.material.emissive.b : 0,
    i: m.material.emissiveIntensity || 0
  }));

  const duration = 2400;
  const start = performance.now();

  function _pulse() {
    const elapsed = performance.now() - start;
    if (elapsed > duration) {
      meshes.forEach((m, i) => {
        if (m.material.emissive) m.material.emissive.setRGB(origEmissives[i].r, origEmissives[i].g, origEmissives[i].b);
        m.material.emissiveIntensity = origEmissives[i].i;
      });
      return;
    }
    const t = elapsed / duration;
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 8); // ~4 pulses over 2.4s
    meshes.forEach(m => {
      if (m.material.emissive) m.material.emissive.setRGB(1, 0.65, 0.1);
      m.material.emissiveIntensity = pulse * 2.2;
    });
    requestAnimationFrame(_pulse);
  }
  _pulse();
}

document.getElementById('puzzleShareBtn').onclick = () => {
  if (!PUZZLE_MODE || PUZZLE_ACTIVE < 0) return;
  const puzzleNum = PUZZLE_ACTIVE + 1;
  const base = window.location.protocol === 'file:'
    ? window.location.href.split('?')[0]
    : (window.location.origin + window.location.pathname);
  const url = base + '?puzzle=' + puzzleNum;
  navigator.clipboard.writeText(url).then(() => {
    showBoardMsg({ text: 'LINK COPIED!', color: '#00ff88', size: 44, dur: 2, anim: 'fade', layer: 'current', glow: true });
  }).catch(() => {
    showBoardMsg({ text: '?puzzle=' + puzzleNum, color: '#ffaa00', size: 36, dur: 4, anim: 'fade', layer: 'current', glow: false });
  });
  SND.ui();
};
// Filter button wiring — buttons rendered in index.html with data-puz-cat / data-puz-diff
document.querySelectorAll('[data-puz-cat]').forEach(btn => {
  btn.onclick = () => { SND.ui(); _puzzleFilterCat = btn.dataset.puzCat; _renderPuzzleList(); };
});
document.querySelectorAll('[data-puz-diff]').forEach(btn => {
  btn.onclick = () => { SND.ui(); _puzzleFilterDiff = btn.dataset.puzDiff; _renderPuzzleList(); };
});

/* ======================================================
   ── TUTORIAL SYSTEM
====================================================== */
function openTutorial(sectionId) {
  if (sectionId) tutSection = sectionId;
  const firstIdx = TUTS.findIndex(s => s.section === tutSection);
  tutStep = firstIdx >= 0 ? firstIdx : 0;
  tutOverlay.style.display = 'flex';
  renderTutStep();
  SND.ui();
}

function _stepsForSection(sectionId) {
  return TUTS.reduce((acc, s, i) => { if (s.section === sectionId) acc.push(i); return acc; }, []);
}

function renderTutStep() {
  const step = TUTS[tutStep];
  tutSection = step.section;

  // Section tab highlighting
  TUT_SECTIONS.forEach(sec => {
    const btn = document.getElementById('tutTab_' + sec.id);
    if (!btn) return;
    const active = sec.id === tutSection;
    btn.style.color       = active ? '#fff'     : '#555';
    btn.style.borderColor = active ? '#444'     : 'transparent';
    btn.style.background  = active ? '#1a1a1a'  : 'none';
  });

  // Step label within section
  const secSteps = _stepsForSection(tutSection);
  const posInSec = secSteps.indexOf(tutStep) + 1;
  document.getElementById('tutStepLabel').textContent =
    step.section.replace('_', ' ').toUpperCase() + '  ' + posInSec + ' / ' + secSteps.length;

  document.getElementById('tutTitle').textContent = step.title;
  document.getElementById('tutText').textContent  = step.text;

  const demoDiv = document.getElementById('tutDemo');
  if (step.demo) {
    demoDiv.style.display = 'block';
    demoDiv.innerHTML = '<pre style="background:#111;border:1px solid #2a2a2a;padding:12px;border-radius:2px;font-size:11px;line-height:1.8;color:#aaa;margin:0;overflow:auto;">' + step.demo + '</pre>';
  } else {
    demoDiv.style.display = 'none';
  }

  const puzBox = document.getElementById('tutPuzzleBox');
  if (step.puzzle) {
    puzBox.style.display = 'block';
    document.getElementById('tutPuzzleText').textContent = step.puzzle.text;
    document.getElementById('tutPuzzleStart').onclick = () => {
      SND.confirm();
      tutOverlay.style.display = 'none';
      document.getElementById('tutHighlightRing').style.display = 'none';
      startPuzzle(-1, step.puzzle.tutKey);
    };
  } else {
    puzBox.style.display = 'none';
  }

  const ring = document.getElementById('tutHighlightRing');
  if (step.highlight) {
    const el = document.getElementById(step.highlight);
    if (el) {
      const r = el.getBoundingClientRect();
      ring.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #00ffff;border-radius:4px;box-shadow:0 0 18px rgba(0,255,255,0.35);z-index:91;transition:all 0.25s;display:block;'
        + 'left:' + (r.left-6) + 'px;top:' + (r.top-6) + 'px;width:' + (r.width+12) + 'px;height:' + (r.height+12) + 'px;';
    }
  } else {
    ring.style.display = 'none';
  }

  // Progress dots (within this section only, clickable)
  const dots = document.getElementById('tutDots');
  dots.innerHTML = '';
  secSteps.forEach(idx => {
    const d = document.createElement('div');
    d.style.cssText = 'width:6px;height:6px;border-radius:50%;background:' + (idx === tutStep ? '#fff' : '#333') + ';transition:background 0.2s;cursor:pointer;';
    d.onclick = () => { tutStep = idx; renderTutStep(); };
    dots.appendChild(d);
  });

  document.getElementById('tutPrev').style.opacity = tutStep === 0 ? '0.3' : '1';
  document.getElementById('tutNext').textContent   = tutStep === TUTS.length - 1 ? 'FINISH ✓' : 'NEXT ▶';
}

document.getElementById('tutNext').onclick = () => {
  SND.ui();
  if (tutStep >= TUTS.length - 1) {
    tutOverlay.style.display = 'none';
    document.getElementById('tutHighlightRing').style.display = 'none';
    return;
  }
  tutStep++; renderTutStep();
};
document.getElementById('tutPrev').onclick = () => {
  SND.ui();
  if (tutStep === 0) return;
  tutStep--; renderTutStep();
};
document.getElementById('tutSkip').onclick = () => {
  SND.ui();
  tutOverlay.style.display = 'none';
  document.getElementById('tutHighlightRing').style.display = 'none';
};
document.getElementById('closeTutorial').onclick = () => {
  SND.ui();
  tutOverlay.style.display = 'none';
  document.getElementById('tutHighlightRing').style.display = 'none';
};

// Section tab onclick (buttons rendered in index.html as id="tutTab_<sectionId>")
TUT_SECTIONS.forEach(sec => {
  const btn = document.getElementById('tutTab_' + sec.id);
  if (btn) btn.onclick = () => { SND.ui(); openTutorial(sec.id); };
});

/* ======================================================
   ── MENU BUTTON WIRING — Puzzle / Tutorial
====================================================== */
document.getElementById('openTutorialBtn').onclick = () => {
  SND.confirm();
  document.getElementById('mainMenu').style.display = 'none';
  openTutorial();
};
document.getElementById('openPuzzleBtn').onclick = () => {
  SND.confirm();
  document.getElementById('mainMenu').style.display = 'none';
  showPuzzleSelect();
};
document.getElementById('openPuzzleSelectBtn').onclick = () => {
  SND.confirm();
  document.getElementById('mainMenu').style.display = 'none';
  showPuzzleSelect();
};
document.getElementById('pauseTutorialBtn').onclick = () => {
  SND.ui();
  document.getElementById('pauseMenu').style.display = 'none';
  openTutorial();
};

/* ======================================================
   ── MENU BUTTON WIRING — Game Modes / Arcade / CTF
   TODO: migrate these to 14_features.js, 09_arcade.js, 15_ctf.js
   once the cross-file module bleed is resolved.
====================================================== */
document.getElementById('gameModesBtn').onclick = () => {
  SND.ui();
  document.getElementById('mainMenu').style.display = 'none';
  document.getElementById('gameModesMenu').style.display = 'flex';
};
document.getElementById('gameModesBackBtn').onclick = () => {
  SND.ui();
  document.getElementById('gameModesMenu').style.display = 'none';
  document.getElementById('mainMenu').style.display = 'flex';
};
document.getElementById('gmStandardBtn').onclick = () => {
  SND.confirm();
  document.getElementById('gameModesMenu').style.display = 'none';
  arcadeSettings.enabled = false;
  ctfMode = false;
  document.getElementById('modeMenu').style.display = 'flex';
};
document.getElementById('gmArcadeBtn').onclick = () => {
  SND.ui();
  document.getElementById('gameModesMenu').style.display = 'none';
  arcadeSettings.enabled = true;
  ctfMode = false;
  updateArcadeMenuUI();
  document.getElementById('arcadeMenu').style.display = 'flex';
};
document.getElementById('gmCTFBtn').onclick = () => {
  SND.ui();
  document.getElementById('gameModesMenu').style.display = 'none';
  arcadeSettings.enabled = false;
  ctfMode = true;
  document.getElementById('ctfMenu').style.display = 'flex';
};
document.getElementById('ctfBackBtn').onclick = () => {
  SND.ui();
  document.getElementById('ctfMenu').style.display = 'none';
  document.getElementById('gameModesMenu').style.display = 'flex';
};
document.querySelectorAll('[data-ctf-diff]').forEach(btn => {
  btn.onclick = () => {
    SND.ui(); botDifficulty = btn.dataset.ctfDiff;
    const depthMap = { easy: 0, medium: 1, hard: 2 };
    botDepth = depthMap[btn.dataset.ctfDiff] ?? 1;
    document.querySelectorAll('[data-ctf-diff]').forEach(b => {
      const on = b.dataset.ctfDiff === botDifficulty;
      b.style.borderColor = on ? '#ff6600' : '#1a1a1a';
      b.style.color       = on ? '#ff6600' : '#555';
    });
  };
});
var _ctfPts = 1;
document.querySelectorAll('[data-ctf-pts]').forEach(btn => {
  btn.onclick = () => {
    SND.ui(); _ctfPts = parseInt(btn.dataset.ctfPts);
    document.querySelectorAll('[data-ctf-pts]').forEach(b => {
      const on = parseInt(b.dataset.ctfPts) === _ctfPts;
      b.style.borderColor = on ? '#ff6600' : '#1a1a1a';
      b.style.color       = on ? '#ff6600' : '#555';
    });
  };
});
document.querySelectorAll('[data-ctf-start]').forEach(btn => {
  btn.onclick = () => {
    SND.confirm();
    document.getElementById('ctfMenu').style.display = 'none';
    CTF.pointTarget = _ctfPts;
    if (btn.dataset.ctfStart === 'local') {
      botColor = null; playerColor = 'white';
    } else {
      playerColor = 'white'; botColor = 'black';
    }
    startLocalGame();
    if (botColor === 'black') setTimeout(botMove, 400);
  };
});


