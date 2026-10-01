---
title: "Swiggy Instamart — Order groceries on Swiggy Instamart, cart to checkout"
sidebar_label: "Swiggy Instamart"
description: "Order groceries on Swiggy Instamart, cart to checkout"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Swiggy Instamart

Order groceries on Swiggy Instamart, cart to checkout.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/shopping/swiggy-instamart` |
| Version | `1.0.0` |
| Author | Aditya Krishnan Mohan |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `Swiggy`, `Instamart`, `Groceries`, `Shopping`, `Quick Commerce`, `MCP` |
| Related skills | [`zepto`](../../bundled/shopping/shopping-zepto.md), [`swiggy-food`](../../bundled/shopping/shopping-swiggy-food.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Scout loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Swiggy Instamart Skill

Search Instamart, build a cart and place real grocery orders on the user's Swiggy account through
the `swiggy-instamart` MCP connector. Swiggy orders cannot be cancelled once placed, so the
address, items and total are always confirmed first.

## When to Use

- The user asks to buy or order groceries or essentials "on Instamart" or "on Swiggy".
- The user asks about their Instamart cart, an order's status, or their usual items.

## Prerequisites

- The `swiggy-instamart` connector is installed and signed in (Capabilities → Connectors, or
  `scout mcp login swiggy-instamart`). This skill is only listed when its tools are loaded.

## How to Run

The tools are named `mcp__swiggy_instamart__<tool>`. When they are not in your tool list they are
deferred: load schemas with `tool_describe` and invoke with `tool_call`. They are never in the
codebase or on disk, so never use `search_files` or `terminal` to look for them.

## Quick Reference

| Step | Tool |
|---|---|
| Addresses | `get_addresses` (`create_address` only when the user gives a new one) |
| Find items | `search_products`, `your_go_to_items` (the user's usual buys) |
| Cart | `update_cart`, `get_cart`, `clear_cart` |
| Pay and order | `get_payment_options`, `checkout`, `confirm_order`, `check_payment_status` |
| After ordering | `get_orders`, `track_order`, `get_delivery_status` |

## Procedure

1. **Address first.** Call `get_addresses`. With several, ask which one. Never guess an address
   or create one the user did not give you.
2. **Find the item.** Search with the user's words, or start from `your_go_to_items` for "my
   usual". When results differ in size or price, show the top three and ask.
3. **Build the cart** with `update_cart`, then read it back with `get_cart`.
4. **Report honestly.** The cart belongs to the user's Swiggy session for Scout. Say it is ready
   to order, and do not claim it is visible in the Swiggy app.
5. **Confirm before ordering.** Show the items, total, delivery address and payment option from
   `get_payment_options` (Swiggy currently supports cash on delivery only). Remind the user that
   the order cannot be cancelled. Wait for an explicit yes.
6. **Place the order** with `checkout` and `confirm_order`, then report the order and ETA from
   `track_order`.

## Pitfalls

- Swiggy asks users not to have the Swiggy app open while ordering through the connector; the
  two sessions can conflict. Mention it if an order step fails unexpectedly.
- Never place an order, or retry a failed one, without a fresh confirmation.
- If a tool keeps failing, use `report_error` and tell the user, rather than looping.

## Verification

- `get_cart` shows exactly the requested items before checkout.
- After ordering, `get_orders` or `track_order` shows the new order.
