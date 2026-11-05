# Gentle Stomach Map NYC

**Live site: https://nyc-stomach-map.vercel.app**

An NYC food map for people with acid reflux or gastritis. Shows only places that are **open right now**, what to order and what to avoid at each, and a "My stomach hurts now" button that lists what's open within a 20-minute walk, nearest first. Home / School / Work buttons sort by distance without GPS.

Static site, no build step, deployed on Vercel.

## Files

| File | Purpose |
| --- | --- |
| `index.html` / `styles.css` / `app.js` | Page, styles, logic (Leaflet 1.9.4 from unpkg; OSM `opening_hours` subset parser; geolocation) |
| `research.json` | **Source of truth** for places and chain guides, maintained by hand |
| `research-*.json` | Extra place sets (merged in by the build, deduped by name + address) |
| `build-data.js` | `node build-data.js` turns the JSON into `data.js` |
| `data.js` | Generated; the page loads this |
| `test-hours.js` | `node test-hours.js` tests the opening-hours parser |

## Adding a place

Add an entry to `places` in `research.json` (or a `research-<area>.json`):

```json
{
  "name": "Congee Village", "name_local": "粥之家",
  "address": "100 Allen St, New York, NY 10002", "neighborhood": "Lower East Side",
  "lat": 40.71885, "lng": -73.99075,
  "hours": "Su-Th 11:00-22:00; Fr,Sa 11:00-23:00",
  "tier": "safe",
  "cats": ["congee", "late"],
  "buy": ["Sliced fish congee (鱼片粥)", "Chicken congee (鸡肉粥)"],
  "avoid": "No fried crullers, no chili oil.",
  "confidence": "medium",
  "source": "https://...",
  "notes": "Cash only."
}
```

- `hours` uses OSM syntax: `Mo-Fr 08:00-22:00; Sa,Su 09:00-23:00`, `24/7`, `Mo-Su 10:00-02:00` (overnight), `Su off`.
- `tier`: `safe` = the whole menu is gentle (congee, udon, soup shops); `ok` = an ordinary place with a few gentle items.
- `cats`: `congee` `noodle` `soymilk` `bakery` `grocery` `late` (`late` is also added automatically for places open past 23:00).
- `confidence`: `high` only when hours come from the official site; anything else shows "Hours unverified; call before you go."

Then `node build-data.js` and redeploy.

## Local preview

```bash
npx serve .
```
