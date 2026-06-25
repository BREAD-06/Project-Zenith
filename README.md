# 🌌 Project Zenith — The Celestial Eye

> Real-time celestial tracking web app built for the **AstralWeb Innovate** track, **Aaruush '26**.
> **Team Cipher** — Aryan · Ashraf Khan

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![CesiumJS](https://img.shields.io/badge/CesiumJS-1.129-blue?logo=cesium)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8?logo=tailwindcss)

---

## ✨ What is Zenith?

Zenith is an interactive 3D globe application that tracks satellites, the ISS, and planets in real time. Its core innovation is the **Zenith Window** — a translucent radar cone rendered on a CesiumJS globe that highlights celestial objects at **75°–90° topocentric altitude** (nearly directly overhead from the observer's location).

It pairs the live-tracking globe with a dedicated **Constellation Viewer** that uses your real location to figure out which constellation is directly above you right now.

---

## 🌟 Website Functionality & Unique Features

### The globe (`/`)

- 🌍 **Interactive 3D Globe** — Powered by CesiumJS with full rotation, zoom, and tilt, real Bing satellite imagery, dynamic day/night lighting, and an atmosphere.
- 📡 **Live Satellite Tracking** — ~10,000 objects from CelesTrak TLEs, propagated with SGP4 in a **Web Worker** so the UI never stutters. Markers are batched into Cesium primitive collections for performance.
- 🛰️ **ISS Tracking** — Real-time ISS position overlaid from the OpenNotify API (falls back to its SGP4 position if the API is down).
- 🪐 **Solar System Orrery** — Zoom out past the satellites and the Sun, planets, and Moon appear as animated 3D bodies orbiting the fixed Earth (NASA Horizons ephemeris).
- 🎯 **Zenith Window** — A breathing translucent cone marks the 75°–90° overhead shell; objects inside it are brightened, labelled, and given glowing orbital trails.
- 🛰️ **3D Object Tracking** — Click a satellite or the ISS to lock the camera onto a third-person 3D model (`.glb`) that follows it across the sky.
- ⏱️ **Time Machine** — Scrub the propagation clock forward (Now → +24h) to preview where everything will be.
- 🔭 **Pass Predictions** — Per-object upcoming-pass times, computed by stepping SGP4 in the worker.
- 🔍 **Search & Observer Picker** — Search any tracked object, and set your viewing location by city search, browser geolocation, or manual lat/lng.

### The Constellation Viewer (`/constellations`) — the standout feature

A fully self-contained second CesiumJS scene (isolated from the globe so it never affects its frame rate):

- 🧭 **Location-aware "what's overhead"** — Uses **browser geolocation** to compute the constellation closest to your **zenith** (90° straight up) right now, via local sidereal time. It's flagged with a live **ZENITH** badge.
- 📜 **Constellation side menu** — All 20 major constellations, ranked by altitude (nearest the zenith first), with below-horizon ones dimmed. Click any to fly to it.
- 🌠 **Immersive fly-in** — Selecting a constellation flies the camera into it, lights up its stick figure, fades the rest, and drops a 2,000-star backdrop.
- ⭐ **Real star data** — Bright stars (J2000 RA/Dec from the Hipparcos / Yale Bright Star Catalogue) drawn at magnitude-scaled sizes with named labels.
- 📖 **Mythology panel** — Name, abbreviation, OVERHEAD/NEAREST status, one-line mythology, and the brightest stars with magnitudes.

### Under the hood

- 📊 **Zustand state management** — Reactive, real-time UI updates with fine-grained subscriptions.
- ⚡ **Render-on-demand** — Both Cesium scenes only redraw when something changes, keeping idle GPU/CPU cost low.
- 📱 **Responsive, modern UI** — Glassmorphism panels, animated CTAs, and a mobile-friendly layout.

---

## 📋 Prerequisites

Before you begin, make sure you have the following installed:

| Tool | Version | Download |
|------|---------|----------|
| **Node.js** | 18.x or later | [nodejs.org](https://nodejs.org/) |
| **npm** | 9.x or later (comes with Node.js) | — |
| **Git** | Any recent version | [git-scm.com](https://git-scm.com/) |

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/BREAD-06/Project-Zenith.git
cd Project-Zenith/zenith
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env.local` file in the `zenith/` directory:

```bash
cp .env.local.example .env.local
```

Or manually create `.env.local` with the following content:

```env
# Get your free token at https://ion.cesium.com/tokens
NEXT_PUBLIC_CESIUM_ION_TOKEN=your_cesium_token_here
```

#### How to get a Cesium Ion Token (free):

1. Go to [https://ion.cesium.com/signup](https://ion.cesium.com/signup) and create a free account
2. Navigate to **Access Tokens** in your dashboard
3. Copy your **Default Token** (or create a new one)
4. Paste it into your `.env.local` file

### 4. Run the development server

```bash
npm run dev
```

### 5. Open the app

Visit [http://localhost:3000](http://localhost:3000) in your browser. You should see a 3D globe with real-time celestial tracking!

**Routes:**

| Path | What it shows |
|------|---------------|
| `/` | Landing overlay → main tracking globe |
| `/explore` | Jumps straight to the globe (skips the landing) |
| `/constellations` | The Constellation Viewer (also reachable via the ✦ Constellations button in the top bar) |

> **💡 Tip:** Append `?dev=true` to the URL (e.g., `http://localhost:3000?dev=true`) to enable the **Dev Seed Button**, which populates the globe with sample satellite data for testing.
>
> **📍 Tip:** The Constellation Viewer asks for **location permission** to find the constellation directly overhead you. If you decline, it falls back to a default location (or `?lat=&lng=` URL params).

---

## 🔨 Recreating From Scratch (Optional)

> **You do NOT need this section if you cloned the repo.** `npm install` already handles everything via `package.json`. This is only for reference — it documents exactly how the project was originally scaffolded.

### Step 1 — Scaffold the Next.js app

```bash
npx create-next-app@latest zenith --typescript --tailwind --app --no-eslint
cd zenith
```

### Step 2 — Install project dependencies

```bash
npm install cesium copy-webpack-plugin satellite.js zustand @google/model-viewer
```

| Package | Purpose |
|---------|---------|
| `cesium` | 3D globe rendering engine |
| `copy-webpack-plugin` | Copies Cesium static assets to `public/_cesium/` at build |
| `satellite.js` | SGP4 orbital propagation for satellite tracking |
| `zustand` | Lightweight reactive state management |
| `@google/model-viewer` | Renders 3D `.glb` models (astronaut / objects) |

### Step 3 — Fix the @zip.js compatibility issue

Cesium 1.129 depends on `@zip.js/zip.js` but uses import paths that were removed in v2.8.x. Add this override to your `package.json`:

```json
{
  "overrides": {
    "@zip.js/zip.js": "2.7.73"
  }
}
```

Then re-install:

```bash
npm install
```

### Step 4 — Configure Webpack for CesiumJS

Copy the Webpack configuration from [`next.config.ts`](next.config.ts) to your project. This handles:
- Copying Cesium assets (Workers, ThirdParty, Assets, Widgets) to `public/_cesium/`
- Setting `CESIUM_BASE_URL` to `/_cesium`
- Stripping `node:` prefix from satellite.js imports
- Setting Node.js built-in fallbacks to `false`

### Step 5 — Set up PostCSS for Tailwind CSS 4

Create `postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

### Step 6 — Set up the Cesium Ion token

Create a `.env.local` file:

```env
NEXT_PUBLIC_CESIUM_ION_TOKEN=your_cesium_token_here
```

---

## 🏗️ Project Structure

```
zenith/
├── app/                       # Next.js App Router
│   ├── api/                   # Server-side proxies (avoid CORS)
│   │   ├── tle/               #   CelesTrak satellite TLEs
│   │   ├── iss/               #   OpenNotify live ISS position
│   │   ├── planets/           #   NASA Horizons planet ephemeris
│   │   └── geocode/           #   Nominatim city search (observer picker)
│   ├── constellations/        # Standalone Constellation Viewer route
│   │   └── page.tsx
│   ├── explore/               # Direct globe entry (skips the landing)
│   ├── globals.css            # Global styles + keyframe animations
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Main page (globe + landing overlay)
│
├── components/                # React components
│   ├── CelestialGlobe.tsx     # CesiumJS 3D globe (client-only)
│   ├── GlobeWrapper.tsx       # Dynamic import wrapper (SSR-safe)
│   ├── ZenithApp.tsx          # Globe app shell (TopBar + overlays)
│   ├── Landing.tsx            # Animated landing overlay
│   ├── TopBar.tsx             # Navigation / search / status bar
│   ├── ZenithWindow.tsx       # Zenith cone radar overlay
│   ├── RadarOverlay.tsx       # 2D radar/compass overlay
│   ├── ObjectSearch.tsx       # Tracked-object search
│   ├── ObserverPicker.tsx     # Location: city search / geolocation / manual
│   ├── ObjectDetailPanel.tsx  # Selected-object readouts + pass predictions
│   ├── PassPredictionPanel.tsx# Upcoming-pass times (SGP4)
│   ├── DevSeedButton.tsx      # Dev-only: seed sample data
│   ├── ConstellationViewer.tsx# Constellation page shell (geolocation + UI)
│   ├── ConstellationSky.tsx   # Constellation CesiumJS scene (own viewer)
│   ├── ConstellationSidebar.tsx# Ranked constellation side menu
│   └── ConstellationPanel.tsx # Selected-constellation mythology panel
│
├── lib/                       # Core logic & data
│   ├── coordTransforms.ts     # ECI → ECEF → Geodetic → Topocentric
│   ├── refreshLoop.ts         # Real-time refresh loop (drives the SGP4 worker)
│   ├── sgp4Worker.ts          # Web Worker: SGP4 propagation + pass predictions
│   ├── passPredictions.ts     # Pass-prediction engine
│   ├── solarSystem.ts         # 3D Sun/planets/Moon orrery around Earth
│   ├── seedDevData.ts         # Sample satellite data for development
│   ├── tleParser.ts           # TLE (Two-Line Element) parser
│   ├── constellationData.ts   # 20 constellations (stars, lines, mythology)
│   └── constellationUtils.ts  # RA/Dec → Cartesian, zenith/visibility math
│
├── store/                     # State management
│   └── zenithStore.ts         # Zustand store (observer, objects, zenith filter)
│
├── types/                     # TypeScript type definitions
│   └── celestial.ts           # CelestialObject, TopocentricPosition, etc.
│
├── public/
│   ├── _cesium/               # Cesium static assets (auto-copied at build)
│   └── models/                # .glb 3D models (ISS, satellites, astronaut)
│
├── next.config.ts             # Webpack config for Cesium + satellite.js
├── package.json
├── tsconfig.json
└── .env.local                 # Environment variables (not committed)
```

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| [Next.js 16](https://nextjs.org/) | React framework (App Router) |
| [React 19](https://react.dev/) | UI library |
| [CesiumJS](https://cesium.com/) | 3D globe + constellation sphere rendering |
| [satellite.js](https://github.com/shashwatak/satellite-js) | SGP4 orbital propagation |
| [Zustand](https://zustand-demo.pmnd.rs/) | Lightweight state management |
| [@google/model-viewer](https://modelviewer.dev/) | 3D `.glb` model display (astronaut/models) |
| [Tailwind CSS 4](https://tailwindcss.com/) | Utility-first CSS |
| [TypeScript](https://www.typescriptlang.org/) | Type safety |

---

## 📦 Dependencies

Everything below is installed automatically by `npm install` (it's all declared in [`package.json`](package.json)). This list is for reference.

### Runtime dependencies

| Package | Version | Why it's needed |
|---------|---------|-----------------|
| `next` | 16.2.9 | React framework — App Router, routing, API routes, build pipeline |
| `react` / `react-dom` | 19.2.4 | UI rendering |
| `cesium` | ^1.129.0 | 3D globe engine; renders both the satellite globe and the constellation sphere |
| `satellite.js` | ^7.0.1 | SGP4/SDP4 orbital propagation for satellites and the ISS |
| `zustand` | ^5.0.14 | Reactive global state store |
| `@google/model-viewer` | ^4.3.1 | Renders 3D `.glb` models (e.g. the landing astronaut) |
| `copy-webpack-plugin` | ^14.0.0 | Copies Cesium's static assets into `public/_cesium/` at build time |

### Dev dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5 | Type checking & compilation |
| `tailwindcss` | ^4 | Utility-first CSS framework |
| `@tailwindcss/postcss` | ^4 | Tailwind v4 PostCSS plugin |
| `@types/node` | ^20 | Node.js type definitions |
| `@types/react` / `@types/react-dom` | ^19 | React type definitions |

### Version override

```jsonc
"overrides": {
  // Cesium 1.129 imports a @zip.js path removed in 2.8.x — pin to the 2.7.x line.
  "@zip.js/zip.js": "2.7.73"
}
```

### Required tools

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 18.x or later | Runtime + npm |
| **npm** | 9.x or later | Bundled with Node.js |
| **Git** | any recent | Cloning the repo |
| **Cesium Ion token** | free | For Bing satellite imagery — see [Getting Started](#-getting-started) |
| Modern WebGL browser | — | Chrome / Edge / Firefox / Safari |

> No global CLI installs are required — `npx`-invoked tools (e.g. `next`) come from the local dependencies.

---

## 📜 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the development server (default: port 3000) |
| `npm run build` | Create a production build (also copies Cesium assets) |
| `npm run start` | Start the production server |
| `npx tsc --noEmit` | Run TypeScript type-checking only |

---

## 🔧 Configuration Notes

### CesiumJS Setup

CesiumJS requires static assets (Workers, ThirdParty, Assets, Widgets) to be served from a known base URL. This project handles it automatically:

- **`next.config.ts`** uses `copy-webpack-plugin` to copy Cesium assets from `node_modules` to `public/_cesium/` at build time
- **`CESIUM_BASE_URL`** is set to `/_cesium` via Webpack's `DefinePlugin`
- The globe component is loaded with `dynamic(() => import(...), { ssr: false })` to prevent server-side rendering issues

### satellite.js Compatibility

satellite.js v7 includes WASM glue code that references Node.js built-in modules (`node:fs`, `node:path`, etc.). The Webpack config in `next.config.ts` handles this by:
- Stripping the `node:` prefix via `NormalModuleReplacementPlugin`
- Setting Node built-ins to `false` in `resolve.fallback`

### @zip.js Compatibility

Cesium 1.129 imports `@zip.js/zip.js` v2.7.x paths that were removed in v2.8.x. The `package.json` includes an `overrides` field to pin `@zip.js/zip.js` to `2.7.73`.

---

## 🌐 Data Sources

| Source | Data | Route |
|--------|------|-------|
| [CelesTrak](https://celestrak.org/) | Satellite TLEs | `/api/tle` |
| [OpenNotify](http://open-notify.org/) | Live ISS position | `/api/iss` |
| [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Planet ephemeris | `/api/planets` |
| [Nominatim](https://nominatim.org/) (OpenStreetMap) | City → lat/lng geocoding | `/api/geocode` |
| Hipparcos / [Yale BSC](http://tdc-www.harvard.edu/catalogs/bsc5.html) | Bright-star positions | Bundled in `lib/constellationData.ts` |

> **Note:** All external API calls go through Next.js API route handlers (server-side) to avoid CORS issues. The constellation star data is static and bundled, so the viewer works fully offline.
>
> **Dev note:** CelesTrak can be unreachable from some networks, in which case `/api/tle` returns 502 and the live globe stays empty — append `?dev=true` to seed sample satellites. The Constellation Viewer is unaffected (its data is bundled).

---

## 🤝 Contributing

1. **Fork** the repository
2. **Create** your feature branch: `git checkout -b feature/my-feature`
3. **Commit** your changes: `git commit -m "Add my feature"`
4. **Push** to the branch: `git push origin feature/my-feature`
5. **Open** a Pull Request

---

## 📄 License

This project was built for the **AstralWeb Innovate** track at **Aaruush '26** by **Team Cipher**.

---

## 🙏 Acknowledgments

- [CesiumJS](https://cesium.com/) for the incredible 3D globe engine
- [CelesTrak](https://celestrak.org/) for satellite TLE data
- [satellite.js](https://github.com/shashwatak/satellite-js) for SGP4 propagation
- [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) for planetary ephemeris
