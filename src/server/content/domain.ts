// Creative State Machine (Brief §51) — placeholder, typed from day one.
export const CONTENT_STATES = [
  'IDEA', 'INTENT', 'PLANNING', 'STORY', 'STORYBOARD',
  'GENERATING', 'REVIEW', 'RENDERING', 'READY', 'PUBLISHED',
] as const
export type ContentStatus = (typeof CONTENT_STATES)[number]
export type Visibility = 'PRIVATE' | 'UNLISTED' | 'PUBLIC'

