// INTENTIONAL boundary violation — self-test fixture (ignored by main lint).
// Violated rule: API routes may only import commands/http/env (thin bindings).
import { CONTENT_STATES } from '@/server/content/domain'

void CONTENT_STATES
