import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { randomUUID } from "crypto";
import rateLimit from "express-rate-limit";
import admin from "firebase-admin";
import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };
import { loadServerConfig } from "./server/config.js";
import { discoverRecipeBannerImageUrl, pickBannerImageFromHtml } from "./server/discoverRecipeBanner.js";
import { extractStructuredRecipeFromHtml } from "./server/jsonLdRecipe.js";
import { htmlToPlainRecipeText } from "./server/htmlToText.js";
import { fetchPublicHtml } from "./server/pageFetch.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFiles() {
  // dotenv's default `import "dotenv/config"` only loads `.env`.
  // Vite commonly uses `.env.local` for local secrets; mirror that for the Express server.
  const root = process.cwd();
  // Preserve vars explicitly set in the parent process (e.g. `PORT=3001 npm run dev`)
  // so `.env.local` cannot accidentally override ad-hoc CLI overrides.
  const preserveKeys = ["PORT", "HOST", "NODE_ENV"] as const;
  const preserved = new Map<string, string | undefined>();
  for (const key of preserveKeys) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      preserved.set(key, process.env[key]);
    }
  }

  dotenv.config({ path: path.join(root, ".env") });
  dotenv.config({ path: path.join(root, ".env.local"), override: true });

  for (const [key, value] of preserved.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

loadEnvFiles();

type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "AI_UPSTREAM_ERROR"
  | "AI_BAD_RESPONSE"
  | "INTERNAL_ERROR";

type ApiErrorResponse = {
  code: ApiErrorCode;
  message: string;
  requestId: string;
};

type RequestWithId = express.Request & { requestId: string };

// Lazy initialization of Gemini
let aiClient: GoogleGenAI | null = null;
function getAiClient() {
  if (!aiClient) {
    const apiKey = loadServerConfig().geminiApiKey;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in the environment.");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

let firebaseAdminApp: admin.app.App | null = null;
function getFirebaseAdminApp() {
  if (!firebaseAdminApp) {
    // Uses Application Default Credentials (ADC). In GCP/AI Studio this is typically available.
    // For local dev, you may need GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`.
    firebaseAdminApp = admin.initializeApp({ projectId: firebaseConfig.projectId });
  }
  return firebaseAdminApp;
}

async function verifyFirebaseIdToken(idToken: string) {
  const app = getFirebaseAdminApp();
  return admin.auth(app).verifyIdToken(idToken);
}

function getRequestId(req: express.Request): string {
  const existing = (req as any).requestId;
  return typeof existing === "string" && existing.length > 0 ? existing : "unknown";
}

function respondError(
  res: express.Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId: string
) {
  const body: ApiErrorResponse = { code, message, requestId };
  res.status(status).json(body);
}

function parseModelJson(text: string | undefined): unknown {
  if (!text) return {};
  return JSON.parse(text);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function getBearerToken(req: express.Request): string | null {
  const header = req.header("authorization") || req.header("Authorization");
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

const RECIPE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    ingredients: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          amount: { type: Type.STRING },
          unit: { type: Type.STRING },
        },
        required: ["name", "amount", "unit"]
      }
    },
    instructions: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    nutritionalInfo: {
      type: Type.OBJECT,
      properties: {
        calories: { type: Type.NUMBER },
        protein: { type: Type.NUMBER },
        carbs: { type: Type.NUMBER },
        fat: { type: Type.NUMBER },
      }
    },
    prepTime: { type: Type.NUMBER },
    cookTime: { type: Type.NUMBER },
    servings: { type: Type.NUMBER },
  },
  required: ["title", "ingredients", "instructions"]
};

