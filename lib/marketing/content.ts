import type {
  MarketingContent,
  MarketingFeature,
  MarketingLogo,
  MarketingPage,
  MarketingPricingPlan,
  MarketingResource,
  MarketingStat,
  MarketingTeamMember,
  MarketingTestimonial,
  MarketingTopic,
} from "@/lib/marketing/types";

/**
 * Seeded marketing content.
 *
 * This mirrors the seed in `supabase/migrations/*_marketing_content.sql` so a
 * page still renders when Supabase is unconfigured or unreachable. Content
 * served from here is reported as `source: "seed"` and labelled **Demo Data**
 * in the interface — it is never presented as live.
 *
 * Keep this file and the migration seed in step. The contract test
 * `tests/integration/marketing-content.contract.test.ts` fails if they drift.
 */

export const MARKETING_PAGES: readonly MarketingPage[] = [
  {
    slug: "home",
    eyebrow: "The AI software factory",
    headline: "Ship better software,",
    headlineAccent: "faster, with AI.",
    subheadline:
      "Plan, build, test, deploy and scale from one platform. AI agents, automation and best practices at every step of the lifecycle.",
    seoTitle: "AI Software Factory — Build, Deploy and Scale with AI",
    seoDescription:
      "An end-to-end platform that helps teams plan, build, deploy and scale better software, faster, with AI agents and automation at every step.",
  },
  {
    slug: "platform",
    eyebrow: "The complete AI-powered platform",
    headline: "One Platform. Everything You Need to",
    headlineAccent: "Build, Deploy and Scale.",
    subheadline:
      "AI Software Factory provides a unified, end-to-end platform that empowers teams to build better software with AI agents, collaboration and automation at every step.",
    seoTitle: "Platform — AI Software Factory",
    seoDescription:
      "A unified, end-to-end platform for planning, building, testing, deploying, operating and scaling software with AI agents and automation.",
  },
  {
    slug: "features",
    eyebrow: "Every capability, in depth",
    headline: "The features behind",
    headlineAccent: "every great release.",
    subheadline:
      "Explore the AI agents, automation, collaboration and governance capabilities that carry an idea from first prompt to production.",
    seoTitle: "Features — AI Software Factory",
    seoDescription:
      "AI agents, automation, collaboration, insight and governance capabilities that carry an idea from first prompt to production.",
  },
  {
    slug: "solutions",
    eyebrow: "Solutions",
    headline: "See the factory",
    headlineAccent: "in operation.",
    subheadline:
      "A truthful operating view of connected projects, delivery controls and engineering intelligence.",
    seoTitle: "Solutions — AI Software Factory",
    seoDescription:
      "A live operating view of connected projects, pull requests, safety posture and engineering intelligence.",
  },
  {
    slug: "pricing",
    eyebrow: "Pricing",
    headline: "Simple, Transparent Pricing. Built for",
    headlineAccent: "Every Team.",
    subheadline:
      "Choose the plan that fits your team's needs. Upgrade, downgrade, or cancel anytime.",
    seoTitle: "Pricing — AI Software Factory",
    seoDescription:
      "Simple, transparent pricing for every team. Free, Basic, Pro and Enterprise plans with no setup fees and cancel anytime.",
  },
  {
    slug: "resources",
    eyebrow: "Resources",
    headline: "Resources to help you build",
    headlineAccent: "better software.",
    subheadline:
      "Guides, templates, tutorials and insights from the AI Software Factory team and our community of builders.",
    seoTitle: "Resources — AI Software Factory",
    seoDescription:
      "Guides, templates, tutorials, case studies and downloads from the AI Software Factory team and community.",
  },
  {
    slug: "about",
    eyebrow: "About AI Software Factory",
    headline: "We're building the future of software development with",
    headlineAccent: "AI at the core.",
    subheadline:
      "AI Software Factory is an end-to-end platform that helps teams plan, build, deploy and scale better software—faster. Our mission is simple: empower builders to turn ideas into impact with AI, automation and best practices.",
    seoTitle: "About — AI Software Factory",
    seoDescription:
      "We are building the future of software development with AI at the core. Meet the mission, values and team behind AI Software Factory.",
  },
];

