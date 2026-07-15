-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ExamSubmitReason" AS ENUM ('MANUAL', 'EXPIRED');

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" "ExamStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "submit_reason" "ExamSubmitReason",

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_questions" (
    "exam_id" UUID NOT NULL,
    "question_id" TEXT NOT NULL,
    "question_version_id" UUID NOT NULL,
    "subject_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 2,
    "snapshot" JSONB NOT NULL,
    "is_correct" BOOLEAN,

    CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("exam_id", "question_id")
);

-- CreateTable
CREATE TABLE "exam_drafts" (
    "exam_id" UUID NOT NULL,
    "question_id" TEXT NOT NULL,
    "selected_option_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_drafts_pkey" PRIMARY KEY ("exam_id", "question_id")
);

-- CreateTable
CREATE TABLE "exam_results" (
    "exam_id" UUID NOT NULL,
    "total_count" INTEGER NOT NULL,
    "answered_count" INTEGER NOT NULL,
    "correct_count" INTEGER NOT NULL,
    "wrong_count" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "max_score" INTEGER NOT NULL,
    "accuracy" INTEGER NOT NULL,
    "subject_stats" JSONB NOT NULL,
    "submit_reason" "ExamSubmitReason" NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_results_pkey" PRIMARY KEY ("exam_id")
);

-- CreateIndex
CREATE INDEX "exams_user_id_status_created_at_idx" ON "exams"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "exams_status_expires_at_idx" ON "exams"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "exams_one_active_per_user_type" ON "exams"("user_id", "type") WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "exam_questions_exam_id_position_key" ON "exam_questions"("exam_id", "position");

-- CreateIndex
CREATE INDEX "exam_questions_exam_id_subject_id_idx" ON "exam_questions"("exam_id", "subject_id");

-- CreateIndex
CREATE INDEX "exam_questions_question_id_idx" ON "exam_questions"("question_id");

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_drafts" ADD CONSTRAINT "exam_drafts_exam_id_question_id_fkey" FOREIGN KEY ("exam_id", "question_id") REFERENCES "exam_questions"("exam_id", "question_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
