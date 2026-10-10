---
title: "Swiggy Food — Order restaurant food delivery through Swiggy"
sidebar_label: "Swiggy Food"
description: "Order restaurant food delivery through Swiggy"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Swiggy Food

Order restaurant food delivery through Swiggy.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/shopping/swiggy-food` |
| Version | `1.0.0` |
| Author | Aditya Krishnan Mohan |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `Swiggy`, `Food Delivery`, `Restaurants`, `Shopping`, `MCP` |
| Related skills | [`swiggy-instamart`](../../bundled/shopping/shopping-swiggy-instamart.md), [`swiggy-dineout`](../../bundled/shopping/shopping-swiggy-dineout.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Scout loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Swiggy Food Skill

Find restaurants and dishes and place real food delivery orders on the user's Swiggy account
through the `swiggy-food` MCP connector. Orders cannot be cancelled once placed and are cash on
delivery, so Scout shows the user each order on a card they must approve before it is placed.

## When to Use

- The user asks to order food, a meal or a dish, or "get something delivered" via Swiggy.
- The user asks about a Swiggy food order's status.

## Prerequisites

- The `swiggy-food` connector is installed and signed in (Capabilities → Connectors, or
  `scout mcp login swiggy-food`). This skill is only listed when its tools are loaded.

## How to Run

The tools are named `mcp__swiggy_food__<tool>`. When they are not in your tool list, find them
with `tool_search` (queries such as `swiggy food address`, `swiggy food restaurant search`,
`swiggy food menu`, `swiggy food cart`, `swiggy food order`), load schemas with `tool_describe`
and invoke with `tool_call`. Never use `search_files` or `terminal` to look for them.

## Procedure

1. **Address first.** List the user's saved addresses and ask which one when there are several.
   Never guess a location.
2. **Choose the restaurant.** Search by dish or cuisine, then ask with `clarify`, passing a few options (name, rating,
   delivery time, price range) as `choices`, unless the user named one.
3. **Choose dishes** from that restaurant's menu, including size and customisations. Ask when a
   dish has required options.
4. **Build the cart** and read it back.
5. **Place the order** with `place_food_order`, reminding the user it cannot be cancelled. Scout
   stops that call and shows them an order card built from `get_food_cart` (dishes, bill, cash on
   delivery); it is placed only if they press Approve & Pay. Do not also ask for a yes in chat —
   the card is the confirmation. If the result says they did not approve, nothing was ordered;
   don't retry unless they ask.
6. **Report** the order id and ETA. Use the tracking tool when asked.

## Pitfalls

- A cart can only hold one restaurant's dishes. Switching restaurants clears or replaces it, so
  tell the user first.
- Do not claim the cart is visible in the Swiggy app; it belongs to the Scout session.
- Swiggy asks users not to have the Swiggy app open while ordering through the connector.
- Never retry an order the user cancelled on the order card, or one that failed, unless they ask.

## Verification

- The cart read back before ordering matches what the user confirmed.
- After ordering, the order status tool returns the new order.