const SHARED_STATS: readonly Omit<MarketingStat & { pageSlug: string }, "pageSlug">[] = [
  { value: "25K+", label: "Teams empowered", icon: "users" },
  { value: "2M+", label: "Projects built", icon: "code" },
  { value: "100+", label: "Countries", icon: "globe" },
  { value: "99.9%", label: "Platform uptime", icon: "zap" },
];

export const MARKETING_STATS: Readonly<Record<string, readonly MarketingStat[]>> = {
  about: SHARED_STATS,
  home: SHARED_STATS,
};

function feature(
  groupKey: string,
  title: string,
  body: string,
  icon: string,
  accent: string,
): MarketingFeature {
  return { groupKey, title, body, icon, accent, href: null };
}

export const MARKETING_FEATURES: Readonly<Record<string, readonly MarketingFeature[]>> = {
  platform: [
    feature("lifecycle", "Plan", "AI for product strategy, requirements, roadmaps and prioritization.", "clipboard", "violet"),
    feature("lifecycle", "Build", "AI-powered IDE, code generation, review and best practice guidance.", "code", "blue"),
    feature("lifecycle", "Test", "AI testing agents, automated QA, test generation and coverage.", "shield-check", "emerald"),
    feature("lifecycle", "Deploy", "Automated pipelines, one-click deployments and environment management.", "cloud-upload", "sky"),
    feature("lifecycle", "Operate", "Real-time monitoring, analytics, alerts and incident management.", "trending-up", "violet"),
    feature("lifecycle", "Scale", "Auto-scaling, cost optimization and performance tuning.", "rocket", "fuchsia"),
    feature("foundation", "Enterprise Security", "Zero-trust, SSO, RBAC, encryption and compliance.", "shield-check", "blue"),
    feature("foundation", "Unified Data Layer", "Connects all your data and tools in one place.", "database", "violet"),
    feature("foundation", "AI Agents", "Specialized agents for every stage of the software lifecycle.", "brain", "sky"),
    feature("foundation", "Integrations", "Seamless integrations with your favorite tools.", "puzzle", "fuchsia"),
    feature("foundation", "Global Scale", "Built for performance, reliability and scale.", "globe", "blue"),
    feature("foundation", "Open & Flexible", "Open APIs, SDKs and extensible architecture.", "bar-chart", "emerald"),
    feature("stack", "AI Agents", "Specialized agents that plan, write, review and verify work.", "brain", "sky"),
    feature("stack", "Automation", "Workflows that remove the repetitive parts of delivery.", "zap", "violet"),
    feature("stack", "Data & Context", "One context layer so every agent sees the same truth.", "database", "blue"),
    feature("stack", "Security", "Zero-trust controls applied at every boundary.", "lock", "fuchsia"),
    feature("stack", "Infrastructure", "Reliable, global infrastructure you do not have to run.", "cloud", "emerald"),
  ],
  about: [
    feature("value", "Customer First", "We build with empathy and obsess over our customers' success.", "users", "violet"),
    feature("value", "Innovation", "We push boundaries and continuously innovate to stay ahead.", "lightbulb", "sky"),
    feature("value", "Integrity", "We act with transparency, honesty and respect in everything we do.", "shield-check", "blue"),
    feature("value", "Collaboration", "We win together by empowering teams and sharing knowledge.", "users", "fuchsia"),
    feature("value", "Excellence", "We are committed to quality, performance and continuous improvement.", "star", "emerald"),
  ],
  resources: [
    feature("category", "Guides & Tutorials", "Step-by-step guides to help you get started.", "book-open", "violet"),
    feature("category", "Documentation", "Technical docs and API references.", "code", "blue"),
    feature("category", "Templates", "Production-ready templates & blueprints.", "layout", "emerald"),
    feature("category", "Videos", "Watch tutorials, demos and expert sessions.", "play", "amber"),
    feature("category", "Case Studies", "Real-world stories from our customers.", "users", "fuchsia"),
    feature("category", "Downloads", "Ebooks, checklists and resource kits.", "download", "sky"),
    feature("pillar", "Learn", "In-depth guides and tutorials to accelerate your skills.", "book-open", "violet"),
    feature("pillar", "Build", "Templates, examples and best practices to ship faster.", "code", "blue"),
    feature("pillar", "Connect", "Join a community of innovators solving real problems.", "users", "fuchsia"),
    feature("pillar", "Stay Ahead", "Insights, trends and updates from the world of AI.", "trending-up", "emerald"),
  ],
  pricing: [
    feature("pillar", "Plan", "Strategize with AI", "clipboard", "violet"),
    feature("pillar", "Build", "Ship better software", "code", "blue"),
    feature("pillar", "Deploy", "One-click deployments", "cloud-upload", "sky"),
    feature("pillar", "Operate", "Monitor & optimize", "trending-up", "emerald"),
    feature("pillar", "Scale", "Grow without limits", "rocket", "fuchsia"),
    feature("security", "SOC 2 Type II Compliant", "Independently audited controls.", "shield-check", "emerald"),
    feature("security", "ISO 27001 Certified", "Certified information security management.", "shield-check", "emerald"),
    feature("security", "Data Encrypted in Transit and at Rest", "Encryption everywhere by default.", "lock", "emerald"),
    feature("security", "99.9% Platform Uptime", "Backed by our service level agreement.", "clock", "emerald"),
    feature("security", "Advanced Access Controls", "SSO, RBAC and fine-grained permissions.", "users", "emerald"),
  ],
  features: [
    feature("pillar", "AI Agents", "Specialized agents for planning, building, testing and reviewing.", "brain", "violet"),
    feature("pillar", "Automation", "Workflows that carry work forward without babysitting.", "zap", "blue"),
    feature("pillar", "Collaboration", "One place for humans and agents to work the same backlog.", "users", "fuchsia"),
    feature("pillar", "Insight", "Analytics that explain velocity, quality and cost.", "bar-chart", "sky"),
    feature("pillar", "Governance", "Approvals, audit trails and risk controls that hold.", "shield-check", "emerald"),
    feature("pillar", "Extensibility", "Open APIs and SDKs so the platform fits your stack.", "puzzle", "amber"),
  ],
};

