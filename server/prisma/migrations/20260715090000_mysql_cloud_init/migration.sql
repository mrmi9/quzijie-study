-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `wechat_open_id` VARCHAR(191) NOT NULL,
    `union_id` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `last_login_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_wechat_open_id_key`(`wechat_open_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `replaced_by_token_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_expires_at_idx`(`user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subjects` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `short_name` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chapters` (
    `id` VARCHAR(191) NOT NULL,
    `subject_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `chapters_subject_id_order_key`(`subject_id`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `questions` (
    `id` VARCHAR(191) NOT NULL,
    `subject_id` VARCHAR(191) NOT NULL,
    `chapter_id` VARCHAR(191) NOT NULL,
    `current_version_id` CHAR(36) NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `questions_current_version_id_key`(`current_version_id`),
    INDEX `questions_subject_id_chapter_id_status_idx`(`subject_id`, `chapter_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_versions` (
    `id` CHAR(36) NOT NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `type` ENUM('SINGLE', 'MULTIPLE', 'JUDGE') NOT NULL,
    `stem` TEXT NOT NULL,
    `code` TEXT NULL,
    `explanation` TEXT NOT NULL,
    `difficulty` INTEGER NOT NULL,
    `tags` JSON NOT NULL,
    `images` JSON NOT NULL,
    `exam_scopes` JSON NOT NULL,
    `correct_option_ids` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `question_versions_question_id_version_key`(`question_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_options` (
    `id` CHAR(36) NOT NULL,
    `question_version_id` CHAR(36) NOT NULL,
    `option_id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `position` INTEGER NOT NULL,

    UNIQUE INDEX `question_options_question_version_id_option_id_key`(`question_version_id`, `option_id`),
    UNIQUE INDEX `question_options_question_version_id_position_key`(`question_version_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `practice_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `subject_id` VARCHAR(191) NOT NULL,
    `mode` ENUM('CHAPTER', 'RANDOM', 'WRONG', 'FAVORITE') NOT NULL,
    `chapter_id` VARCHAR(191) NULL,
    `requested_count` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'COMPLETED', 'ABANDONED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `abandoned_at` DATETIME(3) NULL,

    INDEX `practice_sessions_user_id_status_updated_at_idx`(`user_id`, `status`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `practice_session_questions` (
    `session_id` CHAR(36) NOT NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `question_version_id` CHAR(36) NOT NULL,
    `position` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,

    UNIQUE INDEX `practice_session_questions_session_id_position_key`(`session_id`, `position`),
    PRIMARY KEY (`session_id`, `question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `practice_answers` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `client_answer_id` VARCHAR(191) NOT NULL,
    `selected_option_ids` JSON NOT NULL,
    `correct_option_ids` JSON NOT NULL,
    `explanation` TEXT NOT NULL,
    `is_correct` BOOLEAN NOT NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `practice_answers_user_id_submitted_at_idx`(`user_id`, `submitted_at`),
    UNIQUE INDEX `practice_answers_user_id_client_answer_id_key`(`user_id`, `client_answer_id`),
    UNIQUE INDEX `practice_answers_session_id_question_id_key`(`session_id`, `question_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wrong_question_records` (
    `user_id` CHAR(36) NOT NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `wrong_count` INTEGER NOT NULL DEFAULT 1,
    `mastered` BOOLEAN NOT NULL DEFAULT false,
    `first_wrong_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_wrong_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `mastered_at` DATETIME(3) NULL,

    INDEX `wrong_question_records_user_id_mastered_idx`(`user_id`, `mastered`),
    PRIMARY KEY (`user_id`, `question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `favorites` (
    `user_id` CHAR(36) NOT NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`user_id`, `question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exams` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'COMPLETED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `submit_reason` ENUM('MANUAL', 'EXPIRED') NULL,

    INDEX `exams_user_id_status_created_at_idx`(`user_id`, `status`, `created_at`),
    INDEX `exams_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_questions` (
    `exam_id` CHAR(36) NOT NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `question_version_id` CHAR(36) NOT NULL,
    `subject_id` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `points` INTEGER NOT NULL DEFAULT 2,
    `snapshot` JSON NOT NULL,
    `is_correct` BOOLEAN NULL,

    INDEX `exam_questions_exam_id_subject_id_idx`(`exam_id`, `subject_id`),
    INDEX `exam_questions_question_id_idx`(`question_id`),
    UNIQUE INDEX `exam_questions_exam_id_position_key`(`exam_id`, `position`),
    PRIMARY KEY (`exam_id`, `question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_drafts` (
    `exam_id` CHAR(36) NOT NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `selected_option_id` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`exam_id`, `question_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_results` (
    `exam_id` CHAR(36) NOT NULL,
    `total_count` INTEGER NOT NULL,
    `answered_count` INTEGER NOT NULL,
    `correct_count` INTEGER NOT NULL,
    `wrong_count` INTEGER NOT NULL,
    `score` INTEGER NOT NULL,
    `max_score` INTEGER NOT NULL,
    `accuracy` INTEGER NOT NULL,
    `subject_stats` JSON NOT NULL,
    `submit_reason` ENUM('MANUAL', 'EXPIRED') NOT NULL,
    `submitted_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`exam_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chapters` ADD CONSTRAINT `chapters_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_chapter_id_fkey` FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_current_version_id_fkey` FOREIGN KEY (`current_version_id`) REFERENCES `question_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_versions` ADD CONSTRAINT `question_versions_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_options` ADD CONSTRAINT `question_options_question_version_id_fkey` FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_sessions` ADD CONSTRAINT `practice_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_sessions` ADD CONSTRAINT `practice_sessions_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_sessions` ADD CONSTRAINT `practice_sessions_chapter_id_fkey` FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_session_questions` ADD CONSTRAINT `practice_session_questions_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `practice_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_session_questions` ADD CONSTRAINT `practice_session_questions_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_session_questions` ADD CONSTRAINT `practice_session_questions_question_version_id_fkey` FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_answers` ADD CONSTRAINT `practice_answers_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `practice_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_answers` ADD CONSTRAINT `practice_answers_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `practice_answers` ADD CONSTRAINT `practice_answers_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_question_records` ADD CONSTRAINT `wrong_question_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wrong_question_records` ADD CONSTRAINT `wrong_question_records_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `favorites` ADD CONSTRAINT `favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `favorites` ADD CONSTRAINT `favorites_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exams` ADD CONSTRAINT `exams_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_questions` ADD CONSTRAINT `exam_questions_exam_id_fkey` FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_questions` ADD CONSTRAINT `exam_questions_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_questions` ADD CONSTRAINT `exam_questions_question_version_id_fkey` FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_questions` ADD CONSTRAINT `exam_questions_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_drafts` ADD CONSTRAINT `exam_drafts_exam_id_question_id_fkey` FOREIGN KEY (`exam_id`, `question_id`) REFERENCES `exam_questions`(`exam_id`, `question_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_results` ADD CONSTRAINT `exam_results_exam_id_fkey` FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
