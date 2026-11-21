import { z } from 'zod';

/** Validation for the project form. Messages are shown to the person typing, so they stay plain. */
export const projectSchema = z.object({
  title: z.string().trim().min(1, 'Give this project a name.').max(80, 'Keep the name under 80 characters.'),
  description: z.string().trim().max(280, 'Keep the description under 280 characters.'),
  targetDate: z.string(),
  status: z.enum(['active', 'archived']),
});

export type ProjectFormValues = z.infer<typeof projectSchema>;