export const MARKETING_PLANS: readonly MarketingPricingPlan[] = [
  {
    slug: "free",
    name: "Free",
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    priceNote: "forever",
    blurb: "Perfect for individuals and exploring the platform.",
    ctaLabel: "Get Started",
    ctaHref: "/auth/sign-up",
    accent: "emerald",
    highlighted: false,
    highlightLabel: null,
    features: [
      { planSlug: "free", label: "1 User", matrixRow: "Users", matrixValue: "1", included: true },
      { planSlug: "free", label: "1 Project", matrixRow: "Projects", matrixValue: "1", included: true },
      { planSlug: "free", label: "AI Code Assistant (Limited)", matrixRow: "AI Code Assistant", matrixValue: "Limited", included: true },
      { planSlug: "free", label: "Community Support", matrixRow: "Priority Support", matrixValue: "Community", included: true },
      { planSlug: "free", label: "Basic Integrations", matrixRow: null, matrixValue: null, included: true },
      { planSlug: "free", label: null, matrixRow: "AI Agents", matrixValue: null, included: false },
      { planSlug: "free", label: null, matrixRow: "Automation & Workflows", matrixValue: null, included: false },
      { planSlug: "free", label: null, matrixRow: "Advanced Analytics", matrixValue: null, included: false },
      { planSlug: "free", label: null, matrixRow: "SSO & Role Management", matrixValue: null, included: false },
      { planSlug: "free", label: null, matrixRow: "SLA", matrixValue: null, included: false },
    ],
  },
  {
    slug: "basic",
    name: "Basic",
    monthlyPriceCents: 2900,
    yearlyPriceCents: 2320,
    priceNote: "user / month",
    blurb: "Everything you need to build and ship great software.",
    ctaLabel: "Start Free Trial",
    ctaHref: "/auth/sign-up",
    accent: "blue",
    highlighted: false,
    highlightLabel: null,
    features: [
      { planSlug: "basic", label: "Up to 5 Users", matrixRow: "Users", matrixValue: "Up to 5", included: true },
      { planSlug: "basic", label: "Unlimited Projects", matrixRow: "Projects", matrixValue: "Unlimited", included: true },
      { planSlug: "basic", label: "AI Code Assistant", matrixRow: "AI Code Assistant", matrixValue: null, included: true },
      { planSlug: "basic", label: "Standard Integrations", matrixRow: null, matrixValue: null, included: true },
      { planSlug: "basic", label: "Email Support", matrixRow: "Priority Support", matrixValue: "Email", included: true },
      { planSlug: "basic", label: "Basic Analytics", matrixRow: null, matrixValue: null, included: true },
      { planSlug: "basic", label: null, matrixRow: "AI Agents", matrixValue: null, included: true },
      { planSlug: "basic", label: null, matrixRow: "Automation & Workflows", matrixValue: null, included: false },
      { planSlug: "basic", label: null, matrixRow: "Advanced Analytics", matrixValue: null, included: true },
      { planSlug: "basic", label: null, matrixRow: "SSO & Role Management", matrixValue: null, included: false },
      { planSlug: "basic", label: null, matrixRow: "SLA", matrixValue: null, included: false },
    ],
  },
  {
    slug: "pro",
    name: "Pro",
    monthlyPriceCents: 7900,
    yearlyPriceCents: 6320,
    priceNote: "user / month",
    blurb: "Advanced tools for growing teams and complex products.",
    ctaLabel: "Start Free Trial",
    ctaHref: "/auth/sign-up",
    accent: "violet",
    highlighted: true,
    highlightLabel: "Most Popular",
    features: [
      { planSlug: "pro", label: "Up to 25 Users", matrixRow: "Users", matrixValue: "Up to 25", included: true },
      { planSlug: "pro", label: "Unlimited Projects", matrixRow: "Projects", matrixValue: "Unlimited", included: true },
      { planSlug: "pro", label: "Advanced AI Agents", matrixRow: "AI Code Assistant", matrixValue: null, included: true },
      { planSlug: "pro", label: "Automation & Workflows", matrixRow: "Automation & Workflows", matrixValue: null, included: true },
      { planSlug: "pro", label: "Priority Support", matrixRow: "Priority Support", matrixValue: "Priority", included: true },
      { planSlug: "pro", label: "Advanced Analytics", matrixRow: "Advanced Analytics", matrixValue: null, included: true },
      { planSlug: "pro", label: "SSO & Role Management", matrixRow: "SSO & Role Management", matrixValue: null, included: true },
      { planSlug: "pro", label: null, matrixRow: "AI Agents", matrixValue: null, included: true },
      { planSlug: "pro", label: null, matrixRow: "SLA", matrixValue: "99.9%", included: true },
    ],
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    monthlyPriceCents: null,
    yearlyPriceCents: null,
    priceNote: null,
    blurb: "Built for organizations with advanced security, scale and support needs.",
    ctaLabel: "Contact Sales",
    ctaHref: "/about",
    accent: "fuchsia",
    highlighted: false,
    highlightLabel: null,
    features: [
      { planSlug: "enterprise", label: "Unlimited Users", matrixRow: "Users", matrixValue: "Unlimited", included: true },
      { planSlug: "enterprise", label: "Unlimited Projects", matrixRow: "Projects", matrixValue: "Unlimited", included: true },
      { planSlug: "enterprise", label: "Custom AI Solutions", matrixRow: "AI Code Assistant", matrixValue: null, included: true },
      { planSlug: "enterprise", label: "Advanced Security & Compliance", matrixRow: "SSO & Role Management", matrixValue: null, included: true },
      { planSlug: "enterprise", label: "Dedicated Support & SLA", matrixRow: "Priority Support", matrixValue: "Dedicated", included: true },
      { planSlug: "enterprise", label: "Onboarding & Training", matrixRow: "Advanced Analytics", matrixValue: null, included: true },
      { planSlug: "enterprise", label: "Custom Integrations", matrixRow: "Automation & Workflows", matrixValue: null, included: true },
      { planSlug: "enterprise", label: null, matrixRow: "AI Agents", matrixValue: null, included: true },
      { planSlug: "enterprise", label: null, matrixRow: "SLA", matrixValue: "99.9%", included: true },
    ],
  },
];

