-- Add name/title column to video_manifests for admin identification
ALTER TABLE video_manifests ADD COLUMN IF NOT EXISTS name text DEFAULT '';

-- Backfill names from existing segment file_names
UPDATE video_manifests vm
SET name = COALESCE(
  (SELECT ms.file_name FROM mega_segments ms WHERE ms.manifest_id = vm.id ORDER BY ms.segment_num LIMIT 1),
  vm.id::text
)
WHERE vm.name IS NULL OR vm.name = '';
