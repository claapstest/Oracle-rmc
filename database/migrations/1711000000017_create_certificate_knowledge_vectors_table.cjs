/**
 * Migration: Create Certificate Knowledge Vectors Table for Hybrid RAG
 * Feature: Stores semantic embeddings, descriptions, and policy documents for Access Certifications.
 * Supports pgvector when installed, and gracefully falls back to FLOAT8[] if vector extension binary is pending.
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- Attempt to enable pgvector extension if binary is present
    DO $$
    BEGIN
      BEGIN
        CREATE EXTENSION IF NOT EXISTS vector;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pgvector extension binary not found; falling back to FLOAT8[] vector representation.';
      END;
    END $$;

    -- Create certificate knowledge vectors table
    CREATE TABLE IF NOT EXISTS certificate_knowledge_vector (
      id BIGSERIAL PRIMARY KEY,
      certificate_id VARCHAR(255),
      certificate_name VARCHAR(255),
      document_type VARCHAR(100) NOT NULL DEFAULT 'POLICY', -- POLICY, DESCRIPTION, GUIDELINE, METADATA
      title VARCHAR(500) NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      embedding FLOAT8[] DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ix_cert_vector_cert_id ON certificate_knowledge_vector (certificate_id);
    CREATE INDEX IF NOT EXISTS ix_cert_vector_doc_type ON certificate_knowledge_vector (document_type);
    CREATE INDEX IF NOT EXISTS ix_cert_vector_title ON certificate_knowledge_vector (title);

    -- Helper cosine similarity function for FLOAT8[] fallback
    CREATE OR REPLACE FUNCTION cosine_similarity_float8(a FLOAT8[], b FLOAT8[])
    RETURNS FLOAT8 AS $$
    DECLARE
      dot_product FLOAT8 := 0;
      norm_a FLOAT8 := 0;
      norm_b FLOAT8 := 0;
      i INT;
      len INT;
    BEGIN
      len := cardinality(a);
      IF len IS NULL OR len = 0 OR cardinality(b) <> len THEN
        RETURN 0;
      END IF;
      FOR i IN 1..len LOOP
        dot_product := dot_product + (a[i] * b[i]);
        norm_a := norm_a + (a[i] * a[i]);
        norm_b := norm_b + (b[i] * b[i]);
      END LOOP;
      IF norm_a = 0 OR norm_b = 0 THEN
        RETURN 0;
      END IF;
      RETURN dot_product / (sqrt(norm_a) * sqrt(norm_b));
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS cosine_similarity_float8(FLOAT8[], FLOAT8[]);
    DROP TABLE IF EXISTS certificate_knowledge_vector CASCADE;
  `);
};
