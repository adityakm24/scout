---
title: "Swiggy Dineout — Find restaurants and book tables on Swiggy Dineout"
sidebar_label: "Swiggy Dineout"
description: "Find restaurants and book tables on Swiggy Dineout"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Swiggy Dineout

Find restaurants and book tables on Swiggy Dineout.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/shopping/swiggy-dineout` |
| Version | `1.0.0` |
| Author | Aditya Krishnan Mohan |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `Swiggy`, `Dineout`, `Restaurants`, `Table Booking`, `MCP` |
| Related skills | [`swiggy-food`](../../bundled/shopping/shopping-swiggy-food.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Scout loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Swiggy Dineout Skill

Find restaurants, check open slots and book tables on the user's Swiggy account through the
`swiggy-dineout` MCP connector. The connector supports free bookings only. A booking is a real
reservation, so Scout shows the user each booking on a card they must approve before it is made.

## When to Use

- The user asks to book a table, reserve a restaurant, or find a place to eat out.
- The user asks which slots a restaurant has open.

## Prerequisites

- The `swiggy-dineout` connector is installed and signed in (Capabilities → Connectors, or
  `scout mcp login swiggy-dineout`). This skill is only listed when its tools are loaded.

## How to Run

The tools are named `mcp__swiggy_dineout__<tool>`. When they are not in your tool list, find them
with `tool_search` (queries such as `swiggy dineout restaurant search`, `swiggy dineout slots`,
`swiggy dineout book table`), load schemas with `tool_describe` and invoke with `tool_call`.
Never use `search_files` or `terminal` to look for them.

## Procedure

1. **Gather the details:** area or restaurant, date, time and number of guests. Ask for whatever
   the user has not said. Never assume a city or location.
2. **Search** for restaurants and show a few with cuisine, rating and price for two.
3. **Check slots** for the chosen restaurant on that date and offer the closest times as `clarify`
   `choices`.
4. **Check the slot.** Booking is free only; if the slot needs a paid deal or deposit, say that it
   cannot be booked here.
5. **Book** with `book_table`. Scout stops that call and shows the user a booking card (restaurant,
   date, time, party size); the table is booked only if they press Book table. Do not also ask for
   a yes in chat. If the result says they did not approve, nothing was booked. Report the
   confirmation details.

## Pitfalls

- Dates are in the restaurant's local time. Resolve "tomorrow" and "tonight" against today's date
  and repeat the actual date back to the user.
- Never retry a booking the user cancelled on the card, or one that failed, unless they ask.

## Verification

- The booking response shows the confirmed restaurant, date, time and party size.
