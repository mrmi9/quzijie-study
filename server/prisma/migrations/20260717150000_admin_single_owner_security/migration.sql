-- Add an explicit audit classification for independent and owner self-review.
ALTER TABLE `draft_reviews`
  ADD COLUMN `review_mode` ENUM('INDEPENDENT', 'SELF_APPROVED') NOT NULL DEFAULT 'INDEPENDENT',
  ADD COLUMN `checklist` JSON NULL,
  ADD COLUMN `self_review_note` TEXT NULL;

ALTER TABLE `catalog_draft_reviews`
  ADD COLUMN `review_mode` ENUM('INDEPENDENT', 'SELF_APPROVED') NOT NULL DEFAULT 'INDEPENDENT',
  ADD COLUMN `checklist` JSON NULL,
  ADD COLUMN `self_review_note` TEXT NULL;

ALTER TABLE `import_batch_reviews`
  ADD COLUMN `review_mode` ENUM('INDEPENDENT', 'SELF_APPROVED') NOT NULL DEFAULT 'INDEPENDENT',
  ADD COLUMN `checklist` JSON NULL,
  ADD COLUMN `self_review_note` TEXT NULL;

-- Step-up failures are persisted on the session so the protection works
-- consistently across CloudRun instances.
ALTER TABLE `admin_sessions`
  ADD COLUMN `step_up_failed_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `step_up_locked_until` DATETIME(3) NULL;

-- The singleton row is the durable completion marker for web bootstrap.
CREATE TABLE `admin_bootstrap_state` (
  `id` INTEGER NOT NULL,
  `admin_user_id` CHAR(36) NOT NULL,
  `completed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `admin_bootstrap_state_admin_user_id_key`(`admin_user_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `admin_bootstrap_state_admin_user_id_fkey`
    FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
