# Spotify IQ - Project Instructions

## Overview
A lightweight, fun web app where users paste a Spotify playlist link and get an "IQ estimate" based on their music taste. Inspired by Virgil Griffith's "Music That Makes You Dumb" chart and styled after neal.fun aesthetics.

## Architecture
- **Frontend:** Vanilla HTML/CSS/JS — minimal, playful, neal.fun-inspired
- **Backend:** Node.js + Express
- **Auth:** Spotify Client Credentials flow (server-to-server, no user login)
- **Data:** Static JSON file mapping Spotify genre tags → IQ scores
- **Hosting target:** Cloudflare Pages or Vercel (free tier)

## Spotify API Flow
1. User pastes playlist URL
2. Server extracts playlist ID from URL
3. Server fetches playlist tracks via `GET /playlists/{id}/tracks`
4. For each track, gets artist IDs
5. Batch fetches artists via `GET /artists?ids=...` (up to 50 per request)
6. Collects genre tags from all artists
7. Looks up each genre in genre-scores.json, calculates weighted average
8. Returns IQ score + breakdown to frontend

## Scoring System
- Based on Virgil Griffith's SAT-to-music chart, normalized to IQ range ~75-140
- Genre scores stored in `data/genre-scores.json`
- Final score = weighted average of genre scores by frequency
- Modifiers: diversity bonus, obscurity bonus, small random offset (±2)

## Key Files
- `server.js` — Express server, Spotify API calls, scoring logic
- `public/index.html` — Single page app
- `public/style.css` — neal.fun-inspired styling
- `public/script.js` — Frontend logic (paste link, show results)
- `data/genre-scores.json` — Genre → IQ score mapping
- `.env` — SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET

## Environment Variables
- `SPOTIFY_CLIENT_ID` — from Spotify Developer Dashboard
- `SPOTIFY_CLIENT_SECRET` — from Spotify Developer Dashboard
- `PORT` — defaults to 3000
