---
name: Curtain
description: Pay-on-entry tickets in warm paper and theatre velvet.
colors:
  paper: "#f6f1ea"
  ivory: "#fffdf9"
  ink: "#1d1714"
  muted-ink: "#6f655d"
  hairline: "#e6ddd2"
  velvet: "#8e1b2c"
  velvet-ink: "#fff6f2"
  go: "#17703d"
  stop: "#b42318"
  admit: "#146c37"
  deny: "#a8201a"
  footlight-gold: "#f2b544"
  stage-black: "#120d0c"
  dark-surface: "#1c1513"
  dark-velvet: "#e05a6d"
  viz-paid: "#2a78d6"
  viz-protected: "#c0394f"
  viz-refunded: "#c98500"
typography:
  display:
    fontFamily: "DM Serif Display, Georgia, serif"
    fontWeight: 400
    lineHeight: 1
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.025em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontWeight: 600
rounded:
  sm: "12px"
  md: "16px"
  lg: "24px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.velvet}"
    textColor: "{colors.velvet-ink}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px 24px"
  card:
    backgroundColor: "{colors.ivory}"
    rounded: "{rounded.lg}"
    padding: "20px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px"
  verdict-admit:
    backgroundColor: "{colors.admit}"
    textColor: "#ffffff"
  verdict-deny:
    backgroundColor: "{colors.deny}"
    textColor: "#ffffff"
---

# Design System: Curtain

## Overview

**Creative North Star: "The House Lights"**

Curtain looks like the room just before a show: warm paper programme stock under house lights, deep red velvet at the edges, and a single gold footlight. The product UI is quiet and legible, set in Geist on warm paper, so money states and actions read instantly; theatre arrives through the poster art, the velvet accent and the ticket itself, not through ornament on every surface. Dark mode is the stage with the lights down: near-black wood tones with the velvet lifted so it still reads.

Density is moderate and phone-first. Each page carries one dominant action in velvet; everything else sits in ink or muted ink. Status is always spelled out in words with an icon. The verdict screens at the door are the loudest thing in the system on purpose: full-bleed green or red with huge type.

**Key Characteristics:**
- Warm paper background (never pure white) with ivory surfaces.
- One velvet primary action per view.
- The ticket as the signature object: perforation line, notched edges, large mono ticket number.
- Posters in the house style: drawn-back velvet curtains, scalloped valance, gold tassels, DM Serif Display title.
- Money shown in naira, in words the buyer already knows: Protected, Paid to organizer, Refunded.

## Colors

A warm, low-saturation paper-and-wood neutral set carrying one saturated velvet accent, with green and red reserved for door verdicts and money outcomes.

