# SHIP IT?! — AI Reality Check

A real AI-powered static website generation experience for a GDG event.

## Requirements
- Node.js 20+
- A Gemini API key from Google AI Studio

## Run locally
1. Copy `.env.example` to `.env`.
2. Put your Gemini API key in `GEMINI_API_KEY`.
3. Run `npm start`.
4. Open http://localhost:3000.

The API key stays on the server and is never sent to the browser.

## Experience
1. Visitor describes a website.
2. Gemini generates a complete standalone HTML/CSS/JS page.
3. The page runs in a sandboxed live preview.
4. Visitor can ask AI to refine the page.
5. Clicking Deploy runs a small educational pattern scan and reveals the difference between a static prototype and a production-ready application.

## Important
The generated website is a static front-end prototype. The Deploy scan is deliberately an educational demo, not a full security audit, penetration test, or guarantee that a website is production-ready. The scan checks a few visible code patterns and always explains that a static page has no real backend protections.
# ship-it-real
