-- ============================================================
-- COMMUNITY SYSTEM — Full migration
-- ============================================================

-- 1. community_posts
CREATE TABLE IF NOT EXISTS community_posts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lesson_id bigint NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) >= 3 AND char_length(title) <= 200),
  description text NOT NULL CHECK (char_length(description) <= 10000),
  image_url text,
  is_pinned boolean NOT NULL DEFAULT false,
  is_solved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_lesson ON community_posts(lesson_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON community_posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON community_posts(is_pinned);

-- 2. community_comments
CREATE TABLE IF NOT EXISTS community_comments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id bigint NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id bigint REFERENCES community_comments(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) <= 5000),
  is_verified_answer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON community_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON community_comments(parent_id);

-- 3. community_likes
CREATE TABLE IF NOT EXISTS community_likes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id bigint NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_post_like UNIQUE (user_id, post_id)
);

-- 4. community_reports
CREATE TABLE IF NOT EXISTS community_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id bigint REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id bigint REFERENCES community_comments(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_target CHECK (
    (post_id IS NOT NULL AND comment_id IS NULL) OR
    (post_id IS NULL AND comment_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_reports_post ON community_reports(post_id);
CREATE INDEX IF NOT EXISTS idx_reports_comment ON community_reports(comment_id);

-- 5. banned_words
CREATE TABLE IF NOT EXISTS banned_words (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  word text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. user_bans
CREATE TABLE IF NOT EXISTS user_bans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason text NOT NULL,
  ban_type text NOT NULL CHECK (ban_type IN ('warning', 'temporary', 'permanent')),
  expires_at timestamptz,
  is_permanent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bans_user ON user_bans(user_id);

-- 7. notifications
CREATE TABLE IF NOT EXISTS notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('comment', 'like', 'verified_answer', 'reply')),
  post_id bigint REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id bigint REFERENCES community_comments(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

-- ============================================================
-- RLS: Enable on all tables
-- ============================================================
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE banned_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper: get user level from profile
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_level(uid uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT level FROM profiles WHERE id = uid;
$$;

-- Helper: get post's level from lesson->course chain
CREATE OR REPLACE FUNCTION get_post_level(pid bigint)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT c.level
  FROM community_posts p
  JOIN lessons l ON l.id = p.lesson_id
  JOIN courses c ON c.id = l.course_id
  WHERE p.id = pid;
$$;

-- ============================================================
-- RLS: community_posts
-- ============================================================
CREATE POLICY "read_posts_own_level" ON community_posts
  FOR SELECT USING (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM lessons l JOIN courses c ON c.id = l.course_id
      WHERE l.id = lesson_id AND c.level = get_user_level(auth.uid())
    )
  );

CREATE POLICY "insert_own_posts" ON community_posts
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND user_id = auth.uid()
  );

CREATE POLICY "update_own_or_admin_posts" ON community_posts
  FOR UPDATE USING (
    auth.role() = 'authenticated' AND (
      user_id = auth.uid() OR
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
    )
  );

CREATE POLICY "delete_posts_admin" ON community_posts
  FOR DELETE USING (
    auth.role() = 'authenticated' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
  );

-- ============================================================
-- RLS: community_comments
-- ============================================================
CREATE POLICY "read_comments_own_level" ON community_comments
  FOR SELECT USING (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM community_posts p
      JOIN lessons l ON l.id = p.lesson_id
      JOIN courses c ON c.id = l.course_id
      WHERE p.id = post_id AND c.level = get_user_level(auth.uid())
    )
  );

CREATE POLICY "insert_own_comments" ON community_comments
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND user_id = auth.uid()
  );

CREATE POLICY "delete_own_or_admin_comments" ON community_comments
  FOR DELETE USING (
    auth.role() = 'authenticated' AND (
      user_id = auth.uid() OR
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
    )
  );

CREATE POLICY "update_own_comments" ON community_comments
  FOR UPDATE USING (
    auth.role() = 'authenticated' AND user_id = auth.uid()
  );

CREATE POLICY "teacher_verified_answer" ON community_comments
  FOR UPDATE USING (
    auth.role() = 'authenticated' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
  );

-- ============================================================
-- RLS: community_likes
-- ============================================================
CREATE POLICY "read_likes_own_level" ON community_likes
  FOR SELECT USING (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM community_posts p
      JOIN lessons l ON l.id = p.lesson_id
      JOIN courses c ON c.id = l.course_id
      WHERE p.id = post_id AND c.level = get_user_level(auth.uid())
    )
  );

CREATE POLICY "insert_own_likes" ON community_likes
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND user_id = auth.uid()
  );

CREATE POLICY "delete_own_likes" ON community_likes
  FOR DELETE USING (
    auth.role() = 'authenticated' AND user_id = auth.uid()
  );

-- ============================================================
-- RLS: community_reports
-- ============================================================
CREATE POLICY "insert_own_reports" ON community_reports
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND user_id = auth.uid()
  );

CREATE POLICY "read_reports_admin" ON community_reports
  FOR SELECT USING (
    auth.role() = 'authenticated' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
  );

CREATE POLICY "delete_reports_admin" ON community_reports
  FOR DELETE USING (
    auth.role() = 'authenticated' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
  );

-- ============================================================
-- RLS: banned_words
-- ============================================================
CREATE POLICY "read_banned_words" ON banned_words
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "manage_banned_words_admin" ON banned_words
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
  );

CREATE POLICY "delete_banned_words_admin" ON banned_words
  FOR DELETE USING (
    auth.role() = 'authenticated' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
  );

-- ============================================================
-- RLS: user_bans
-- ============================================================
CREATE POLICY "read_bans_admin" ON user_bans
  FOR SELECT USING (
    auth.role() = 'authenticated' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
  );

CREATE POLICY "insert_bans_admin" ON user_bans
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'teacher')
  );

-- ============================================================
-- RLS: notifications
-- ============================================================
CREATE POLICY "read_own_notifications" ON notifications
  FOR SELECT USING (
    auth.role() = 'authenticated' AND user_id = auth.uid()
  );

CREATE POLICY "update_own_notifications" ON notifications
  FOR UPDATE USING (
    auth.role() = 'authenticated' AND user_id = auth.uid()
  );

-- ============================================================
-- Helper function: check if post/comment contains banned words
-- ============================================================
CREATE OR REPLACE FUNCTION check_banned_words(content text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM banned_words
    WHERE content ILIKE '%' || word || '%'
  );
END;
$$;

-- ============================================================
-- Helper function: check if user is currently banned
-- ============================================================
CREATE OR REPLACE FUNCTION is_user_banned(uid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_bans
    WHERE user_id = uid AND (
      is_permanent = true OR
      (expires_at IS NOT NULL AND expires_at > now())
    )
  );
$$;

-- ============================================================
-- FK: ensure lessons.course_id FK exists
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lessons_course_id_fkey'
  ) THEN
    ALTER TABLE lessons ADD CONSTRAINT lessons_course_id_fkey
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- pg_cron: schedule daily cleanup of posts older than 14 days
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.schedule(
  'community-cleanup',
  '0 3 * * *',
  $$DELETE FROM community_posts
    WHERE created_at < now() - interval '14 days'
    AND is_pinned = false$$
);