export const MARKETING_RESOURCES: readonly MarketingResource[] = [
  {
    slug: "ultimate-guide-ai-powered-software-development",
    kind: "guide",
    title: "The Ultimate Guide to AI-Powered Software Development",
    summary: "Learn how to build, test and deploy software faster with AI.",
    readTime: "12 min read",
    level: "Beginner",
    href: "#",
    topic: "AI Agents",
    featured: true,
  },
  {
    slug: "ai-agent-starter-kit",
    kind: "template",
    title: "AI Agent Starter Kit",
    summary: "Kickstart your project with our production-ready AI agent template.",
    readTime: null,
    level: "All Levels",
    href: "#",
    topic: "AI Agents",
    featured: true,
  },
  {
    slug: "build-your-first-ai-agent",
    kind: "video",
    title: "Build Your First AI Agent",
    summary: "Watch how to build and deploy an AI agent in under 30 minutes.",
    readTime: "28 min",
    level: "Intermediate",
    href: "#",
    topic: "AI Agents",
    featured: true,
  },
  {
    slug: "how-acme-scaled-5x-faster",
    kind: "case_study",
    title: "How ACME Scaled 5x Faster with AI Software Factory",
    summary: "See how ACME improved velocity and reduced costs by 60%.",
    readTime: "8 min read",
    level: "Case Study",
    href: "#",
    topic: "Scaling",
    featured: true,
  },
  {
    slug: "production-readiness-checklist",
    kind: "checklist",
    title: "Production Readiness Checklist",
    summary: "Ensure your application is secure, scalable and production-ready.",
    readTime: null,
    level: "All Levels",
    href: "#",
    topic: "Best Practices",
    featured: true,
  },
  {
    slug: "platform-api-reference",
    kind: "documentation",
    title: "Platform API Reference",
    summary: "Every endpoint, parameter and response shape in one place.",
    readTime: null,
    level: "All Levels",
    href: "#",
    topic: "DevOps & CI/CD",
    featured: false,
  },
  {
    slug: "automating-code-review",
    kind: "guide",
    title: "Automating Code Review Without Losing Judgment",
    summary: "Where automated review helps, where it hurts, and how to tell.",
    readTime: "9 min read",
    level: "Intermediate",
    href: "#",
    topic: "Best Practices",
    featured: false,
  },
  {
    slug: "zero-downtime-deployment-playbook",
    kind: "download",
    title: "Zero-Downtime Deployment Playbook",
    summary: "A practical playbook for shipping continuously without user impact.",
    readTime: null,
    level: "Advanced",
    href: "#",
    topic: "DevOps & CI/CD",
    featured: false,
  },
];

