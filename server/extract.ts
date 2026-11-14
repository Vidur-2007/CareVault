// POST /api/extract: one image in, structured fields out, read by the Gemini API.
// Nothing is stored and request bodies are never logged.
import { GoogleGenAI } from '@google/genai';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export const SYSTEM_INSTRUCTION = [
  'You transcribe medicine packs, prescriptions and medical reports into structured fields.',
  'Transcribe only what is printed or written in the image.',
  'Use null for anything you cannot read. Use an empty list when there are no medicine lines.',
  'Do not infer, correct, complete or add anything from medical knowledge.',
  'Do not give advice, a diagnosis or an opinion.',
  'ingredients: name, strength and unit exactly as printed, per tablet or capsule.',
  'dosesPerDay: the number of dose units per day only if it is written (1-0-1 is 2). Otherwise null.',
  'documentDate: the date of the document as YYYY-MM-DD, or null. Never a manufacturing or expiry date.',
  'rawText: all the text you can read, line by line.',
].join(' ');

/** JSON Schema for the answer. Mirrors ExtractionCandidate in src/contract/types.ts. */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    documentType: { type: 'string', enum: ['prescription', 'lab_report', 'test', 'discharge_summary', 'other'] },
    documentDate: { type: ['string', 'null'] },
    prescriberName: { type: ['string', 'null'] },
    rawText: { type: 'string' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          productName: { type: 'string' },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                strength: { type: 'number' },
                unit: { type: 'string', enum: ['mcg', 'mg', 'g', 'ml', 'IU'] },
              },
              required: ['name', 'strength', 'unit'],
            },
          },
          form: { type: 'string', enum: ['tablet', 'capsule', 'syrup', 'other'] },
          dosesPerDay: { type: ['number', 'null'] },
          instruction: { type: 'string' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: ['productName', 'ingredients', 'form', 'dosesPerDay', 'instruction', 'warnings'],
      },
    },
  },
  required: ['documentType', 'documentDate', 'prescriberName', 'rawText', 'lines'],
} as const;

/** Reads one image and returns the model's JSON answer, parsed. */
export type Extractor = (imageBase64: string, mimeType: string) => Promise<unknown>;

export function createGeminiExtractor(apiKey: string, model: string): Extractor {
  const ai = new GoogleGenAI({ apiKey });
  return async (imageBase64, mimeType) => {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: 'Transcribe this image into the fields.' }],
        },
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_SCHEMA,
        temperature: 0,
      },
    });
    return JSON.parse(response.text ?? '');
  };
}

export function geminiExtractorFromEnv(env: NodeJS.ProcessEnv): Extractor | null {
  if (!env.GEMINI_API_KEY || !env.GEMINI_MODEL) return null;
  return createGeminiExtractor(env.GEMINI_API_KEY, env.GEMINI_MODEL);
}

const requestBody = z.object({
  imageBase64: z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mimeType: z.string().regex(/^image\/(jpeg|png|webp|heic|heif)$/),
});

const answer = z.object({
  documentType: z.unknown(),
  documentDate: z.unknown(),
  prescriberName: z.unknown(),
  rawText: z.unknown(),
  lines: z.array(z.unknown()),
});

export function extractRoutes(extractor: Extractor | null): Hono {
  const app = new Hono();

  app.post(
    '/',
    // Base64 is a third larger than the image; leave room for the JSON around it.
    bodyLimit({ maxSize: Math.ceil(MAX_IMAGE_BYTES * 1.4), onError: (c) => c.json({ error: 'The image is larger than 6 MB.' }, 413) }),
    async (c) => {
      if (!extractor) return c.json({ error: 'Cloud reading is not set up on this server.' }, 503);
      const parsed = requestBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: 'Send one image as base64 with its type.' }, 400);
      const { imageBase64, mimeType } = parsed.data;
      if (Math.floor((imageBase64.length * 3) / 4) > MAX_IMAGE_BYTES) return c.json({ error: 'The image is larger than 6 MB.' }, 413);

      let result: unknown;
      try {
        result = await extractor(imageBase64, mimeType);
      } catch {
        // The cause may quote the request, so it is not logged or returned.
        return c.json({ error: 'The cloud reader could not read this image.' }, 502);
      }
      const checked = answer.safeParse(result);
      if (!checked.success) return c.json({ error: 'The cloud reader returned something unreadable.' }, 502);
      return c.json({ ...checked.data, engine: 'cloud', needsCloud: false });
    },
  );

  return app;
}
