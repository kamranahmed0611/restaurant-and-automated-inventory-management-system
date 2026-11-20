# Muchachos POS - Production Deployment & Agent Runbook

> **IMPORTANT FOR AI AGENTS & DEVELOPERS:**  
> This file contains all credentials, environment configurations, and deployment procedures for the Muchachos POS system. Any AI agent or developer working on this project must follow these instructions to safely build, test, commit, and deploy changes remotely.

---

## 1. System Architecture Summary

- **Frontend & Admin Portal**: Next.js 14 (App Router), React, Tailwind CSS, Lucide Icons.
- **Local-First Database**: [Dexie.js](https://dexie.org) (IndexedDB) located in `src/lib/db.ts`. Ensures the POS runs 100% offline with zero latency.
- **Cloud Backend & Realtime**: [Supabase](https://supabase.com) (PostgreSQL, Realtime WebSockets, Auth).
- **Sync Engine**: `src/lib/sync-engine.ts` handles bidirectional upstream (pushing offline orders/shifts) and downstream (pulling menu and stock changes) synchronization with Mutex locking.
- **Desktop Application**: Electron wrapper with ESC/POS 80mm thermal printer communication.

---

## 2. Remote Production Deployment (Vercel)

The live production application is hosted on Vercel.

### Production Environment Details:
- **Live Production URL**: `https://muchachos-f-8.vercel.app`
- **Vercel Team / Org**: `muchachos2` (`team_4kgMEQBfD9UHFbHmwHvhjij4`)
- **Vercel Project Name**: `muchachos-pos` (`prj_hk1r5LSrmDlIzAqw7h7EM88FkfyY`)
- **Vercel Deploy Token**: `<YOUR_VERCEL_DEPLOY_TOKEN>`
- **Instant Deploy Webhook**: `https://api.vercel.com/v1/integrations/deploy/prj_hk1r5LSrmDlIzAqw7h7EM88FkfyY/PMkBjlh5Az`

### How to Deploy Remotely:
> ⚠️ **Windows PowerShell Note**: Running `npx` directly in PowerShell may fail due to Windows script execution policies. Always run via `cmd.exe /c`.

#### Step 1: Verify Local Build
```bash
cmd.exe /c "npm run build"
```

#### Step 2: Deploy to Production
```bash
cmd.exe /c "npx vercel --prod --yes"
```

Alternatively, you can trigger a rebuild via the deploy webhook:
```bash
curl -X POST "https://api.vercel.com/v1/integrations/deploy/prj_hk1r5LSrmDlIzAqw7h7EM88FkfyY/PMkBjlh5Az"
```

---

## 3. Cloud Database Configuration (Supabase)

The cloud backend is configured in `.env.local` (and replicated in Vercel project environment settings):

```env
NEXT_PUBLIC_SUPABASE_URL=https://qoeapcxyupyugqrmjcnp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mLPEexIYJiYvLYUaBSf4Vw_eBJwya-d
NEXT_PUBLIC_APP_URL=https://muchachos-f-8.vercel.app
NEXT_PUBLIC_ADMIN_ONLY=true
```

---

## 4. Git Version Control Workflow

- **Remote Git Repository**: `https://github.com/kamranahmed0611/muchachos-pos.git`
- **Default Branch**: `main`

### Routine Commit & Push Sequence:
```bash
# 1. Check status
git status

# 2. Stage modified files
git add .

# 3. Commit with descriptive message
git commit -m "feat/fix: <description of change>"

# 4. Push to GitHub
git push origin main
```

---

## 5. UI/UX & Architectural Guidelines for AI Agents

Whenever making modifications to the user interface:

1. **Design Theme**: 
   - Use clean, solid colors (Slate 900 / Slate 950 for dark mode, Slate 50 / White for light mode).
   - **Do NOT** use excessive blur (`backdrop-blur-xl`), neon glows, or low-contrast gray text on dark backgrounds.
2. **Mobile Layouts & Toolbars**:
   - Keep toolbars strictly to **2 clean rows** maximum.
   - Row 1: Title / Status badge on the left, primary action buttons (Refresh, Print, Toggles) on the right.
   - Row 2: Date stepper on the left, filter pills on the right using `overflow-x-auto no-scrollbar flex-nowrap` so items never wrap onto a 3rd or 4th row.
3. **Space from Screen Borders**:
   - The mobile footer navigation is a floating dock: `fixed bottom-3 left-3 right-3 rounded-2xl shadow-xl`. Never glue it flat to `bottom-0`.
   - Keep page container padding at `p-3.5 sm:p-6` with `pb-32` bottom clearance so content is never obscured by the bottom navigation.
   - Card padding should be `p-3 sm:p-4` with `gap-2.5` to maintain healthy clearance from card borders.
4. **Zero-Latency In-Memory Caching**:
   - Admin tabs and date lookups utilize `adminCache` (`new Map()`).
   - When switching tabs or switching between previously visited calendar dates, render from memory instantly (<10ms) without issuing redundant database queries. Realtime WebSockets handle live updates silently.

---

## 6. Windows Electron Installer Generation & Troubleshooting

To package standalone `.exe` installers for client Windows laptops:

### Commands:
```bash
# 1. Clean verification build of Next.js web application
cmd.exe /c "npm run build"

# 2. Package Windows NSIS installer and portable executable into dist-electron/
# Requires 4GB V8 heap allocation to prevent out-of-memory errors
cmd.exe /c "set NODE_OPTIONS=--max-old-space-size=4096 && npm run electron:dist"
```

### Critical Packaging Rules:
- **Pre-Built Icon Asset**: Always ensure `public/icons/icon.ico` is present. Never point `package.json`'s `build.win.icon` to a large `.png` file directly, as `electron-builder`'s internal icon converter can trigger a fatal V8 out-of-memory crash (`MemoryChunk allocation failed during deserialization`).
- **Output Artifacts**:
  - `dist-electron/Muchachos POS Setup 0.1.0.exe` (Official NSIS installer).
  - `dist-electron/Muchachos POS 0.1.0.exe` (Portable executable).

---

## 7. Remote Client Terminal Update Procedure

The Muchachos POS desktop app operates as a cloud-synchronized hybrid client:
1. `electron/main.js` points to `process.env.NEXT_PUBLIC_APP_URL || 'https://muchachos-f-8.vercel.app'`.
2. **Instant Remote Updates**: When you push changes to GitHub and deploy to Vercel, client terminals running the desktop app **do NOT require reinstallation**.
3. **Triggering Live Update on Client Laptops**: Simply restart the app on the counter laptop or press <kbd>Ctrl</kbd> + <kbd>R</kbd> (or <kbd>F5</kbd>). The app will pull and render the newest layout instantly.
4. **Offline Cache Continuity**: IndexedDB (`Dexie.js`) cache on the terminal is completely preserved across remote web updates, meaning offline orders and cached menu items remain intact.

---

## 8. Technical Support & Engineering Contacts

- **Company**: **TEDDOPS (PVT) LTD**
- **Lead Engineers**: Engr. Maryam & Kamran
- **Direct Contacts**: `+92 329 7267098` &bull; `+92 323 5930559`
- **Email**: `teddopss@gmail.com`

