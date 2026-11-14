
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = resolve(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);

async function loadEnv() {
  try {
    const raw = await readFile(join(ROOT, ".env"), "utf8");

    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);

      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env is optional until an API key is needed.
  }
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff"
  });

  if (Buffer.isBuffer(data)) {
    res.end(data);
  } else {
    res.end(typeof data === "string" ? data : JSON.stringify(data));
  }
}

async function body(req) {
  let raw = "";

  for await (const chunk of req) {
    raw += chunk;

    if (raw.length > 30000) {
      throw new Error("Request too large");
    }
  }

  return JSON.parse(raw || "{}");
}

function extractText(data) {
  return (data.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || "")
    .join("\n")
    .trim();
}

function cleanHtml(text) {
  return text
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

async function generate(prompt, previousHtml = "") {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is missing. Add your key to the .env file, then restart the server."
    );
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

  const instruction = `
You are a senior front-end developer creating a polished STATIC website prototype for a live educational demo called SHIP IT?!.

Return ONLY a complete standalone HTML document. No markdown fences, no explanations.

Requirements:
- Make a genuinely attractive, modern, responsive page that directly fulfills the user's idea.
- Infer suitable content, brand name, sections, colors and visual style.
- Include all CSS in one <style> and vanilla JavaScript in one <script>.
- No build tools, no backend, no database, no external JS libraries, no imports.
- It must work entirely as a static front-end demo.
- Forms must show a realistic demo success state and must clearly not claim to send or store real data.
- Cart, search and menu interactions should work locally where appropriate.
- Use semantic HTML, mobile responsive layout, visible focus states, sensible labels and accessible contrast.
- Use CSS gradients and simple inline SVG, emoji or typography instead of relying on remote images.
- Avoid external image URLs.
- Include a small unobtrusive footer note:
  "Prototype experience — not connected to a live service."
- Do not include dangerous code, data exfiltration, credential collection, or deceptive payment flows.
- Aim for a complete landing/product experience, not a generic template.
`;

  const contents = previousHtml
    ? `Existing generated website:\n${previousHtml.slice(0, 18000)}\n\nUser's requested change:\n${prompt}\n\nUpdate the complete page. Return the entire HTML document only.`
    : `User's website idea:\n${prompt}\n\nCreate the complete page now.`;

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: instruction }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: contents }]
        }
      ],
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 24000
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Gemini API returned ${response.status}`
    );
  }


const html = cleanHtml(extractText(data));

if (
  !html.toLowerCase().includes("<!doctype html") &&
  !html.toLowerCase().includes("<html")
) {
  throw new Error(
    "The AI response did not contain a complete HTML page. Please try again."
  );
}

if (!html.toLowerCase().includes("</html>")) {
  throw new Error(
    "AI generated incomplete HTML. Please try Generate again."
  );
}

return html;
}


function scan(html) {
  const findings = [];
  const lower = html.toLowerCase();

  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)]
    .map(match => match[0]);

  const inputs = [...html.matchAll(/<input\b[^>]*>/gi)]
    .map(match => match[0]);

  const labels = (html.match(/<label\b/gi) || []).length;

  if (
    !lower.includes('name="viewport"') &&
    !lower.includes("name='viewport'")
  ) {
    findings.push([
      "HIGH",
      "Mobile viewport not configured",
      "Without a viewport declaration, mobile browsers may render the page at a desktop-like width.",
      "Add a responsive viewport meta tag and verify the layout on real device sizes."
    ]);
  }

  if (forms.length && forms.some(form => !/\brequired\b/i.test(form))) {
    findings.push([
      "HIGH",
      "Form validation may be incomplete",
      "At least one form does not visibly require its fields. Client-side checks alone are not enough for production.",
      "Validate inputs on both client and server, and show clear field-level errors."
    ]);
  }

  if (inputs.length > labels) {
    findings.push([
      "MEDIUM",
      "Some form controls may lack accessible labels",
      "The scan found more input controls than label elements. Placeholder text is not a reliable label.",
      "Associate every control with a label and test keyboard and screen-reader navigation."
    ]);
  }

  if (
    /\binnerHTML\s*=\s*[^"'`]/i.test(html) ||
    /\bdocument\.write\s*\(/i.test(html)
  ) {
    findings.push([
      "HIGH",
      "Potentially unsafe DOM injection pattern",
      "A dynamic HTML insertion pattern was detected. Its safety depends on how the value is produced.",
      "Avoid inserting untrusted strings as HTML. Prefer textContent or sanitize trusted markup."
    ]);
  }

  if (
    !lower.includes("prototype experience") &&
    !lower.includes("prototype")
  ) {
    findings.push([
      "MEDIUM",
      "Prototype boundaries are not clearly communicated",
      "The page may look like a live service even though it is only a front-end prototype.",
      "Clearly label demo-only interactions and never imply that payments or data are really processed."
    ]);
  }

  if (!findings.length) {
    findings.push([
      "INFO",
      "No obvious issues detected by this demo scan",
      "This lightweight check did not detect the selected patterns. It is not a security audit or a full test suite.",
      "Run automated tests, dependency checks, accessibility audits and a proper security review before launch."
    ]);
  }

  findings.push([
    "CRITICAL",
    "No real backend or server-side protection",
    "This is a static page. It cannot securely authenticate users, authorize admin actions, store orders or verify payments.",
    "Build and secure the backend, enforce authorization server-side, validate data and test the complete system."
  ]);

  return findings;
}

await loadEnv();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    if (req.method === "GET" && url.pathname === "/api/status") {
      return send(res, 200, {
        configured: !!process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash"
      });
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const data = await body(req);

      if (
        typeof data.prompt !== "string" ||
        data.prompt.trim().length < 8
      ) {
        return send(res, 400, {
          error: "Describe your website idea in at least 8 characters."
        });
      }

      if (data.prompt.length > 1800) {
        return send(res, 400, {
          error: "Keep your idea under 1,800 characters."
        });
      }

      const html = await generate(
        data.prompt.trim(),
        typeof data.previousHtml === "string" ? data.previousHtml : ""
      );

      return send(res, 200, { html });
    }

    if (req.method === "POST" && url.pathname === "/api/scan") {
      const data = await body(req);

      if (
        typeof data.html !== "string" ||
        data.html.length > 250000
      ) {
        return send(res, 400, {
          error: "Invalid page source."
        });
      }

      return send(res, 200, {
        findings: scan(data.html),
        disclaimer:
          "Educational demo scan only. These pattern checks are not a complete security, accessibility or production-readiness audit."
      });
    }

    if (req.method === "GET") {
      const pathname =
        url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);

      const file = resolve(PUBLIC, `.${pathname}`);

      if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) {
        return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
      }

      const content = await readFile(file);

      return send(
        res,
        200,
        content,
        mime[extname(file)] || "application/octet-stream"
      );
    }

    return send(res, 404, { error: "Not found" });
  } catch (err) {
    const status = err.message === "Request too large" ? 413 : 500;

    return send(res, status, {
      error: err.message || "Unexpected server error"
    });
  }
});

server.listen(PORT, () => {
  console.log(`SHIP IT?! is running at http://localhost:${PORT}`);
});