### Primary
- **Theatre Velvet** (#8e1b2c): the primary action, links and the ticket number. In dark mode it lifts to **Lit Velvet** (#e05a6d) so links clear 4.5:1 on the dark surface.

### Secondary
- **Footlight Gold** (#f2b544): poster kickers and tassels only. Never used for UI text on paper.

### Neutral
- **Programme Paper** (#f6f1ea): page background in light mode.
- **Ivory** (#fffdf9): cards, the checkout panel, ticket stock.
- **Lamp-black Ink** (#1d1714): body text and headings.
- **Muted Ink** (#6f655d): secondary text, labels, metadata.
- **Hairline** (#e6ddd2): borders and dividers.
- **Stage Black** (#120d0c) and **Dark Surface** (#1c1513): background and surfaces with the house lights down.

### Status
- **Go** (#17703d light, #4ade80 dark): success words and ticks on paper.
- **Stop** (#b42318 light, #f87171 dark): errors and destructive actions.
- **Admit** (#146c37) and **Deny** (#a8201a): full-bleed verdict grounds under white text, identical in both modes.
- **Money series** (validated for colour-blind separation): Paid (#2a78d6), Protected (#c0394f), Refunded (#c98500).

### Named Rules
**The One Curtain Rule.** Velvet marks the single primary action and the brand; it never fills large areas of product UI.
**The Words-First Rule.** No status is carried by colour alone: every badge and verdict has a word and an icon.

## Typography

**Display Font:** DM Serif Display (with Georgia, serif), on posters today.
**Body Font:** Geist (with system-ui, sans-serif).
**Label/Mono Font:** Geist Mono, for ticket numbers and gate codes.

**Character:** A theatre-programme serif for names and headlines on posters, a clean grotesque for every piece of product UI, and a mono for anything a person reads aloud at the door.

### Hierarchy
- **Display** (400, poster scale, line-height ~1): show names on posters.
- **Headline** (600, 1.875rem to 3rem, tight tracking): page titles such as the show name and the home headline.
- **Title** (600, 1.125rem): section and card titles.
- **Body** (400, 1rem, 1.5): descriptions and explanations, max ~65ch.
- **Label** (500, 0.75rem, uppercase, wide tracking): field labels such as WHERE and WHEN.
- **Mono numerals** (600, 2rem to 2.25rem): ticket numbers (#12) and gate codes.

### Named Rules
**The Serif Is For The Show Rule.** The serif dresses show names and marketing headlines only; forms, metadata, money and dashboards stay in Geist.

## Layout

Single column on phones with a 16px gutter; from 1024px, buyer pages split into content and a sticky purchase column (about 1.2fr to 1fr), and dashboards into two columns. Content is capped at 72rem (max-w-6xl) with 16px gutters on phones and 32px on desktop. Vertical rhythm comes in steps of 12, 16, 20 and 24px. The phone event page has a fixed bottom buy bar that respects the safe area and steps aside when the checkout is on screen.

## Elevation & Depth

Flat by default: depth comes from tonal layering (paper behind ivory) and hairline borders, not shadows. The only shadows are the poster's drawn depth and the logo's soft drop. The verdict screens use full-bleed colour instead of elevation.

## Shapes

Soft, generous corners: 12px for inputs and small buttons, 16px for primary buttons and tiles, 24px for cards and the checkout panel, pills for nav items and badges. Tickets break the rectangle with a dashed perforation line and two half-circle notches cut into the edges.

## Components

### Buttons
- **Shape:** gently rounded (16px).
- **Primary:** Theatre Velvet with velvet-ink text, 16px by 24px padding, semibold.
- **Secondary:** hairline border, ink text, same size.
- **Focus:** a 2px velvet outline offset by 2px on every control.
- **Disabled:** 50% opacity.

### Cards / Containers
- **Corner Style:** 24px.
- **Background:** ivory on paper.
- **Shadow Strategy:** none; a 1px hairline border.
- **Internal Padding:** 20px (16px on phones).

### Inputs / Fields
- **Style:** hairline border, paper background, 12px radius, 12px padding, 16px text.
- **Focus:** border shifts to velvet plus the focus ring.

### Navigation
- **Style:** logo and wordmark left; Shows, My tickets (bordered pill), For organizers right; muted ink to ink on hover. Footer: How it works, Money board, Built on Monad, GitHub.

### Ticket card (signature)
Poster thumbnail and status badge above a dashed perforation with edge notches, then TICKET label and a large mono number in velvet, price on the right, and an action strip below.

### Verdict screen (signature)
Full-bleed Admit or Deny ground, a circled tick or cross, ADMIT or DO NOT ADMIT in very large black-weight type, the ticket number in mono, and the money line.

## Do's and Don'ts

### Do:
- **Do** keep the background warm paper (#f6f1ea) and surfaces ivory (#fffdf9).
- **Do** spell every status in words with an icon: Protected, Paid to organizer, Refunded, Checked in.
- **Do** show money in naira with the ₦ sign.
- **Do** honour reduced motion; motion only shows a state changing (protected to paid).

### Don't:
- **Don't** use pure white or pure black page backgrounds.
- **Don't** add gradients for excitement, glassmorphism, glows or crypto-dashboard styling.
- **Don't** use technical words (USDC, escrow, onchain, Monad) in buyer or organizer UI.
- **Don't** use em dashes in copy.
