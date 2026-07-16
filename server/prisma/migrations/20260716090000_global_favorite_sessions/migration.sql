-- DropForeignKey
ALTER TABLE `practice_sessions` DROP FOREIGN KEY `practice_sessions_subject_id_fkey`;

-- AlterTable
ALTER TABLE `practice_sessions` MODIFY `subject_id` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `practice_sessions` ADD CONSTRAINT `practice_sessions_subject_id_fkey` FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