export const MARKETING_TOPICS: readonly MarketingTopic[] = [
  { name: "AI Agents", icon: "brain", resourceCount: 23, kind: "topic", href: "/resources" },
  { name: "Automation", icon: "zap", resourceCount: 18, kind: "topic", href: "/resources" },
  { name: "DevOps & CI/CD", icon: "infinity", resourceCount: 21, kind: "topic", href: "/resources" },
  { name: "Best Practices", icon: "gem", resourceCount: 27, kind: "topic", href: "/resources" },
  { name: "Security", icon: "shield-check", resourceCount: 16, kind: "topic", href: "/resources" },
  { name: "Scaling", icon: "trending-up", resourceCount: 19, kind: "topic", href: "/resources" },
  { name: "Developers", icon: "users", resourceCount: 32, kind: "role", href: "/resources" },
  { name: "DevOps Engineers", icon: "users", resourceCount: 24, kind: "role", href: "/resources" },
  { name: "Product Managers", icon: "users", resourceCount: 15, kind: "role", href: "/resources" },
];

export const MARKETING_TEAM: readonly MarketingTeamMember[] = [
  {
    name: "Daniel Hughes",
    role: "CEO & Co-Founder",
    bio: "Visionary leader with a passion for AI, automation and building world-class products.",
    headshotUrl: null,
    linkedinUrl: "https://www.linkedin.com/",
    twitterUrl: "https://x.com/",
  },
  {
    name: "Sarah Chen",
    role: "CTO & Co-Founder",
    bio: "Engineering leader focused on scalable systems, developer experience and AI innovation.",
    headshotUrl: null,
    linkedinUrl: "https://www.linkedin.com/",
    twitterUrl: "https://x.com/",
  },
  {
    name: "Arjun Patel",
    role: "Head of Product",
    bio: "Product strategist passionate about solving real problems for builders and teams.",
    headshotUrl: null,
    linkedinUrl: "https://www.linkedin.com/",
    twitterUrl: "https://x.com/",
  },
  {
    name: "Emily Roberts",
    role: "Head of Customer Success",
    bio: "Customer advocate ensuring teams achieve more with the power of our platform.",
    headshotUrl: null,
    linkedinUrl: "https://www.linkedin.com/",
    twitterUrl: "https://x.com/",
  },
  {
    name: "Mark Johnson",
    role: "Head of Growth",
    bio: "Growth leader driving impact and helping builders around the world succeed.",
    headshotUrl: null,
    linkedinUrl: "https://www.linkedin.com/",
    twitterUrl: "https://x.com/",
  },
];

