---
name: deliver-when-home
description: Time a grocery order to arrive when the user gets home.
version: 1.0.0
author: Aditya Krishnan Mohan (@adityakm24), Scout Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  scout:
    tags: [Zepto, Groceries, Delivery, Location, Commute]
    category: productivity
    related_skills: [google-workspace]
---

# Deliver When Home Skill

Orders groceries or snacks from Zepto so the delivery reaches the user's home about when they do.
It reads where the user is now, estimates the drive home, subtracts Zepto's delivery time, and
schedules the order for the right moment. The user approves the exact basket once, up front;
Scout places it later only if the basket and total are unchanged. It never orders without that.

## When to Use

- "I'm leaving the office — get my usual snacks so they're home when I am."
- "Order 2 Red Bulls on Zepto to arrive when I get home."

Not for "order now": build the cart and place it with `mcp__zepto__create_order` directly.

## Prerequisites

- The `zepto` MCP server connected (`scout mcp login zepto`), with a saved home address.
- The user chatting from the Scout app (phone or desktop), so `device_location` can read where
  they are. Without it, ask how many minutes until they are home.

## How to Run

Load this skill and follow the Procedure. Zepto tools may be deferred: call them through
`tool_call` by the names below if they are not listed.

## Quick Reference

| Step | Tool |
|---|---|
| Home address and its coordinates | `mcp__zepto__list_saved_addresses`, then `mcp__zepto__select_saved_address` |
| Where the user is, drive time home | `device_location` with `to_latitude` / `to_longitude` |
| Zepto's delivery time | `mcp__zepto__get_location_serviceability` (`etaMinutes` or similar) |
| Usual items | `mcp__zepto__get_past_order_items` |
| Find and add items | `mcp__zepto__search_products` / `search_multiple_products`, `mcp__zepto__update_cart` |
| Check the basket | `mcp__zepto__view_cart` (prices in paise: ₹ = paise ÷ 100) |
| Order later | `schedule_order` with `drive_minutes`, `delivery_minutes` |

## Procedure

1. **Home.** `mcp__zepto__list_saved_addresses`; take the home address (label "Home", or the one
   memory says is home). Note its `addressId`, latitude and longitude, and call
   `mcp__zepto__select_saved_address` with that `addressId`.
2. **Drive time.** `device_location` with `to_latitude` and `to_longitude` set to home. Read
   `drive.drive_minutes_estimate`. If the location is refused, ask the user how long until they
   are home and use that.
3. **Delivery time.** `mcp__zepto__get_location_serviceability` with the home coordinates; read the
   delivery ETA in minutes (assume 15 if it gives none).
4. **Basket.** For each item the user named — or their usual items from
   `mcp__zepto__get_past_order_items` when they say "my usual" — search, then add it with
   `mcp__zepto__update_cart` (`deviceId` "scout", `cartItems` with `productVariantId`,
   `storeProductId`, `quantity`). Then `mcp__zepto__view_cart` and check it matches the request.
5. **Schedule.** `schedule_order` with `server` "zepto", `tool` "create_order" (cash on delivery),
   `arguments` `{"userAddressId": "<home addressId from step 1>"}`, `drive_minutes` from step 2 and
   `delivery_minutes` from step 3. It works out when to order (drive − delivery − 3 minutes) and
   has Zepto check the order first. The user approves the card, which shows the time.
6. **Too close to home?** If `schedule_order` says the delivery would arrive after them anyway,
   place it now with `mcp__zepto__create_order` (`confirmOrder: true`; they approve the card).
7. **Tell the user** in two short lines: what was ordered and the total; when Scout will place it
   and when it should arrive. Say the drive time is an estimate without live traffic.

## Pitfalls

- Never invent an `addressId` or coordinates: take both from `mcp__zepto__list_saved_addresses`.
  Zepto rejects an unknown id, and `schedule_order` refuses it before the user is asked.
- Do not call `mcp__zepto__create_order` with `confirmOrder: true` for a later order:
  `schedule_order` places it at the time, and only if the basket and total are unchanged.
- Do not touch the cart after scheduling. A changed basket is refused at placing time, by design;
  if the user wants changes, update the cart and call `schedule_order` again.
- If the user declines the card, nothing is scheduled. Do not retry unless they ask.
- Quote prices in rupees, not paise.

## Verification

- `schedule_order` returned `scheduled: true` with `places_at` and the total.
- `cronjob_manage` with action `list` shows a "Zepto order at …" job.
