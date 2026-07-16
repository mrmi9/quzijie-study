-- AlterTable
ALTER TABLE `practice_answers`
  ADD COLUMN `points_awarded` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `unlocked_achievements` JSON NULL;

-- AlterTable
ALTER TABLE `exam_results`
  ADD COLUMN `points_awarded` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `unlocked_achievements` JSON NULL;

-- Initialize JSON columns for existing rows
UPDATE `practice_answers` SET `unlocked_achievements` = JSON_ARRAY() WHERE `unlocked_achievements` IS NULL;
UPDATE `exam_results` SET `unlocked_achievements` = JSON_ARRAY() WHERE `unlocked_achievements` IS NULL;
ALTER TABLE `practice_answers` MODIFY `unlocked_achievements` JSON NOT NULL;
ALTER TABLE `exam_results` MODIFY `unlocked_achievements` JSON NOT NULL;

-- CreateTable
CREATE TABLE `user_gamification` (
  `user_id` CHAR(36) NOT NULL,
  `public_code` VARCHAR(4) NOT NULL,
  `display_name` VARCHAR(48) NULL,
  `nickname_updated_at` DATETIME(3) NULL,
  `total_points` INTEGER NOT NULL DEFAULT 0,
  `attempted_question_count` INTEGER NOT NULL DEFAULT 0,
  `correct_question_count` INTEGER NOT NULL DEFAULT 0,
  `equipped_achievement_key` VARCHAR(64) NULL,
  `points_updated_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `user_gamification_public_code_key`(`public_code`),
  INDEX `user_gamification_total_points_points_updated_at_idx`(`total_points`, `points_updated_at`),
  PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `point_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NOT NULL,
  `question_id` VARCHAR(191) NULL,
  `event_key` VARCHAR(191) NOT NULL,
  `type` ENUM('FIRST_ATTEMPT', 'FIRST_CORRECT', 'DAILY_REVIEW') NOT NULL,
  `points` INTEGER NOT NULL,
  `occurred_at` DATETIME(3) NOT NULL,
  `source_type` VARCHAR(32) NOT NULL,
  `source_id` VARCHAR(96) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `point_events_user_id_event_key_key`(`user_id`, `event_key`),
  INDEX `point_events_occurred_at_user_id_idx`(`occurred_at`, `user_id`),
  INDEX `point_events_user_id_occurred_at_idx`(`user_id`, `occurred_at`),
  INDEX `point_events_question_id_idx`(`question_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_achievements` (
  `user_id` CHAR(36) NOT NULL,
  `achievement_key` VARCHAR(64) NOT NULL,
  `unlocked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `user_achievements_achievement_key_unlocked_at_idx`(`achievement_key`, `unlocked_at`),
  PRIMARY KEY (`user_id`, `achievement_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_jobs` (
  `key` VARCHAR(96) NOT NULL,
  `completed_at` DATETIME(3) NOT NULL,
  `details` JSON NULL,

  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_gamification` ADD CONSTRAINT `user_gamification_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `point_events` ADD CONSTRAINT `point_events_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `point_events` ADD CONSTRAINT `point_events_question_id_fkey`
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `user_achievements` ADD CONSTRAINT `user_achievements_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
