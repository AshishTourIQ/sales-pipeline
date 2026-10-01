# Sending leads to the TourIQ sales pipeline (Intake API)

For the teams building the **pricing game**, the **comparative analysis** and the **audit** tools.

When someone uses your tool and fills in the contact form (to get the report emailed or to join
the leaderboard), send one request to the pipeline. The pipeline finds the lead or creates it,
records the step on their journey, and moves the deal toward a demo. Your tool still sends the
report or PDF email itself; the pipeline only keeps the record and the link.

## 1. Get a key

A pipeline admin creates one in **Settings → Integrations → Create key**, named after your tool
(for example "Pricing game"). The key looks like `spk.8f1c…e2.Q9x…` and is shown **once**.

- Keep it on your **server** (an environment variable). Never put it in browser or app code.
- One key per tool. If a key leaks, the admin revokes it and makes a new one.

## 2. Send an event

```
POST {API_BASE}/api/sales-pipeline/intake/
Authorization: Bearer spk.xxxxxxxx
Content-Type: application/json
```

(`X-Intake-Key: spk.xxxxxxxx` works too, if your HTTP client makes the `Authorization` header awkward.)

```json
{
  "event": "game_played",
  "event_id": "game-2026-10-13-000184",
  "contact": { "name": "Ana Reef", "email": "ana@reeftours.com", "phone": "+1 555 0100", "title": "Owner" },
  "company": { "name": "Reef Tours", "website": "reeftours.com" },
  "score": "912",
  "link": "https://game.touriq.ai/results/000184",
  "detail": "Leaderboard entry, Arival day 2",
  "occurred_at": "2026-10-13T15:42:00Z"
}
```

| Field | Required | Notes |
|---|---|---|
| `event` | yes | One of the events below |
| `contact.email` or `company.name` | one of them | Email is the best match; send both when you have them |
| `event_id` | recommended | Your own unique id for this event. Sending the same id again (a retry) is recorded once |
| `contact.name`, `.phone`, `.title` | no | Used only when the lead is new, or to fill empty fields |
| `company.website` | no | Also used to match (by domain, `www.` ignored) |
| `score` | no | Game score, up to 40 characters |
| `link` | no | The view-only report or result page (`https://…`) |
| `detail` | no | Up to 500 characters, shown on the deal |
| `trade_show` | no | The trade show where your tool was used, e.g. `"Arival 2026"`. Set on new leads only |
| `occurred_at` | no | ISO 8601; defaults to now |
| `pipeline_id` | no | Only if the admin asks you to; defaults to the main pipeline |

### Events

| `event` | Send it when | Track |
|---|---|---|
| `game_played` | Someone finishes the game and gives their details | Game |
| `analysis_viewed` | Someone views their comparative analysis | Comparative analysis |
| `analysis_sent` | The analysis PDF is emailed to them (they filled in the form) | Comparative analysis |
| `audit_submitted` | Someone uploads their booking data for the audit | Audit |
| `audit_report_sent` | The audit report is emailed to them | Audit |
| `demo_requested` | Someone asks for a demo from inside your tool | (straight to demo) |

## 3. What happens

1. **Matching.** The pipeline looks for the contact by email, then the company by website domain,
   then by name. Leads marked Lost are skipped (a new deal is opened), except people who asked
   not to be contacted: for those the step is logged and nothing else happens.
2. **New lead.** A company, contact and deal are created, with the source set from your tool
   ("Game", "Comparative analysis" or "Audit"), in the **Offer sent** stage on your track. A
   `demo_requested` lead starts at **Demo booked**.
3. **Existing lead.** The step is added to their journey. If the deal hasn't reached Offer sent
   yet it moves there; `demo_requested` moves it to Demo booked. Deals further along never move back.
4. The sales team gets tasks and reminders to follow up and book the demo.

## 4. Responses

`201 Created` (new lead) or `200 OK` (matched an existing one):

```json
{ "deal_id": "0b6e…", "stage": "offer", "created": true, "duplicate": false, "touchpoint_id": "7a1d…" }
```

`duplicate: true` means this `event_id` was already recorded; nothing changed.

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid` | Missing `event`, or neither `contact.email` nor `company.name`, or a bad field; `detail` says which |
| 401 | `invalid_key` | Missing, wrong or revoked key |
| 404 | `not_found` | Unknown `pipeline_id` |
| 409 | `no_pipeline` | The workspace has no pipeline yet |
| 429 | `throttled` | Too many requests: 120 per minute and 5000 per day per key, 600 per minute per server address, by default. An address that sends 20 wrong keys in an hour is blocked for the hour. `detail` says how long to wait |

Errors are JSON: `{"detail": "…", "code": "…"}`.

## 5. Retries

Network errors and `5xx` / `429` are safe to retry **with the same `event_id`**. Don't retry `4xx`
other than 429: fix the request instead.

## 6. Try it

```bash
curl -X POST "$API_BASE/api/sales-pipeline/intake/" \
  -H "Authorization: Bearer $TOURIQ_INTAKE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"event":"game_played","event_id":"test-1","contact":{"name":"Test Person","email":"test@example.com"},"company":{"name":"Test Tours"},"score":"500"}'
```

The test lead appears on the board in **Offer sent** with a "Game" badge. Delete it from the deal
drawer when you're done.
