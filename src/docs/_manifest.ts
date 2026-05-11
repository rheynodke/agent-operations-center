import type { DocsManifest } from "./manifest-types"

export const docsManifest: DocsManifest = {
  defaultPage: "getting-started/welcome",
  sections: [
    {
      slug: "getting-started",
      title: { id: "Mulai Cepat", en: "Getting Started" },
      audience: "user",
      pages: [
        { slug: "welcome", title: { id: "Selamat Datang", en: "Welcome to AOC" }, status: "ready" },
        { slug: "login-setup", title: { id: "Login & Setup", en: "Logging In & Setup" }, status: "ready" },
        { slug: "onboarding-master", title: { id: "Onboarding Master Agent", en: "Onboarding Master Agent" }, status: "ready" },
        { slug: "first-chat", title: { id: "Chat Pertama", en: "Your First Chat" }, status: "ready" },
      ],
    },
    {
      slug: "user-guide",
      title: { id: "Panduan Pengguna", en: "User Guide" },
      audience: "user",
      groups: [
        {
          slug: "dashboard",
          title: { id: "Dashboard", en: "Dashboard" },
          pages: [
            { slug: "overview", title: { id: "Dashboard Overview", en: "Dashboard Overview" }, status: "ready" },
            { slug: "agent-world", title: { id: "Agent World", en: "Agent World" }, status: "ready" },
          ],
        },
        {
          slug: "agents",
          title: { id: "Agen", en: "Agents" },
          pages: [
            { slug: "browsing", title: { id: "Menjelajahi Agen", en: "Browsing Agents" }, status: "ready" },
            { slug: "provisioning", title: { id: "Membuat Sub-Agent", en: "Provisioning a Sub-Agent" }, status: "ready" },
            { slug: "detail-overview", title: { id: "Halaman Detail Agen", en: "Agent Detail Page" }, status: "ready" },
          ],
        },
        {
          slug: "channels",
          title: { id: "Channel", en: "Channels" },
          pages: [
            { slug: "overview", title: { id: "Overview Channel", en: "Channels Overview" }, status: "ready" },
            { slug: "telegram", title: { id: "Setup Telegram", en: "Setting Up Telegram" }, status: "ready" },
            { slug: "whatsapp", title: { id: "Setup WhatsApp", en: "Setting Up WhatsApp" }, status: "ready" },
            { slug: "discord", title: { id: "Setup Discord", en: "Setting Up Discord" }, status: "ready" },
            { slug: "embed", title: { id: "Setup Embed Chat", en: "Setting Up Embed Chat" }, status: "ready" },
          ],
        },
        {
          slug: "collaboration",
          title: { id: "Kolaborasi", en: "Collaboration" },
          pages: [
            { slug: "mission-rooms", title: { id: "Mission Rooms", en: "Mission Rooms" }, status: "ready" },
            { slug: "hq-room", title: { id: "HQ Room", en: "HQ Room" }, status: "ready" },
            { slug: "messaging", title: { id: "Mengirim Pesan & Mention", en: "Messaging & Mentioning" }, status: "ready" },
          ],
        },
        {
          slug: "projects",
          title: { id: "Project", en: "Projects" },
          pages: [
            { slug: "overview", title: { id: "Overview Project", en: "Projects Overview" }, status: "ready" },
            { slug: "task-board", title: { id: "Task Board", en: "Task Board" }, status: "ready" },
          ],
        },
        {
          slug: "automation",
          title: { id: "Otomasi", en: "Automation" },
          pages: [
            { slug: "schedules", title: { id: "Jadwal (Cron)", en: "Schedules (Cron)" }, status: "ready" },
          ],
        },
        {
          slug: "skills",
          title: { id: "Skills", en: "Skills" },
          pages: [
            { slug: "overview", title: { id: "Overview Skills", en: "Skills Overview" }, status: "ready" },
          ],
        },
        {
          slug: "connections",
          title: { id: "Connections", en: "Connections" },
          pages: [
            { slug: "overview", title: { id: "Overview Connections", en: "Connections Overview" }, status: "ready" },
          ],
        },
        {
          slug: "personal",
          title: { id: "Pengaturan Pribadi", en: "Personal Settings" },
          pages: [
            { slug: "theme-layout", title: { id: "Tema & Layout", en: "Theme & Layout" }, status: "ready" },
          ],
        },
      ],
    },
    {
      slug: "architecture",
      title: { id: "Arsitektur", en: "Architecture" },
      audience: "developer",
      pages: [
        { slug: "overview", title: { id: "Overview Sistem", en: "System Overview" }, status: "ready" },
        { slug: "multi-tenant", title: { id: "Multi-Tenant Foundation", en: "Multi-Tenant Foundation" }, status: "ready" },
        { slug: "data-flow", title: { id: "Data Flow End-to-End", en: "Data Flow End-to-End" }, status: "ready" },
        { slug: "gateway-orchestrator", title: { id: "Gateway Orchestrator", en: "Gateway Orchestrator" }, status: "ready" },
        { slug: "master-agent", title: { id: "Master Agent", en: "Master Agent" }, status: "ready" },
        { slug: "mission-rooms-internals", title: { id: "Mission Rooms Internals", en: "Mission Rooms Internals" }, status: "placeholder" },
      ],
    },
    {
      slug: "operations",
      title: { id: "Operasional", en: "Operations" },
      audience: "admin",
      pages: [
        { slug: "initial-setup", title: { id: "Setup Awal", en: "Initial Setup" }, status: "placeholder" },
        { slug: "user-management", title: { id: "Manajemen User & Invitation", en: "User Management" }, status: "placeholder" },
        { slug: "gateway-cli", title: { id: "Gateway CLI (gw.sh)", en: "Gateway CLI (gw.sh)" }, status: "placeholder" },
      ],
    },
    {
      slug: "skills-reference",
      title: { id: "Referensi Skills", en: "Skills Reference" },
      audience: "all",
      pages: [
        { slug: "overview", title: { id: "Overview Built-in Skills", en: "Built-in Skills Overview" }, status: "placeholder" },
        { slug: "aoc-master", title: { id: "aoc-master", en: "aoc-master" }, status: "placeholder" },
        { slug: "aoc-tasks", title: { id: "aoc-tasks", en: "aoc-tasks" }, status: "placeholder" },
        { slug: "aoc-connections", title: { id: "aoc-connections", en: "aoc-connections" }, status: "placeholder" },
      ],
    },
    {
      slug: "reference",
      title: { id: "Referensi Developer", en: "Developer Reference" },
      audience: "developer",
      pages: [
        { slug: "sharp-edges", title: { id: "Sharp Edges & Gotchas", en: "Sharp Edges & Gotchas" }, status: "ready" },
      ],
    },
  ],
}
