# 动动口 · 本机控制与公网演示完整升级实施计划

> **For agentic workers:** Use inline execution with review checkpoints; keep each change isolated and update this checklist as it lands.

**Goal:** Make 动动口 a trustworthy hackathon demo with equally visible local computer control and hosted web-only interaction, accurate pointer clicks, coherent secondary pages, and a deployment package that keeps credentials and machine-control APIs private.

**Architecture:** Keep the existing FastAPI and static HTML/JS stack. Make deployment mode explicit so public mode can never invoke host mouse/keyboard control, bind local control to loopback by default, bound and disclose image analysis, and keep the browser's local MediaPipe loop independent of the backend. Retain route names and local model assets.

**Tech Stack:** Python 3, FastAPI, pytest/TestClient-compatible smoke checks, vanilla HTML/CSS/ES modules, local MediaPipe, optional MiMo vision.

---

## File map

- `server/config.py`, `server/main.py`, `server/ai_assist.py`: deployment mode, local-control guard, request size/rate limits, AI disclosure metadata.
- `static/js/control-runtime.js`, `static/js/cursor-controller.js`, `static/js/console.js`, `static/js/ai-panel.js`: camera cleanup, direct-click precision/feedback, mode and error state, truthful AI screenshot flow.
- `static/console.html`, `static/demo.html`, `static/architecture.html`, `static/css/console.css`, `static/css/demo.css`, `static/css/arch.css`, `static/css/global.css`: selected console workbench layout and consistent secondary-page hierarchy/states; keep the homepage as visual authority.
- `scripts/smoke_test.py`, `tests/*`: regression coverage. System-control tests must replace the mouse adapter before exercising enabled endpoints so no test moves the real pointer.
- `.dockerignore`, `.env.example`, `Dockerfile`, `docker-compose.yml`: reproducible hosted web-only deployment with secrets and local environments excluded.
- `README.md`, `docs/部署手册.md`, `docs/项目交接说明.md`, `验收清单.md`: accurate local/public operating instructions, privacy and deploy steps, current interaction semantics.

## Task 1: Establish safe local and public modes

- Add a deployment-mode setting with local-loopback defaults and a hard public-mode prohibition on system mouse/keyboard APIs, including when an override environment variable is present.
- Add a first failing API regression for public-mode system control and image request bounds; then implement mode-aware health reporting and server-side guards.
- Bound encoded screenshots and implement a small per-client AI request window; return clear 413/429 responses without logging screenshot contents.
- Make enabled-control tests patch the mouse/keyboard adapters and assert endpoint dispatch without touching OS devices.

## Task 2: Repair core interaction and honest recovery

- Add focused regressions for direct clicks independent of `lockedTarget`, camera model-init cleanup, and duplicate camera-error UI handling.
- Preserve pointer coordinates on the stage; keep target cycling only as an optional voice convenience, never as a prerequisite to mouth click.
- Clear MediaStream tracks and `srcObject` on tracker initialization failure and stop/retry; prevent duplicate streams during repeated starts.
- Make AI screenshots use the actual visible app surface where supported, bound image size, disclose remote processing before sending, and accurately distinguish MiMo semantic recognition from local contour-based experimental fallback.
- Improve click confirmation/failure text and remove stale “magnet snap” wording and controls.

## Task 3: Rebuild secondary-page hierarchy

- Keep the current left-tools + broad-center-stage skeleton; refine it as a workbench with an equal-weight mode strip, compact runtime status, and better grouped controls. Collapse tool groups structurally on tablet/mobile.
- Add equally prominent local-control and web-only demonstration descriptions/entry points. Never imply hosted service can control a visitor's OS.
- Align demo and architecture pages to the homepage's charcoal/cyan/violet visual language; mark simulated news, shopping, and appointment actions clearly; keep all existing scenario flows and routes.
- Check focus, reduced-motion, touch target sizes, error/loading/empty states, and Chinese copy at desktop and narrow widths.

## Task 4: Make a safe cloud handoff

- Add a container build/deployment path with public mode forced, local secrets/modules/venvs/logs excluded, health check, and environment-only `QWEN_API_KEY`.
- Correct the stale Qwen/DashScope documentation to MiMo configuration and give the Aliyun HTTPS/reverse-proxy steps. Do not provision a server or buy a domain in this code pass.
- Update README, handoff notes, acceptance checklist, and demo privacy language to match the actual implementation.

## Task 5: Unified verification and finish review

- Run the existing smoke suite only after OS mouse calls are safely isolated; run the geometry and Python checks and syntax-check changed browser modules.
- Start the app locally and inspect health/routes; review desktop/mobile browser renders if a usable browser surface is available, otherwise document the exact visual-verification limit.
- Run Impeccable's detector once on the changed HTML/CSS targets, then make one batched correction pass.
- Have a separate finish reviewer compare the built pages and behavior against the user-approved workbench direction, `PRODUCT.md`, and these constraints; address any actionable findings before stopping.

## Completion checklist

- [x] Public mode cannot perform host mouse/keyboard control, even with a local-control override.
- [x] Local mode can still request full control explicitly and advertises that distinction in the UI.
- [x] Mouth-click does not require target lock or snapping; coordinate mapping and click feedback are checked.
- [x] Camera initialization failures release streams; AI map privacy and empty/error states are clear.
- [x] Console/demo/architecture pages were checked at desktop and 390px widths; narrow layouts fit without horizontal overflow.
- [x] Deployment artifacts exclude `server/local_secrets.py`, `.env`, logs, and virtual environments; Docker itself is unavailable here, so image build remains unverified.
- [x] Safety-isolated smoke/regression checks pass and Impeccable detector ran once; live render review used Edge/Chrome browser surfaces.
- [x] Independent finish review resolved mobile stage visibility, collapsed secondary controls, voice error/retry state, live status announcements, and nested panel treatment.
- [x] Final source and handoff docs are saved before the user's requested shutdown.
