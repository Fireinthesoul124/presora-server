import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth';
import { extractPrescriptionFromImages, PrescriptionAiError } from '../lib/claudeExtraction';
import { isStorageConfigured, uploadImage } from '../lib/storage';
import type { Medicine, Prescription } from '@prisma/client';

export const prescriptionsRouter = Router();
prescriptionsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 5, fileSize: 15 * 1024 * 1024 } });

function toMedicineDTO(m: Medicine) {
  return {
    id: m.id,
    medicineName: m.medicineName,
    strength: m.strength,
    dosePattern: m.dosePattern,
    timing: m.timing,
    foodInstruction: m.foodInstruction,
    quantity: m.quantity,
    quantityUnit: m.quantityUnit,
    durationDays: m.durationDays,
    specialNotes: m.specialNotes ?? undefined,
    indication: m.indication ?? undefined,
    confidence: m.confidence,
    needsVerification: m.needsVerification,
    warnings: m.warnings,
  };
}

function toPrescriptionDTO(p: Prescription & { medicines: Medicine[] }) {
  return {
    id: p.id,
    status: p.status,
    images: p.images,
    doctorName: p.doctorName ?? undefined,
    createdAt: p.createdAt.toISOString(),
    startedAt: p.startedAt?.toISOString(),
    medicines: p.medicines.map(toMedicineDTO),
  };
}

prescriptionsRouter.get('/', async (req, res) => {
  const list = await prisma.prescription.findMany({
    where: { userId: (req as unknown as AuthedRequest).userId },
    include: { medicines: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(list.map(toPrescriptionDTO));
});

prescriptionsRouter.get('/:id', async (req, res) => {
  const p = await prisma.prescription.findFirst({
    where: { id: (req.params.id as string), userId: (req as unknown as AuthedRequest).userId },
    include: { medicines: true },
  });
  if (!p) return res.status(404).json({ message: 'Prescription not found' });
  res.json(toPrescriptionDTO(p));
});

/** FR-2.1/FR-2.2: accepts up to 5 photos, runs Claude Haiku 4.5 extraction (lib/claudeExtraction.ts). */
prescriptionsRouter.post('/upload', upload.array('pages', 5), async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) return res.status(400).json({ message: 'No pages uploaded' });

  const imageUrls: string[] = [];
  if (isStorageConfigured()) {
    try {
      for (const file of files) imageUrls.push(await uploadImage(userId, file.buffer, file.mimetype));
    } catch (err) {
      console.error('[prescriptions] R2 upload failed, continuing without persisted images:', err);
    }
  } else {
    console.warn('[prescriptions] R2 not configured — extraction will run, but images will not be saved for later viewing');
  }

  try {
    const extracted = await extractPrescriptionFromImages(files.map((f) => f.buffer));

    const created = await prisma.prescription.create({
      data: {
        userId,
        status: 'awaiting_confirmation',
        images: imageUrls,
        doctorName: extracted.doctorName,
        medicines: {
          create: extracted.medicines.map((m) => ({
            medicineName: m.medicineName,
            strength: m.strength,
            dosePattern: m.dosePattern,
            timing: m.timing,
            foodInstruction: m.foodInstruction,
            quantity: m.quantity,
            quantityUnit: m.quantityUnit,
            durationDays: m.durationDays,
            specialNotes: m.specialNotes,
            indication: m.indication,
            confidence: m.confidence,
            needsVerification: m.needsVerification,
            warnings: m.warnings,
          })),
        },
      },
      include: { medicines: true },
    });

    res.status(201).json(toPrescriptionDTO(created));
  } catch (err) {
    if (err instanceof PrescriptionAiError) return res.status(502).json({ message: err.message });
    console.error('[prescriptions] upload failed:', err);
    res.status(500).json({ message: 'Could not process this prescription' });
  }
});

const ConfirmSchema = z.object({
  medicines: z.array(
    z.object({
      id: z.string().optional(),
      medicineName: z.string(),
      strength: z.string(),
      dosePattern: z.string(),
      timing: z.array(z.enum(['morning', 'afternoon', 'night'])),
      foodInstruction: z.enum(['before food', 'after food', 'with food', 'any time']),
      quantity: z.number(),
      quantityUnit: z.string(),
      durationDays: z.number(),
      specialNotes: z.string().optional(),
      indication: z.string().optional(),
      confidence: z.record(z.string(), z.enum(['high', 'medium', 'low'])).default({}),
      needsVerification: z.boolean(),
      warnings: z.array(z.string()),
    })
  ),
});

/** FR-3.2.1 — the human-reviewed medicine list replaces whatever Claude originally extracted. */
prescriptionsRouter.post('/:id/confirm', async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const parsed = ConfirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid medicines payload' });

  const existing = await prisma.prescription.findFirst({ where: { id: (req.params.id as string), userId } });
  if (!existing) return res.status(404).json({ message: 'Prescription not found' });

  await prisma.medicine.deleteMany({ where: { prescriptionId: existing.id } });
  const updated = await prisma.prescription.update({
    where: { id: existing.id },
    data: {
      status: 'active',
      startedAt: new Date(),
      medicines: { create: parsed.data.medicines.map(({ id: _id, ...m }) => m) },
    },
    include: { medicines: true },
  });

  res.json(toPrescriptionDTO(updated));
});

async function setStatus(req: AuthedRequest, status: 'rejected' | 'archived') {
  const existing = await prisma.prescription.findFirst({ where: { id: (req.params.id as string), userId: req.userId } });
  if (!existing) return false;
  await prisma.prescription.update({ where: { id: existing.id }, data: { status } });
  return true;
}

prescriptionsRouter.post('/:id/reject', async (req, res) => {
  const ok = await setStatus(req as unknown as AuthedRequest, 'rejected');
  if (!ok) return res.status(404).json({ message: 'Prescription not found' });
  res.json({ ok: true });
});

prescriptionsRouter.post('/:id/archive', async (req, res) => {
  const ok = await setStatus(req as unknown as AuthedRequest, 'archived');
  if (!ok) return res.status(404).json({ message: 'Prescription not found' });
  res.json({ ok: true });
});
