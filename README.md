# 🌮 Muchachos POS & Cloud Management System

A high-performance, offline-first Point of Sale (POS) and Cloud Management Suite engineered for restaurant operations. Built with **Next.js 14**, **Electron**, **Supabase**, **Dexie.js (IndexedDB)**, and **Tailwind CSS**.

---

## 🏗️ Architecture Overview

The system operates across a hybrid architecture designed for speed, resilience, and security:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MUCHACHOS POS HYBRID SYSTEM                      │
└─────────────────────────────────────────────────────────────────────────┘

  [ IN-STORE DESKTOP TERMINAL ]                  [ REMOTE CLOUD ACCESS ]
      (Electron .exe / Local)                     (Vercel Cloud Deployment)
                 │                                            │
       ┌─────────┴─────────┐                       ┌──────────┴──────────┐
       │   Cashier POS     │                       │  Owner Admin Portal │
       │ Kitchen KDS Screen│                       │ (Sales, Stock, Menu,│
       │ Hardware Printers │                       │ Expenses, Reports)  │
       │  Cash Drawer Kick │                       └──────────┬──────────┘
       └─────────┬─────────┘                                  │
                 │                                            │
    IndexedDB (Dexie.js Local)                   Supabase Auth Cookie (SSR)
                 │                                            │
                 └───────────────┬────────────────────────────┘
                                 │
                     [ SUPABASE POSTGRESQL CLOUD ]
                     • Live Orders & Audit Log
                     • Menu Items & Recipe BOMs
                     • Raw Inventory & Stock Levels
                     • P&L Financials & Expenses
```

### 1. In-Store Terminal (Desktop Electron `.exe`)
* **Offline-First Resilience**: Full local order ring-up, dine-in table tracking, kitchen KOT dispatch, and bill settlement function even if internet connectivity drops.
* **Instant Dexie Storage**: Local IndexedDB database handles zero-latency order transactions.
* **Bi-Directional Sync Engine**: Background batch-sync engine pushes pending offline orders to Supabase when connectivity is restored, and pulls updated menu/pricing changes downstream.
* **Direct Hardware Integration**: Electron IPC silently prints to 80mm/58mm thermal receipt printers without blocking dialogs, and triggers RJ11 cash drawer kick pulses (`ESC p 0 25 250`).
* **Multi-Window Kitchen Display (KDS)**: Independent child windows for the cashier POS, kitchen display, and admin portal.
* **Adaptive Low-Resolution Engine**: Full support for 1366x768 / 720p counter laptops (3 to 4 product rows visible, compact responsive header).
* **Permanent Thermal Branding**: Tamper-proof Teddops engineering credits and contact lines on all customer bills and closing slips.

### 2. Remote Cloud Portal (Vercel Deployment)
* **Owner & Manager Portal**: Access live sales revenue, real-time order logs, recipe costs, inventory levels, and operating expenses from any browser, phone, or tablet.
* **Admin-Only Security Guarding**: Public web traffic is gated. External web visitors cannot access the in-store Cashier POS counter.
* **Supabase Authentication**: Protected by cryptographic session tokens managed via `@supabase/ssr` cookies and Next.js Edge Middleware.

---

## 🔒 Security & Deployment Standards

1. **Edge Route Protection (`src/middleware.ts`)**:
   - Web visitors to `/` or `/pos` are automatically redirected to `/admin` (or `/login` if unauthenticated).
   - `/kds` (Kitchen Display System) is open and accessible for kitchen monitors, smart TVs, and Electron popups without redirection.
   - Store desktop terminals (stamped with `MuchachosPOS-Desktop` or Electron UA) retain direct access to the POS terminal.
2. **HTTP Security Headers (`next.config.js`)**:
   - `Strict-Transport-Security`: Enforces HTTPS with preload.
   - `X-Frame-Options: SAMEORIGIN`: Prevents clickjacking attacks.
   - `X-Content-Type-Options: nosniff`: Prevents MIME-type confusion attacks.
   - `Referrer-Policy: strict-origin-when-cross-origin`: Minimizes referrer leakage.
   - `Permissions-Policy`: Restricts camera, microphone, and geolocation access.
3. **Environment Isolation**:
   - Sensitive credentials are never committed to git (`.gitignore` protects all `.env*` files).
   - Public frontend code uses only publishable anon keys.

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: v18.17+ or v20.x
* **npm**: v9+
* **Supabase Account**: With PostgreSQL project initialized

### 1. Installation
Clone the repository and install project dependencies:
```bash
git clone https://github.com/your-username/muchachos-pos.git
cd muchachos-pos
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env.local` and add your Supabase credentials:
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-anon-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_ADMIN_ONLY=false
```

### 3. Local Development

* **Next.js Web Server**:
  ```bash
  npm run dev
  ```
  Open [http://localhost:3000](http://localhost:3000) in your browser.

* **Electron Desktop Application**:
  ```bash
  npm run electron:dev
  ```

---

## 📦 Building Production Executables (`.exe`)

To compile and package the standalone Windows application:

```bash
# 1. Build optimized standalone bundle and prepare static assets
npm run build:standalone

# 2. Package unpacked directory for quick verification
npm run electron:pack

# 3. Package Windows NSIS installer and portable executable
npm run electron:dist
```

Output binaries are generated in the `dist-electron/` directory:
* **`dist-electron/win-unpacked/Muchachos POS.exe`**: Directly runnable unpacked application.
* **`dist-electron/Muchachos POS Setup 0.1.0.exe`**: Full Windows installer with desktop and start menu shortcuts.
* **`dist-electron/Muchachos POS 0.1.0.exe`**: Portable standalone executable (no installation required).

---

## ☁️ Deploying to Vercel (Admin Cloud Portal)

To host the remote Owner Admin Portal on Vercel:

1. Push your repository to **GitHub**:
   ```bash
   git add .
   git commit -m "feat: production clean build with admin-only cloud routing"
   git push origin main
   ```

2. Import the project into your **Vercel Dashboard**.
3. Under **Project Settings > Environment Variables**, add:
   * `NEXT_PUBLIC_SUPABASE_URL` = `https://your-project.supabase.co`
   * `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `your-publishable-anon-key`
   * `NEXT_PUBLIC_ADMIN_ONLY` = `true` *(Restricts public web access strictly to `/admin` and `/login`)*
4. Click **Deploy**.

---

## 🛠️ Tech Stack & Libraries

| Technology | Purpose |
| :--- | :--- |
| **Next.js 14** (App Router) | React Framework, SSR Auth Middleware, Optimized Static Generation |
| **Electron 44** | Native Windows desktop runtime, hardware printer & drawer IPC |
| **Supabase** | Cloud PostgreSQL backend, Real-Time Subscriptions, Auth Cookies |
| **Dexie.js** | IndexedDB offline-first local database |
| **Zustand** | Centralized client state management |
| **Tailwind CSS** | Styling and responsive design system |
| **Lucide React** | Application iconography |

---

## 🤝 Engineering & Credits

Engineered and maintained by **Teddops**.  
Contact: `+92 329 7267098` &bull; `+92 323 5930559` &bull; Support: `teddopss@gmail.com`
