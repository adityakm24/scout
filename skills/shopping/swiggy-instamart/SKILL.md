---
name: swiggy-instamart
description: "Order groceries on Swiggy Instamart, cart to checkout."
version: 1.0.0
author: Aditya Krishnan Mohan
license: MIT
platforms: [linux, macos, windows]
metadata:
  scout:
    tags: [Swiggy, Instamart, Groceries, Shopping, Quick Commerce, MCP]
    requires_toolsets: [mcp-swiggy-instamart]
    related_skills: [zepto, swiggy-food]
---

# Swiggy Instamart Skill

Search Instamart, build a cart and place real grocery orders on the user's Swiggy account through
the `swiggy-instamart` MCP connector. Swiggy orders cannot be cancelled once placed, so Scout
shows the user each order on a card they must approve before it is placed.

## When to Use

- The user asks to buy or order groceries or essentials "on Instamart" or "on Swiggy".
- The user asks about their Instamart cart, an order's status, or their usual items.

## Prerequisites

- The `swiggy-instamart` connector is installed and signed in (Capabilities → Connectors, or
  `scout mcp login swiggy-instamart`). This skill is only listed when its tools are loaded.

## How to Run

Call `mcp__swiggy_instamart__get_addresses` directly — it stays on the live tool list. Other
Instamart tools may be behind `tool_describe` / `tool_call`. They are never in the codebase or
on disk: never use `search_files` or `terminal`. Missing from the list is not a restricted
environment — invoke with `tool_call`, do not tell the user the tools are inaccessible.

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
   usual". When results differ in size or price, ask with `clarify`, passing the top three as `choices`.
3. **Build the cart** with `update_cart`, then read it back with `get_cart`.
4. **Report honestly.** The cart belongs to the user's Swiggy session for Scout. Say it is ready
   to order, and do not claim it is visible in the Swiggy app.
5. **Choose how to pay** with `get_payment_options` (Swiggy currently supports cash on delivery
   only), and remind the user the order cannot be cancelled.
6. **Place the order** with `checkout`. Scout stops that call and shows the user an order card
   built from `get_cart` (the basket, the bill, the payment); the order is placed only if they
   press Approve & Pay. Do not also ask for a yes in chat — the card is the confirmation. If the
   result says they did not approve, nothing was ordered; don't retry unless they ask. After a
   UPI payment, finish with `confirm_order`. Report the order and ETA from `track_order`.

## Pitfalls

- Never invent an address id. Call `get_addresses` and use the id it returns.
- Swiggy asks users not to have the Swiggy app open while ordering through the connector; the
  two sessions can conflict. Mention it if an order step fails unexpectedly.
- Never retry an order the user cancelled on the order card, or one that failed, unless they ask.
- If a tool keeps failing, use `report_error` and tell the user, rather than looping.

## Verification

- `get_cart` shows exactly the requested items before checkout.
- After ordering, `get_orders` or `track_order` shows the new order.
