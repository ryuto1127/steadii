-- Enable pgvector for email_embeddings (Phase 6 W2).
-- Neon supports this natively; IF NOT EXISTS keeps reruns safe.
CREATE EXTENSION IF NOT EXISTS vector;
