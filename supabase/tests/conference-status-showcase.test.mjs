import { readSqlSection } from './sqlSections.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';


test('conference showcase covers every status and is idempotent', async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      full_name text NOT NULL DEFAULT '',
      role text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.conferences (
      id uuid PRIMARY KEY,
      title text NOT NULL,
      description text DEFAULT '',
      start_date date NOT NULL,
      end_date date NOT NULL,
      location text DEFAULT '',
      status text NOT NULL CHECK (status IN ('draft','open','closed','ongoing','completed','cancelled')),
      organizer_id uuid NOT NULL REFERENCES public.profiles(id),
      cover_image_url text DEFAULT '',
      max_participants integer NOT NULL DEFAULT 0,
      submission_deadline timestamptz,
      review_deadline timestamptz,
      registration_deadline timestamptz,
      camera_ready_deadline timestamptz,
      blind_review boolean NOT NULL DEFAULT false,
      topics text[] NOT NULL DEFAULT ARRAY[]::text[],
      event_format text NOT NULL DEFAULT 'offline',
      is_featured boolean NOT NULL DEFAULT false,
      is_schedule_public boolean NOT NULL DEFAULT true,
      contact_name text DEFAULT '',
      contact_email text DEFAULT '',
      contact_phone text DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.papers (
      id uuid PRIMARY KEY,
      conference_id uuid NOT NULL REFERENCES public.conferences(id) ON DELETE CASCADE,
      title text NOT NULL,
      abstract text DEFAULT '',
      keywords text DEFAULT '',
      file_url text DEFAULT '',
      status text NOT NULL CHECK (status IN ('submitted','under_review','accepted','rejected','revision_required')),
      submitted_by uuid NOT NULL REFERENCES public.profiles(id),
      current_version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.reviews (
      id uuid PRIMARY KEY,
      paper_id uuid NOT NULL REFERENCES public.papers(id) ON DELETE CASCADE,
      reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
      status text NOT NULL DEFAULT 'assigned',
      score integer,
      originality_score integer,
      relevance_score integer,
      methodology_score integer,
      presentation_score integer,
      comments text DEFAULT '',
      recommendation text,
      response_at timestamptz,
      completed_at timestamptz,
      UNIQUE (paper_id, reviewer_id)
    );
    INSERT INTO public.profiles (id, full_name, role) VALUES
      ('00000000-0000-0000-0000-000000000001', 'Ban tổ chức', 'organizer'),
      ('00000000-0000-0000-0000-000000000002', 'Tác giả', 'author');
  `);

  await db.exec(`
    INSERT INTO public.profiles (id, full_name, role)
    VALUES ('00000000-0000-0000-0000-000000000003', 'Reviewer', 'reviewer');
  `);

  const migration = await readSqlSection('20260925_conference_status_showcase', 'conference_demo_data.sql');
  await db.exec(migration);
  await db.exec(migration);

  const conferenceCounts = await db.query(`
    SELECT status, count(*)::integer AS count
    FROM public.conferences
    WHERE id::text LIKE 'c0000000-%'
    GROUP BY status
    ORDER BY status
  `);
  assert.deepEqual(
    conferenceCounts.rows,
    [
      { status: 'cancelled', count: 1 },
      { status: 'closed', count: 1 },
      { status: 'completed', count: 1 },
      { status: 'draft', count: 1 },
      { status: 'ongoing', count: 1 },
      { status: 'open', count: 1 },
    ],
  );

  const paperCounts = await db.query(`
    SELECT status, count(*)::integer AS count
    FROM public.papers
    WHERE id::text LIKE 'd0000000-%'
    GROUP BY status
    ORDER BY status
  `);
  assert.deepEqual(
    paperCounts.rows,
    [
      { status: 'accepted', count: 6 },
      { status: 'rejected', count: 1 },
      { status: 'revision_required', count: 1 },
      { status: 'submitted', count: 2 },
      { status: 'under_review', count: 2 },
    ],
  );

  const inconsistentResults = await db.query(`
    SELECT count(*)::integer AS count
    FROM public.papers p
    WHERE p.id::text LIKE 'd0000000-%'
      AND p.status IN ('accepted', 'rejected', 'revision_required')
      AND NOT EXISTS (
        SELECT 1 FROM public.reviews r
        WHERE r.paper_id = p.id AND r.status = 'completed'
      )
  `);
  assert.equal(inconsistentResults.rows[0].count, 0);

  const missingPapers = await db.query(`
    SELECT count(*)::integer AS count
    FROM public.conferences c
    WHERE c.id::text LIKE 'c0000000-%'
      AND NOT EXISTS (
        SELECT 1 FROM public.papers p WHERE p.conference_id = c.id
      )
  `);
  assert.equal(missingPapers.rows[0].count, 0);

  const conferencesWithoutPublicPaper = await db.query(`
    SELECT count(*)::integer AS count
    FROM public.conferences c
    WHERE c.id::text LIKE 'c0000000-%'
      AND NOT EXISTS (
        SELECT 1
        FROM public.papers p
        WHERE p.conference_id = c.id AND p.status = 'accepted'
      )
  `);
  assert.equal(conferencesWithoutPublicPaper.rows[0].count, 0);

  await db.close();
});
