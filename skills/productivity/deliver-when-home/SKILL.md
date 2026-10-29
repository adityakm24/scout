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

Helps time a grocery order so delivery can arrive near the user's return home. It estimates the
drive and delivery times, then schedules a reminder to review the order at the right moment.
Scheduling never authorizes a purchase; the user must request and approve the order when reminded.

## When to Use

- "I'm leaving the office — get my usual snacks so they're home when I am."
- "Order 2 Red Bulls on Zepto to arrive when I get home."

Not for "order now": build the cart and place it with `mcp__zepto__create_order` directly.

## Strict Negative Constraints

- NEVER suggest, pitch, or ask the user to order, buy, deliver, or sync groceries/food/orders unless the user EXPLICITLY requested food, groceries, snacks, shopping, or ordering in their prompt!
- When the user only asks for their ETA, drive time, commute duration, or directions (e.g. "What is my ET to work at NetApp hoodi"), answer ONLY with the drive time, distance, and live traffic. NEVER offer or ask "Would you like to sync an order to arrive when you reach...".

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
| Where the user is, drive time | `device_location` with `to_latitude` / `to_longitude` |
| Zepto's delivery time | `mcp__zepto__get_location_serviceability` (`etaMinutes` or similar) |
| Active tracking / Commute sync | `start_commute_eta_sync` with destination coordinates and `target_eta_minutes` |
| Usual items | `mcp__zepto__get_past_order_items` |
| Find and add items | `mcp__zepto__search_products` / `search_multiple_products`, `mcp__zepto__update_cart` |
| Check the basket | `mcp__zepto__view_cart` (prices in paise: ₹ = paise ÷ 100) |
| Order later | `schedule_order` with `drive_minutes`, `delivery_minutes` |

## Procedure

1. **Home / Destination Address.** ALWAYS call `mcp__zepto__list_saved_addresses` first.
   - **Always prompt the user to confirm/choose the destination address via `clarify`**, even if they named an address (like Office or Home) in their message. Offer the saved Zepto addresses as choices (putting the best matching address first as recommended, e.g. `["Home - 123 Main St", "Work - 456 Tech Park", ...]`).
   - Never guess coordinates or skip address confirmation. This ensures safety, avoids ordering/tracking to the wrong dark store, and gives the user certainty.
   - Once chosen/confirmed, call `mcp__zepto__select_saved_address` with that `addressId` immediately so Zepto binds the active store to that destination, and use that address's exact coordinates for drive ETA and Zepto delivery ETA.
2. **Drive time.** `device_location` with `to_latitude` and `to_longitude` set to home. Read
   `drive.drive_minutes_estimate`. If the location is refused, ask the user how long until they
   are home and use that.
3. **Delivery time & Live Tracking.** `mcp__zepto__get_location_serviceability` with the destination coordinates; read the
   delivery ETA in minutes (assume 15 if it gives none).
   - Call `start_commute_eta_sync` once the destination is known whenever scheduling around the user's arrival. Include Zepto's live ETA as `target_eta_minutes` when timing a delivery. The phone asks for background location access and refreshes the route while locked; if the user declines Always access, explain that an arrival-triggered reminder cannot be guaranteed.
4. **Basket.** For each item the user named — or their usual items from
   `mcp__zepto__get_past_order_items` when they say "my usual" — search, then add it with
   `mcp__zepto__update_cart` (`deviceId` "scout", `cartItems` with `productVariantId`,
   `storeProductId`, `quantity`). Then `mcp__zepto__view_cart` and check it matches the request.
5. **Schedule a review.** `schedule_order` with `server` "zepto", `tool` "create_order" (cash on delivery),
   `arguments` `{"userAddressId": "<home addressId from step 1>"}`, `drive_minutes` from step 2 and
   `delivery_minutes` from step 3. It works out when to review the order (drive − delivery − 3 minutes)
   and has Zepto check the order first. This schedules a reminder only: no order is placed or authorized.
   At the reminder, ask the user to request the order, rebuild/check the cart, and show a fresh approval
   card before purchasing.
6. **Too close to home?** If `schedule_order` says the delivery would arrive after them anyway,
   place it now with `mcp__zepto__create_order` (`confirmOrder: true`; they approve the card).
7. **Response Formatting & Tracking Display**:
   - Commute tools return `tracking_summary`; the app renders it as a status card. Do not paste raw SVG/`tracking_card_markdown` into your response.
   - After `start_commute_eta_sync` or `get_commute_eta_sync_status`, reply in **one or two short sentences** (e.g. tracking is on, when to order, or that live location refreshed). Mention **`origin_address`** from the tool when the user cares where GPS thinks they are.
   - The iPhone updates the tracking card when Scout returns to the foreground. Call **`get_commute_eta_sync_status`** for an immediate fresh route check while the app is open. iOS may suspend tracking after the user force-quits Scout; do not promise delivery across a force-quit.
   - If an order review was scheduled: state the estimated total and approximate review timing, and make clear that nothing is ordered or pre-authorized. With commute tracking, the reminder fires when the refreshed route ETA approaches the delivery time, not at a fixed clock time. It arrives in the originating chat or Bot Chat; the user must request the order then and approve its fresh card.

## Pitfalls

- Never invent an `addressId` or coordinates: take both from `mcp__zepto__list_saved_addresses`.
  Zepto rejects an unknown id, and `schedule_order` refuses it before the user is asked.
- `schedule_order` does not place the order later. With `drive_minutes`, it requires active commute tracking and queues a location-triggered review; if tracking is not active, start it first. At the reminder, rebuild/check the cart and get fresh
  user approval via the normal order card.
- If the user declines the card, nothing is scheduled. Do not retry unless they ask.
- Quote prices in rupees, not paise.

## Verification

- `schedule_order` returned `scheduled: true`, `purchase_authorized: false`, `review_at` and the estimate.
- `planner` with `reminder_list` shows the review reminder.