export const MARKETING_TESTIMONIALS: readonly MarketingTestimonial[] = [
  {
    quote:
      "AI Software Factory has transformed how we build, deploy and scale software. Our productivity is through the roof.",
    authorName: "Alex Johnson",
    authorTitle: "CTO, TechNova",
    avatarUrl: null,
    pageSlug: "pricing",
  },
  {
    quote:
      "We went from idea to production in days instead of quarters, without giving up review or control.",
    authorName: "Priya Nair",
    authorTitle: "VP Engineering, Northwind",
    avatarUrl: null,
    pageSlug: "home",
  },
];

export const MARKETING_LOGOS: readonly MarketingLogo[] = [
  { name: "Coinbase", wordmark: "coinbase" },
  { name: "Notion", wordmark: "Notion" },
  { name: "Verkada", wordmark: "Verkada" },
  { name: "Airbnb", wordmark: "airbnb" },
  { name: "Brex", wordmark: "BREX" },
  { name: "Zapier", wordmark: "zapier" },
  { name: "Atlassian", wordmark: "ATLASSIAN" },
];

export function seedContentForPage(slug: string): MarketingContent {
  return {
    source: "seed",
    page: MARKETING_PAGES.find((page) => page.slug === slug) ?? null,
    stats: [...(MARKETING_STATS[slug] ?? [])],
    features: [...(MARKETING_FEATURES[slug] ?? [])],
    plans: slug === "pricing" || slug === "home" ? [...MARKETING_PLANS] : [],
    resources: slug === "resources" || slug === "home" ? [...MARKETING_RESOURCES] : [],
    topics: slug === "resources" ? [...MARKETING_TOPICS] : [],
    team: slug === "about" ? [...MARKETING_TEAM] : [],
    testimonials: MARKETING_TESTIMONIALS.filter((entry) => entry.pageSlug === slug),
    logos: slug === "about" || slug === "home" ? [...MARKETING_LOGOS] : [],
  };
}
