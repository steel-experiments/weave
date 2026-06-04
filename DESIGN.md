---
name: Sleek Developer Core
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#5de6ff'
  on-secondary: '#00363e'
  secondary-container: '#00cbe6'
  on-secondary-container: '#00515d'
  tertiary: '#ffb2b7'
  on-tertiary: '#67001b'
  tertiary-container: '#ff516a'
  on-tertiary-container: '#5b0017'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#a2eeff'
  secondary-fixed-dim: '#2fd9f4'
  on-secondary-fixed: '#001f25'
  on-secondary-fixed-variant: '#004e5a'
  tertiary-fixed: '#ffdadb'
  tertiary-fixed-dim: '#ffb2b7'
  on-tertiary-fixed: '#40000d'
  on-tertiary-fixed-variant: '#92002a'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

The design system is built for high-performance developer environments, specifically catering to the complexity of durable agentic workflows. The brand personality is precise, reliable, and sophisticated—evoking the feeling of a mission control center where complex threads of execution are orchestrated with absolute clarity.

The visual style merges **Minimalism** with **Glassmorphism**. It prioritizes information density and technical utility without sacrificing the premium feel of a modern SaaS product. The "Weave" concept is expressed through subtle connection lines, linear gradients that suggest flow, and a structured hierarchy that handles nested logic and long-running processes. The interface should feel "durable"—heavy enough to feel stable, yet light enough to remain responsive and fast.

## Colors

The palette is optimized for long-duration focus, utilizing a deep slate foundation to reduce eye strain while providing high-contrast accents for critical information.

- **Primary (Indigo #6366F1):** Represents the "Durable Logic." Used for primary actions, active state indicators, and the core structural "threads" of the workflow.
- **Secondary (Cyan #22D3EE):** Represents "Active Execution." Used for progress bars, live status updates, and agent "thought" indicators.
- **Semantic Accents:**
    - **Success (Emerald #10B981):** Successful completions and healthy nodes.
    - **Warning (Amber #F59E0B):** Retries, timeouts, or throttled states.
    - **Error (Rose #F43F5E):** Failed steps, exceptions, and critical halts.
- **Neutral:** A range of slates (from #020617 to #94A3B8) provides the layering system for cards, sidebars, and code blocks.

## Typography

This design system uses a dual-font approach to distinguish between the UI shell and the data layer.

**Geist** is the primary sans-serif, chosen for its technical precision and readability in dense interfaces. It handles all navigation, headers, and UI controls. **JetBrains Mono** is utilized for any content representing "the machine"—code snippets, logs, metadata, and status labels. This distinction helps developers subconsciously separate operational controls from the underlying workflow data.

Headlines use tight letter spacing and bold weights to provide strong anchor points on the page. Body text maintains a comfortable line height for documentation and log reading.

## Layout & Spacing

The layout philosophy follows a **Modular Fluid Grid**, optimized for dashboard and IDE-style views. 

1. **The Shell:** A persistent left or top navigation bar provides the global context. 
2. **Panels:** The main content area is divided into collapsible panels (e.g., Code Editor, Execution Graph, Console).
3. **Information Density:** Spacing is compact (8px/16px defaults) to maximize the "above the fold" data visibility. 

Across mobile, panels stack vertically, and the execution graph shifts to a simplified list view. On desktop, the layout utilizes a 12-column system for modular widgets, allowing developers to resize sidebars to suit their focus (e.g., expanding the log viewer during debugging).

## Elevation & Depth

In this dark-themed system, depth is conveyed through **Tonal Layering** and **Glassmorphism** rather than traditional heavy shadows.

- **Level 0 (Background):** Deepest slate (#020617). The canvas for everything.
- **Level 1 (Surfaces):** Slightly lighter slate (#0F172A). Used for main panels and card backgrounds.
- **Level 2 (Interaction):** Floating menus and modals. These use a backdrop blur (20px) and a semi-transparent background (#1E293B at 80% opacity) with a subtle 1px white border at 10% opacity.
- **Borders:** Instead of shadows, use 1px borders (#1E293B) to define edges. This maintains the "Sleek Developer Core" aesthetic, ensuring the UI feels like a single integrated machine rather than a stack of papers.

## Shapes

The design system utilizes **Soft** roundedness (4px - 6px) to maintain a professional, slightly industrial feel. 

- **Standard Elements:** 4px radius for buttons, inputs, and small cards.
- **Container Elements:** 8px radius for large workflow panels and main content areas.
- **Execution Nodes:** 12px radius to differentiate workflow steps/nodes from standard UI buttons.
- **Status Pills:** Fully pill-shaped for immediate recognition as state indicators.

This sharp-but-soft approach balances modern aesthetics with the structural rigidity expected in developer tools.

## Components

### Buttons & Inputs
- **Primary Action:** Solid Indigo background with white text. Subtle hover state transitions to a slightly brighter indigo.
- **Secondary Action:** Transparent background with a 1px border (#1E293B). On hover, the border brightens.
- **Inputs:** Darker background than the surface they sit on. Active states are indicated by a Cyan border glow (box-shadow: 0 0 0 2px #22D3EE33).

### Execution Nodes
The most distinctive component. Nodes in the workflow graph should use a Level 2 surface with a left-side accent border indicating status (e.g., a green bar for Success). Connection lines between nodes should be 2px thick, using the Indigo primary color.

### Logs & Console
A dedicated component using JetBrains Mono. Log lines should have a background highlight on hover and distinct colors for timestamps (Slate), levels (Semantic), and messages (White).

### Chips & Badges
Small, low-profile indicators using `label-caps` typography. They should use a subtle background tint of their semantic color (e.g., Error badge has a deep rose background at 20% opacity with a rose text color).

### Cards
Cards in this design system do not have shadows. They are defined by their 1px border and a slightly different background shade from the canvas. This keeps the interface feeling "flat" but logically organized.
