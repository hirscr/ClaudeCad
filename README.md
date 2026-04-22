# ClaudeCAD

AI-powered semi-parametric CAD for 3D printing. Describe what you want to build in plain English — ClaudeCAD generates the geometry, runs it through a CAD engine, and renders the result in a 3D viewport. Iterate by continuing the conversation.

![ClaudeCAD screenshot placeholder](docs/screenshot.png)

---

## How it works

1. Type a prompt: *"Make a 40x20x10mm box with a 5mm hole through the center"*
2. Claude generates [Build123d](https://github.com/gumyr/build123d) Python code
3. A warm Python subprocess executes the code and exports a mesh
4. The mesh loads into a Three.js viewport — rotate, zoom, inspect
5. Keep chatting to refine the model
6. Export to STL when done

---

## Requirements

- **macOS** (current builds target macOS only)
- **Node.js** 18+
- **Python** 3.10+
- **Claude Code CLI** — must be installed and authenticated
- **Build123d** Python library

### Install Build123d

```bash
pip install build123d
```

### Install Claude Code CLI

Follow the setup guide at [claude.ai/code](https://claude.ai/code). After installing, run `claude` once to authenticate.

---

## Getting started

```bash
git clone https://github.com/hirscr/ClaudeCad.git
cd ClaudeCad
npm install
npm start
```

That's it. The app builds and launches.

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| 3D viewport | Three.js |
| CAD engine | Build123d (Python) |
| CAD kernel | OpenCASCADE |
| AI | Claude Code CLI |

---

## Project structure

```
src/
  main/
    main.js              # Electron main process, IPC, subprocess orchestration
    claude-manager.js    # Claude CLI subprocess management
    python-manager.js    # Python/Build123d subprocess management
  renderer/
    index.html           # App shell
    renderer.js          # Three.js viewport, chat UI
    styles.css
  python/
    cad_engine.py        # Build123d execution harness
```

---

## Contributing

See [`ClaudeCAD-Specification.md`](ClaudeCAD-Specification.md) for architecture detail and [`roadmap.md`](roadmap.md) for planned features.

Pull requests welcome. Keep changes focused — one feature or fix per PR.

---

## License

MIT
