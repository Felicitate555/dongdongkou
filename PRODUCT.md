# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Primary users: people with limited upper-limb mobility who need an alternative way to operate a computer.
- Secondary users: older adults who find mouse and keyboard interactions difficult.
- Evaluation users: hackathon judges and visitors who need to understand and try the two operating modes quickly.

## Product Purpose

动动口 lets a person move a pointer with head motion and use mouth gestures or voice to interact with a computer. It has two equally important experiences: a local mode that can control the computer running the Python service, and a public web mode that demonstrates hands-free interaction inside the site.

## Positioning

The product combines on-device face tracking with mouth and voice interaction so users can choose a hands-free way to control a local computer or try a self-contained web demonstration.

## Operating Context

- Local use starts through `run.py` or `启动.bat`; the browser connects to the Python service on the same computer.
- Public visitors use the hosted site over HTTPS and can try the web-only demonstration without installing the local controller.
- Hackathon evaluation must make both modes understandable and usable without implying that a cloud server can control a visitor's computer.

## Capabilities and Constraints

- Existing stack: static HTML/CSS/JavaScript, FastAPI, MediaPipe FaceLandmarker, and optional PyAutoGUI system control.
- Keep the local MediaPipe model available without a required external CDN.
- Keep the system-control default disabled and distinguish local computer control from public web-only control.
- The user has explicitly removed the requirement to lock onto a target before mouth clicks. Improve free pointer accuracy and feedback without reinstating that gate.
- MiMo vision support is optional. Cloud credentials belong in environment configuration and must not be embedded in deployable source or demo packages.
- Existing routes include `/`, `/console.html`, `/demo.html`, and `/architecture.html`; preserve working entry points unless the implementation has a clear migration path.
- Do not claim official Tmall integration or a real purchase/appointment when a scene uses simulated data.

## Brand Commitments

- Product name: 动动口.
- Interface language: Simplified Chinese.
- Preserve the current home page as the visual reference; improve the secondary pages to feel like one product.

## Evidence on Hand

- The user reports that system mouse control has worked on their own computer.
- Source code, local MediaPipe assets, demo scenes, and project documentation are present in the workspace.
- No measured multi-user accessibility study, success-rate benchmark, testimonial, or production deployment evidence is present. Future work must not fabricate these.

## Product Principles

1. Make local system control and hosted web demonstration distinct at every entry point.
2. Keep the core interaction available without cloud AI.
3. Make pointer movement, clicking, listening, and recovery states easy to understand.
4. Keep simulated actions visibly labeled as demonstrations.
5. Favor stable, low-effort interaction for the intended users.

## Accessibility & Inclusion

- Design for people with limited upper-limb mobility and older adults.
- Keep important targets large, provide visible keyboard focus, support reduced motion, and offer voice or visible-button recovery paths.
- Direct mouth clicks remain available without a mandatory target-lock or magnetic-snap step.