async function startServer() {
  const config = loadServerConfig();
  const app = express();
  const PORT = config.port;

  app.use((req, res, next) => {
    const requestId = randomUUID();
    (req as RequestWithId).requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  });

  app.use((req, res, next) => {
    const startMs = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startMs;
      console.log("[Request]", {
        requestId: getRequestId(req),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
      });
    });
    next();
  });

  // Middleware for parsing JSON
  app.use(express.json({ limit: '20mb' }));

  const aiLimiter = rateLimit({
    windowMs: config.aiRateLimit.windowMs,
    limit: config.aiRateLimit.limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      respondError(
        res,
        429,
        "RATE_LIMITED",
        "Too many requests. Please retry later.",
        getRequestId(req)
      );
    },
  });

  app.use("/api/ai", aiLimiter);

  app.use("/api/ai", async (req, res, next) => {
    if (!config.requireAiAuth) return next();

    const requestId = getRequestId(req);
    const token = getBearerToken(req);
    if (!token) {
      return respondError(res, 401, "AUTH_REQUIRED", "Missing Authorization: Bearer <token>", requestId);
    }

    try {
      await verifyFirebaseIdToken(token);
      return next();
    } catch (error) {
      console.warn("[Auth] Invalid Firebase token", { requestId, error });
      return respondError(res, 403, "FORBIDDEN", "Invalid or expired auth token", requestId);
    }
  });

  // AI API routes
  app.post("/api/ai/extract-url", async (req, res) => {
    const requestId = getRequestId(req);
    try {
      const { url } = req.body ?? {};
      if (!isNonEmptyString(url)) {
        return respondError(res, 400, "VALIDATION_ERROR", "Body.url must be a non-empty string", requestId);
      }
      const trimmedUrl = url.trim();

      let doc: Awaited<ReturnType<typeof fetchPublicHtml>> = null;
      try {
        doc = await fetchPublicHtml(trimmedUrl);
      } catch (err) {
        console.warn("[extract-url] HTML fetch failed", { requestId, message: String(err) });
      }

      const structured = doc ? extractStructuredRecipeFromHtml(doc.html) : null;
      const textExcerpt = doc ? htmlToPlainRecipeText(doc.html, 88_000) : "";
      const banner = doc ? pickBannerImageFromHtml(doc.html, doc.finalUrl) : null;

      const verifiedBlock =
        structured?.ingredientLines?.length
          ? `PUBLISHER_SCHEMA_INGREDIENT_LINES (verbatim; every output ingredient must correspond to one of these lines — do not add or substitute items such as extra meats not listed here):\n${structured.ingredientLines
              .map((l, i) => `${i + 1}. ${l}`)
              .join("\n")}\n\n`
          : "";

      const prompt = doc
        ? `You convert recipe web pages into structured JSON for our application.

STRICT RULES:
- Use ONLY information in PUBLISHER_SCHEMA_INGREDIENT_LINES (if present) and/or PAGE_TEXT below. Do NOT use other recipes, "classic" versions, or approximate ingredient lists from memory.
- Do NOT invent ingredients (example: do not add ground pork if the source only lists ground beef).
- If PUBLISHER_SCHEMA_INGREDIENT_LINES is present: build the "ingredients" array ONLY from those lines — one object per line, splitting name/amount/unit faithfully from the line text. Do not merge or rename items.
- For "instructions", use ONLY steps supported by PAGE_TEXT. If unclear, output fewer steps — never guess full procedures.
- For title, prepTime, cookTime, servings, nutritionalInfo, prefer values explicitly stated in PAGE_TEXT or the schema lines.

PAGE_URL: ${trimmedUrl}

${verifiedBlock}---PAGE_TEXT_START---
${textExcerpt}
---PAGE_TEXT_END---
`
        : `The recipe page HTML could not be downloaded. URL: ${trimmedUrl}

Return minimal structured JSON. Do NOT fabricate ingredients: if you cannot see ingredients in the URL alone, return an empty ingredients array [].`;

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: RECIPE_SCHEMA
        }
      });
      const recipe = parseModelJson(response.text) as Record<string, unknown>;

      if (structured?.ingredientLines?.length) {
        recipe.ingredients = structured.ingredients;
      }
      if (structured?.title && structured.title.trim()) {
        recipe.title = structured.title.trim();
      }
      if (structured?.description && structured.description.trim() && !isNonEmptyString(recipe.description)) {
        recipe.description = structured.description.trim();
      }

      if (typeof banner === "string" && banner.length > 0) {
        recipe.imageUrl = banner;
      }
      (recipe as { sourceUrl?: string }).sourceUrl = trimmedUrl;
      res.json(recipe);
    } catch (error: any) {
      console.error("[AI Server Error]", { requestId, route: "/api/ai/extract-url", error });
      if (error instanceof SyntaxError) {
        return respondError(res, 502, "AI_BAD_RESPONSE", "AI returned invalid JSON", requestId);
      }
      return respondError(res, 502, "AI_UPSTREAM_ERROR", error?.message || "AI request failed", requestId);
    }
  });

  /** Pinterest-style hero image from a public recipe URL (OG / Twitter / JSON-LD / img); no Gemini. */
  app.post("/api/ai/recipe-banner", async (req, res) => {
    const requestId = getRequestId(req);
    try {
      const { url } = req.body ?? {};
      if (!isNonEmptyString(url)) {
        return respondError(res, 400, "VALIDATION_ERROR", "Body.url must be a non-empty string", requestId);
      }
      const trimmed = url.trim();
      const imageUrl = await discoverRecipeBannerImageUrl(trimmed);
      res.json({ imageUrl: imageUrl ?? null });
    } catch (error: any) {
      console.error("[AI Server Error]", { requestId, route: "/api/ai/recipe-banner", error });
      return respondError(res, 502, "INTERNAL_ERROR", error?.message || "Banner lookup failed", requestId);
    }
  });

  app.post("/api/ai/extract-text", async (req, res) => {
    const requestId = getRequestId(req);
    try {
      const { text } = req.body ?? {};
      if (!isNonEmptyString(text)) {
        return respondError(res, 400, "VALIDATION_ERROR", "Body.text must be a non-empty string", requestId);
      }
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: `Extract recipe details from this text into structured JSON. Use ONLY what appears in the text — do not add ingredients from memory or similar recipes.\n\n${text}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: RECIPE_SCHEMA
        }
      });
      res.json(parseModelJson(response.text));
    } catch (error: any) {
      console.error("[AI Server Error]", { requestId, route: "/api/ai/extract-text", error });
      if (error instanceof SyntaxError) {
        return respondError(res, 502, "AI_BAD_RESPONSE", "AI returned invalid JSON", requestId);
      }
      return respondError(res, 502, "AI_UPSTREAM_ERROR", error?.message || "AI request failed", requestId);
    }
  });

  app.post("/api/ai/extract-image", async (req, res) => {
    const requestId = getRequestId(req);
    try {
      const { image, mimeType } = req.body ?? {};
      if (!isNonEmptyString(image)) {
        return respondError(res, 400, "VALIDATION_ERROR", "Body.image must be a non-empty base64 string", requestId);
      }
      if (mimeType != null && !isNonEmptyString(mimeType)) {
        return respondError(res, 400, "VALIDATION_ERROR", "Body.mimeType must be a non-empty string when provided", requestId);
      }
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: {
          parts: [
            {
              text: `Transcribe the recipe from this image into structured JSON.

STRICT RULES:
- Only include ingredients and steps you can clearly read in the image. If text is blurry or missing, omit it — do not guess.
- Do NOT add "typical" ingredients for this kind of recipe from memory (no extra meats, spices, or pantry staples unless they appear in the image).
- If you cannot read any ingredients, return an empty ingredients array [].`,
            },
            { inlineData: { data: image, mimeType: mimeType || "image/jpeg" } }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: RECIPE_SCHEMA
        }
      });
      res.json(parseModelJson(response.text));
    } catch (error: any) {
      console.error("[AI Server Error]", { requestId, route: "/api/ai/extract-image", error });
      if (error instanceof SyntaxError) {
        return respondError(res, 502, "AI_BAD_RESPONSE", "AI returned invalid JSON", requestId);
      }
      return respondError(res, 502, "AI_UPSTREAM_ERROR", error?.message || "AI request failed", requestId);
    }
  });

  app.post("/api/ai/meal-plan", async (req, res) => {
    const requestId = getRequestId(req);
    try {
      const { userProfile, availableRecipes, startDate } = req.body ?? {};
      if (typeof userProfile !== "object" || userProfile == null) {
        return respondError(res, 400, "VALIDATION_ERROR", "Body.userProfile must be an object", requestId);
      }
      if (!Array.isArray(availableRecipes)) {
        return respondError(res, 400, "VALIDATION_ERROR", "Body.availableRecipes must be an array", requestId);
      }
      if (!isNonEmptyString(startDate)) {
        return respondError(res, 400, "VALIDATION_ERROR", "Body.startDate must be a non-empty string (yyyy-mm-dd)", requestId);
      }
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: `Generate a 7-day meal plan starting from ${startDate}.
Return JSON only.
Rules:
- Every meal MUST reference a recipe from availableRecipes by exact id.
- Set recipeId to that recipe's id.
- Set recipeTitle to that recipe's title (must match the referenced recipe).

User Profile: ${JSON.stringify(userProfile)}
Available Recipes: ${JSON.stringify(availableRecipes)}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              days: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    date: { type: Type.STRING },
                    meals: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          type: { type: Type.STRING },
                          recipeTitle: { type: Type.STRING },
                          recipeId: { type: Type.STRING },
                        },
                        required: ["type", "recipeTitle", "recipeId"]
                      }
                    }
                  },
                  required: ["date", "meals"]
                }
              }
            },
            required: ["days"]
          }
        }
      });
      res.json(parseModelJson(response.text));
    } catch (error: any) {
      console.error("[AI Server Error]", { requestId, route: "/api/ai/meal-plan", error });
      if (error instanceof SyntaxError) {
        return respondError(res, 502, "AI_BAD_RESPONSE", "AI returned invalid JSON", requestId);
      }
      return respondError(res, 502, "AI_UPSTREAM_ERROR", error?.message || "AI request failed", requestId);
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      env: config.env,
      requestId: getRequestId(req),
      requireAiAuth: config.requireAiAuth,
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Starting in development mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[Server] Starting in production mode...");
    const distPath = path.resolve(process.cwd(), "dist");
    
    // Serve static assets
    app.use(express.static(distPath, { index: false }));
    
    // SPA fallback
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
    const key = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY;
    if (key) {
      console.log(`[Server] AI key configured (GEMINI_API_KEY/API_KEY/GOOGLE_API_KEY)`);
    } else {
      console.warn(`[Server] WARNING: No AI Key found in environment variables.`);
    }
  });
}

startServer().catch(err => {
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
