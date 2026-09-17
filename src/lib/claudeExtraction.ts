import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import sharp from 'sharp';

const MODEL = 'claude-haiku-4-5';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

export class PrescriptionAiError extends Error {}

const ConfidenceEnum = z.enum(['high', 'medium', 'low']);
const TimingEnum = z.enum(['morning', 'afternoon', 'night']);
const FoodEnum = z.enum(['before food', 'after food', 'with food', 'any time']);

const MedicineSchema = z.object({
  medicineName: z.string().describe('Medicine name exactly as written. Empty string if fully illegible.'),
  strength: z.string().describe('e.g. "200 mg". Empty string if not stated.'),
  dosePattern: z.string().describe('Morning-afternoon-night counts as three numbers joined by dashes, e.g. "1-0-1".'),
  timing: z.array(TimingEnum).describe('Which parts of the day this medicine is taken.'),
  foodInstruction: FoodEnum,
  quantity: z.number().int().min(0).describe('Units taken per dose, e.g. 1 for one tablet.'),
  quantityUnit: z.string().describe('e.g. "tablet", "capsule", "ml".'),
  durationDays: z.number().int().min(1).describe('How many days this course lasts. Guess 5 if genuinely unstated.'),
  specialNotes: z.string().optional().describe('Any handwritten note next to this medicine, e.g. "complete full course".'),
  indication: z
    .string()
    .optional()
    .describe('The condition this treats, e.g. "Fever", "Antibiotic", "Blood pressure" — inferred from the medicine class if not written.'),
  confidence: z
    .object({
      medicineName: ConfidenceEnum.optional(),
      strength: ConfidenceEnum.optional(),
      dosePattern: ConfidenceEnum.optional(),
      foodInstruction: ConfidenceEnum.optional(),
    })
    .describe('Your confidence in each field you read from handwriting.'),
  needsVerification: z.boolean().describe('True if any field is medium/low confidence or was guessed.'),
  warnings: z.array(z.string()).describe('Short safety notes, e.g. "Complete the full course unless your doctor advises otherwise".'),
});

const ExtractionResultSchema = z.object({
  doctorName: z.string().optional().describe("Prescribing doctor's name if legible on the page."),
  medicines: z.array(MedicineSchema).max(20),
  pageQuality: z.enum(['clear', 'partially_legible', 'poor']).describe('Overall legibility of the photo(s) provided.'),
});

export type ExtractedMedicine = z.infer<typeof MedicineSchema> & { id: string; reviewed: boolean };

const SYSTEM_PROMPT = `You are a careful prescription-transcription assistant inside a medicine reminder app called Presora.

You are shown one or more photos of a single handwritten or printed prescription. Transcribe exactly what is legible — never invent a medicine, strength, or dose that is not visibly on the page.

Rules:
- If a field is illegible or absent, use an empty string (for text) and mark that field's confidence as "low" rather than guessing convincingly.
- Infer "indication" (what the medicine treats) from the medicine's class only when it is not explicitly written, and only when you are reasonably confident.
- Mark needsVerification true whenever any field was uncertain, abbreviated, or partially illegible.
- You are not a doctor and this is not a diagnosis. Never state that a dose is safe or correct — only transcribe it.
- If the photo does not look like a prescription at all, return an empty medicines array.`;

async function normalizeImage(buffer: Buffer): Promise<string> {
  const resized = await sharp(buffer).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
  return resized.toString('base64');
}

/** Ported from the app's lib/ai/prescriptionExtraction.ts — same model, schema, and prompt, run server-side. */
export async function extractPrescriptionFromImages(imageBuffers: Buffer[]): Promise<{
  doctorName?: string;
  medicines: (z.infer<typeof MedicineSchema> & { reviewed: boolean })[];
}> {
  if (imageBuffers.length === 0) throw new PrescriptionAiError('No pages to read');

  const images = await Promise.all(imageBuffers.map(normalizeImage));

  let response;
  try {
    response = await client.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...images.map(
              (base64): Anthropic.ImageBlockParam => ({
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
              })
            ),
            {
              type: 'text',
              text:
                imageBuffers.length > 1
                  ? `These ${imageBuffers.length} photos are pages of one prescription. Extract every medicine.`
                  : 'Extract every medicine from this prescription photo.',
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ExtractionResultSchema) },
    });
  } catch (err) {
    console.error('[claudeExtraction] request failed:', err);
    if (err instanceof Anthropic.APIError) {
      throw new PrescriptionAiError(`Prescription reading failed (${err.status}): ${err.message}`);
    }
    throw new PrescriptionAiError('Could not reach Claude to read this prescription.');
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new PrescriptionAiError('Claude returned a response that could not be parsed.');

  return {
    doctorName: parsed.doctorName || undefined,
    medicines: parsed.medicines.map((m) => ({ ...m, reviewed: false })),
  };
}
