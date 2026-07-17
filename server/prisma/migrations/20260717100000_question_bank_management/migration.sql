-- AlterTable
ALTER TABLE `chapters` ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `description` VARCHAR(512) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `practice_answers` ADD COLUMN `answer_type` ENUM('SINGLE', 'MULTIPLE', 'JUDGE', 'FILL_BLANK', 'SHORT_ANSWER') NOT NULL DEFAULT 'SINGLE',
    ADD COLUMN `normalized_text_answer` TEXT NULL,
    ADD COLUMN `self_assessment` ENUM('MASTERED', 'UNMASTERED') NULL,
    ADD COLUMN `text_answer` TEXT NULL,
    MODIFY `is_correct` BOOLEAN NULL;

-- Preserve the original historical question type from each immutable session snapshot.
UPDATE `practice_answers` AS `pa`
JOIN `practice_session_questions` AS `psq`
  ON `psq`.`session_id` = `pa`.`session_id` AND `psq`.`question_id` = `pa`.`question_id`
JOIN `question_versions` AS `qv`
  ON `qv`.`id` = `psq`.`question_version_id`
SET `pa`.`answer_type` = CASE LOWER(COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(`psq`.`snapshot`, '$.type')),
    `qv`.`type`
  ))
  WHEN 'multiple' THEN 'MULTIPLE'
  WHEN 'judge' THEN 'JUDGE'
  ELSE 'SINGLE'
END;

-- AlterTable
ALTER TABLE `question_versions` ADD COLUMN `accepted_answers` JSON NULL,
    ADD COLUMN `answer_config` JSON NULL,
    ADD COLUMN `reference_answer` TEXT NULL,
    MODIFY `type` ENUM('SINGLE', 'MULTIPLE', 'JUDGE', 'FILL_BLANK', 'SHORT_ANSWER') NOT NULL;

UPDATE `question_versions`
SET `accepted_answers` = JSON_ARRAY(),
    `answer_config` = JSON_OBJECT();

ALTER TABLE `question_versions`
    MODIFY `accepted_answers` JSON NOT NULL,
    MODIFY `answer_config` JSON NOT NULL;

-- AlterTable
ALTER TABLE `questions` ADD COLUMN `content_hash` CHAR(64) NULL,
    ADD COLUMN `external_code` VARCHAR(96) NULL,
    ADD COLUMN `source_reference` VARCHAR(191) NULL,
    ADD COLUMN `source_system` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `subjects` ADD COLUMN `color` VARCHAR(16) NOT NULL DEFAULT '#2563eb',
    ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `description` VARCHAR(512) NULL,
    ADD COLUMN `icon_key` VARCHAR(64) NULL,
    ADD COLUMN `quality_policy` JSON NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateTable
CREATE TABLE `catalog_modules` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(96) NOT NULL,
    `subtitle` VARCHAR(191) NULL,
    `color` VARCHAR(16) NOT NULL DEFAULT '#2563eb',
    `type` ENUM('SUBJECT', 'GROUP', 'EXAM') NOT NULL,
    `order` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `catalog_modules_order_key`(`order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catalog_module_subjects` (
    `module_id` VARCHAR(64) NOT NULL,
    `subject_id` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,

    UNIQUE INDEX `catalog_module_subjects_module_id_order_key`(`module_id`, `order`),
    PRIMARY KEY (`module_id`, `subject_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_users` (
    `id` CHAR(36) NOT NULL,
    `username` VARCHAR(64) NOT NULL,
    `display_name` VARCHAR(96) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `totp_secret_encrypted` TEXT NOT NULL,
    `roles` JSON NOT NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `password_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_sessions` (
    `id` CHAR(36) NOT NULL,
    `admin_user_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `csrf_token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `ip_hash` CHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_sessions_token_hash_key`(`token_hash`),
    INDEX `admin_sessions_admin_user_id_expires_at_idx`(`admin_user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_drafts` (
    `id` CHAR(36) NOT NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `external_code` VARCHAR(96) NULL,
    `base_version_id` CHAR(36) NULL,
    `subject_id` VARCHAR(191) NOT NULL,
    `chapter_id` VARCHAR(191) NOT NULL,
    `type` ENUM('SINGLE', 'MULTIPLE', 'JUDGE', 'FILL_BLANK', 'SHORT_ANSWER') NOT NULL,
    `stem` TEXT NOT NULL,
    `code` TEXT NULL,
    `explanation` TEXT NOT NULL,
    `difficulty` INTEGER NOT NULL,
    `tags` JSON NOT NULL,
    `images` JSON NOT NULL,
    `exam_scopes` JSON NOT NULL,
    `correct_option_ids` JSON NOT NULL,
    `accepted_answers` JSON NOT NULL,
    `answer_config` JSON NOT NULL,
    `reference_answer` TEXT NULL,
    `options` JSON NOT NULL,
    `content_hash` CHAR(64) NOT NULL,
    `action` ENUM('UPSERT', 'DISABLE') NOT NULL DEFAULT 'UPSERT',
    `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `validation_errors` JSON NOT NULL,
    `validation_warnings` JSON NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `submitted_by_id` CHAR(36) NULL,
    `submitted_at` DATETIME(3) NULL,
    `warnings_acknowledged_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `question_drafts_status_updated_at_idx`(`status`, `updated_at`),
    INDEX `question_drafts_subject_id_chapter_id_status_idx`(`subject_id`, `chapter_id`, `status`),
    INDEX `question_drafts_question_id_status_idx`(`question_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `draft_reviews` (
    `id` CHAR(36) NOT NULL,
    `draft_id` CHAR(36) NOT NULL,
    `reviewer_id` CHAR(36) NOT NULL,
    `decision` ENUM('APPROVED', 'REJECTED') NOT NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `draft_reviews_draft_id_created_at_idx`(`draft_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_import_batches` (
    `id` CHAR(36) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `source_hash` CHAR(64) NOT NULL,
    `source_object_key` VARCHAR(512) NULL,
    `source_expires_at` DATETIME(3) NULL,
    `status` ENUM('STAGING', 'VALID', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'CANCELLED') NOT NULL DEFAULT 'STAGING',
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `valid_rows` INTEGER NOT NULL DEFAULT 0,
    `error_rows` INTEGER NOT NULL DEFAULT 0,
    `warning_rows` INTEGER NOT NULL DEFAULT 0,
    `content_hash` CHAR(64) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `created_by_id` CHAR(36) NOT NULL,
    `submitted_by_id` CHAR(36) NULL,
    `submitted_at` DATETIME(3) NULL,
    `warnings_acknowledged_at` DATETIME(3) NULL,
    `published_release_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `question_import_batches_source_hash_created_by_id_key`(`source_hash`, `created_by_id`),
    INDEX `question_import_batches_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_batch_reviews` (
    `id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `reviewer_id` CHAR(36) NOT NULL,
    `decision` ENUM('APPROVED', 'REJECTED') NOT NULL,
    `content_hash` CHAR(64) NOT NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `import_batch_reviews_batch_id_created_at_idx`(`batch_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_import_rows` (
    `id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `row_number` INTEGER NOT NULL,
    `entity_type` VARCHAR(32) NOT NULL,
    `raw_data` JSON NOT NULL,
    `normalized_data` JSON NULL,
    `errors` JSON NOT NULL,
    `warnings` JSON NOT NULL,
    `draft_id` CHAR(36) NULL,

    INDEX `question_import_rows_batch_id_draft_id_idx`(`batch_id`, `draft_id`),
    UNIQUE INDEX `question_import_rows_batch_id_row_number_entity_type_key`(`batch_id`, `row_number`, `entity_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_releases` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `kind` ENUM('NORMAL', 'ROLLBACK', 'BASELINE') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('PREPARING', 'PUBLISHED', 'FAILED') NOT NULL DEFAULT 'PREPARING',
    `previous_release_id` CHAR(36) NULL,
    `snapshot_key` VARCHAR(512) NULL,
    `snapshot_hash` CHAR(64) NULL,
    `catalog_hash` CHAR(64) NULL,
    `snapshot_size` INTEGER NULL,
    `public_catalog` JSON NULL,
    `quality_warnings` JSON NULL,
    `quality_summary` JSON NULL,
    `verification_status` ENUM('PENDING', 'PASSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `verification_report` JSON NULL,
    `verification_started_at` DATETIME(3) NULL,
    `verification_completed_at` DATETIME(3) NULL,
    `verification_duration_ms` INTEGER NULL,
    `validation_error_count` INTEGER NOT NULL DEFAULT 0,
    `object_upload_failure_count` INTEGER NOT NULL DEFAULT 0,
    `missing_version_count` INTEGER NOT NULL DEFAULT 0,
    `api_5xx_count` INTEGER NOT NULL DEFAULT 0,
    `question_count` INTEGER NOT NULL DEFAULT 0,
    `created_by_id` CHAR(36) NULL,
    `published_by_id` CHAR(36) NULL,
    `catalog_draft_id` CHAR(36) NULL,
    `failure_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at` DATETIME(3) NULL,

    INDEX `question_releases_status_published_at_idx`(`status`, `published_at`),
    UNIQUE INDEX `question_releases_catalog_draft_id_key`(`catalog_draft_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catalog_drafts` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `base_release_id` CHAR(36) NOT NULL,
    `base_catalog_hash` CHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `content_hash` CHAR(64) NOT NULL,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `validation_errors` JSON NOT NULL,
    `validation_warnings` JSON NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `submitted_by_id` CHAR(36) NULL,
    `submitted_at` DATETIME(3) NULL,
    `warnings_acknowledged_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `catalog_drafts_status_updated_at_idx`(`status`, `updated_at`),
    INDEX `catalog_drafts_base_catalog_hash_status_idx`(`base_catalog_hash`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catalog_draft_reviews` (
    `id` CHAR(36) NOT NULL,
    `catalog_draft_id` CHAR(36) NOT NULL,
    `reviewer_id` CHAR(36) NOT NULL,
    `decision` ENUM('APPROVED', 'REJECTED') NOT NULL,
    `content_hash` CHAR(64) NOT NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `catalog_draft_reviews_catalog_draft_id_created_at_idx`(`catalog_draft_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_release_items` (
    `id` CHAR(36) NOT NULL,
    `release_id` CHAR(36) NOT NULL,
    `draft_id` CHAR(36) NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(24) NOT NULL,
    `previous_version_id` CHAR(36) NULL,
    `published_version_id` CHAR(36) NULL,
    `before_state` JSON NULL,
    `after_state` JSON NULL,

    INDEX `question_release_items_question_id_release_id_idx`(`question_id`, `release_id`),
    UNIQUE INDEX `question_release_items_release_id_question_id_key`(`release_id`, `question_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catalog_state` (
    `id` INTEGER NOT NULL,
    `active_release_id` CHAR(36) NULL,
    `publish_frozen` BOOLEAN NOT NULL DEFAULT false,
    `freeze_reason` TEXT NULL,
    `frozen_at` DATETIME(3) NULL,
    `frozen_release_id` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `media_assets` (
    `id` CHAR(36) NOT NULL,
    `object_key` VARCHAR(512) NOT NULL,
    `sha256` CHAR(64) NULL,
    `mime_type` VARCHAR(96) NOT NULL,
    `size` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `public_url` VARCHAR(1024) NULL,
    `status` ENUM('PENDING', 'READY', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ready_at` DATETIME(3) NULL,

    UNIQUE INDEX `media_assets_object_key_key`(`object_key`),
    UNIQUE INDEX `media_assets_sha256_key`(`sha256`),
    INDEX `media_assets_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `admin_user_id` CHAR(36) NULL,
    `action` VARCHAR(96) NOT NULL,
    `entity_type` VARCHAR(64) NOT NULL,
    `entity_id` VARCHAR(96) NULL,
    `before_state` JSON NULL,
    `after_state` JSON NULL,
    `request_id` VARCHAR(96) NULL,
    `ip_hash` CHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `admin_audit_logs_created_at_idx`(`created_at`),
    INDEX `admin_audit_logs_entity_type_entity_id_created_at_idx`(`entity_type`, `entity_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `questions_external_code_key` ON `questions`(`external_code`);

-- AddForeignKey
ALTER TABLE `catalog_module_subjects` ADD CONSTRAINT `catalog_module_subjects_module_id_fkey` FOREIGN KEY (`module_id`) REFERENCES `catalog_modules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catalog_module_subjects` ADD CONSTRAINT `catalog_module_subjects_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_admin_user_id_fkey` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_drafts` ADD CONSTRAINT `question_drafts_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_drafts` ADD CONSTRAINT `question_drafts_base_version_id_fkey` FOREIGN KEY (`base_version_id`) REFERENCES `question_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_drafts` ADD CONSTRAINT `question_drafts_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_drafts` ADD CONSTRAINT `question_drafts_submitted_by_id_fkey` FOREIGN KEY (`submitted_by_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `draft_reviews` ADD CONSTRAINT `draft_reviews_draft_id_fkey` FOREIGN KEY (`draft_id`) REFERENCES `question_drafts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `draft_reviews` ADD CONSTRAINT `draft_reviews_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_import_batches` ADD CONSTRAINT `question_import_batches_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_import_batches` ADD CONSTRAINT `question_import_batches_submitted_by_id_fkey` FOREIGN KEY (`submitted_by_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_import_batches` ADD CONSTRAINT `question_import_batches_published_release_id_fkey` FOREIGN KEY (`published_release_id`) REFERENCES `question_releases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_batch_reviews` ADD CONSTRAINT `import_batch_reviews_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `question_import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_batch_reviews` ADD CONSTRAINT `import_batch_reviews_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_import_rows` ADD CONSTRAINT `question_import_rows_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `question_import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_import_rows` ADD CONSTRAINT `question_import_rows_draft_id_fkey` FOREIGN KEY (`draft_id`) REFERENCES `question_drafts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_releases` ADD CONSTRAINT `question_releases_previous_release_id_fkey` FOREIGN KEY (`previous_release_id`) REFERENCES `question_releases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_releases` ADD CONSTRAINT `question_releases_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_releases` ADD CONSTRAINT `question_releases_published_by_id_fkey` FOREIGN KEY (`published_by_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_releases` ADD CONSTRAINT `question_releases_catalog_draft_id_fkey` FOREIGN KEY (`catalog_draft_id`) REFERENCES `catalog_drafts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catalog_drafts` ADD CONSTRAINT `catalog_drafts_base_release_id_fkey` FOREIGN KEY (`base_release_id`) REFERENCES `question_releases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catalog_drafts` ADD CONSTRAINT `catalog_drafts_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catalog_drafts` ADD CONSTRAINT `catalog_drafts_submitted_by_id_fkey` FOREIGN KEY (`submitted_by_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catalog_draft_reviews` ADD CONSTRAINT `catalog_draft_reviews_catalog_draft_id_fkey` FOREIGN KEY (`catalog_draft_id`) REFERENCES `catalog_drafts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catalog_draft_reviews` ADD CONSTRAINT `catalog_draft_reviews_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_release_items` ADD CONSTRAINT `question_release_items_release_id_fkey` FOREIGN KEY (`release_id`) REFERENCES `question_releases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_release_items` ADD CONSTRAINT `question_release_items_draft_id_fkey` FOREIGN KEY (`draft_id`) REFERENCES `question_drafts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_release_items` ADD CONSTRAINT `question_release_items_previous_version_id_fkey` FOREIGN KEY (`previous_version_id`) REFERENCES `question_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_release_items` ADD CONSTRAINT `question_release_items_published_version_id_fkey` FOREIGN KEY (`published_version_id`) REFERENCES `question_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catalog_state` ADD CONSTRAINT `catalog_state_active_release_id_fkey` FOREIGN KEY (`active_release_id`) REFERENCES `question_releases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_audit_logs` ADD CONSTRAINT `admin_audit_logs_admin_user_id_fkey` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- MySQL 全文索引用于 10 万题规模下的题干搜索；题号、筛选字段继续使用普通索引。
ALTER TABLE `question_versions` ADD FULLTEXT INDEX `question_versions_stem_fulltext_idx`(`stem`) WITH PARSER ngram;
ALTER TABLE `question_drafts` ADD FULLTEXT INDEX `question_drafts_stem_fulltext_idx`(`stem`) WITH PARSER ngram;
