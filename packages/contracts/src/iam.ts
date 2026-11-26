import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required').max(200),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userViewSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  companyId: z.string().uuid(),
  companyName: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

export type UserView = z.infer<typeof userViewSchema>;

export const sessionViewSchema = z.object({
  user: userViewSchema,
  csrfToken: z.string(),
});

export type SessionView = z.infer<typeof sessionViewSchema>;
