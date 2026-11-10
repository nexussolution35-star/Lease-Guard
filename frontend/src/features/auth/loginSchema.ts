import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Enter your password'),
})

export type LoginFormValues = z.input<typeof loginSchema>
export type LoginValues = z.output<typeof loginSchema>

/** `/login?redirect=…` search params. */
export const loginSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
})
